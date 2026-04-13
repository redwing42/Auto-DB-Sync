"""FastAPI application for RedWing DB Automation.

All routes: webhook, submissions CRUD, file downloads, waypoint parsing,
resolve preview, and approval pipeline.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel

from fastapi import Depends, FastAPI, Header, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from config import Settings, get_settings
from auth import get_current_user, require_role
from audit_store import AuditStore
from drive_downloader import download_submission_files
from excel_updater import ExcelUpdater
from models import (
    ApprovalRequest,
    AuditActionType,
    AuditRecord,
    DownloadResult,
    DownloadStatus,
    DraftResponse,
    DuplicateCheckResponse,
    LandingZoneInfo,
    LocationInfo,
    NetworkInfo,
    PipelineResult,
    ResolvePreviewResponse,
    ReviewStateUpdateRequest,
    RouteInfo,
    StatusUpdateRequest,
    SubmissionPayload,
    SubmissionPayloadUpdateRequest,
    SubmissionResponse,
    SubmissionStatus,
    SubmissionType,
    UpdateSubmissionPayload,
    ValidationResponse,
    WaypointFileResponse,
    WorkflowState,
)
from pipeline import run_approval_pipeline
from submission_store import SubmissionStore
from validation import validate_submission, validate_all_drive_links
from waypoint_parser import parse_waypoints_file
import email_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RedWing DB Automation",
    description="Backend for automating RedWing flight database updates from Google Form submissions.",
    version="1.0.0",
)


# Configure CORS at module level
_settings_for_cors = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings_for_cors.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    """Disable caching for all GET requests to ensure fresh data."""
    response = await call_next(request)
    if request.method == "GET":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ── Dependencies ─────────────────────────────────────────────────────────────

_store: Optional[SubmissionStore] = None
_audit_store: Optional[AuditStore] = None


def get_store() -> SubmissionStore:
    global _store
    if _store is None:
        settings = get_settings()
        _store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    return _store


def get_audit_store() -> AuditStore:
    global _audit_store
    if _audit_store is None:
        settings = get_settings()
        _audit_store = AuditStore(settings.AUDIT_DB_PATH)
    return _audit_store


def init_app() -> None:
    """Initialize the app on startup."""
    settings = get_settings()
    # Ensure stores are ready
    get_store()
    get_audit_store()
    
    # SMTP Validation (non-blocking)
    if not settings.SMTP_PASSWORD or settings.SMTP_PASSWORD == "ROTATE_ME_PUT_NEW_SENDGRID_KEY_HERE":
        logger.warning("SMTP_PASSWORD not configured. Emails will be logged but not sent.")
    
    logger.info("RedWing DB Automation backend started")
    logger.info(f"  Repo path: {settings.repo_path}")
    logger.info(f"  Excel: {settings.excel_path}")
    logger.info(f"  Frontend: {settings.FRONTEND_URL}")


@app.on_event("startup")
async def startup_event():
    init_app()
    # Phase 4: Clean up stale drafts older than 7 days
    store = get_store()
    stale_count = store.soft_delete_stale_drafts(days=7)
    if stale_count > 0:
        logger.info(f"Soft-deleted {stale_count} stale draft(s) older than 7 days")


# ── Auth Helper ──────────────────────────────────────────────────────────────

def verify_webhook_secret(
    x_webhook_secret: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> None:
    if not x_webhook_secret or x_webhook_secret != settings.WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing webhook secret")


# ── 1. WEBHOOK — Receive New Submissions ─────────────────────────────────────

@app.post("/webhook/new-submission", status_code=200)
async def webhook_new_submission(
    payload: SubmissionPayload,
    _auth: None = Depends(verify_webhook_secret),
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
):
    """Receive a new submission from Google Apps Script webhook."""
    # Run shared validation
    validation = validate_submission(payload)
    if not validation.is_valid:
        logger.warning(f"Webhook submission failed validation: {validation.errors}")
        raise HTTPException(status_code=422, detail=f"Validation failed: {'; '.join(validation.errors)}")

    # Check for duplicate in Excel
    status = SubmissionStatus.PENDING
    
    if settings.excel_path.exists():
        updater = ExcelUpdater(settings.excel_path)
        try:
            updater.open()
            if updater.is_duplicate_submission(payload):
                status = SubmissionStatus.DUPLICATE
                logger.info(f"Duplicate submission detected - auto-flagging as {status}")
        except Exception as e:
            logger.error(f"Error checking for duplicate: {e}")
        finally:
            updater.close()

    submission_id = store.add_submission(
        payload, 
        status=status, 
        source="webhook"
    )
    
    # Phase 3: Audit & Notification
    audit = get_audit_store()
    audit.add_record(
        submission_id, 
        AuditActionType.SUBMISSION_CREATED,
        metadata={"source": "webhook"}
    )
    
    email_service.send_submission_notification(
        submission_id, 
        payload, 
        submitter_name="Google Form", 
        submitter_role="webhook"
    )

    logger.info(f"New submission received: {submission_id} (Status: {status})")
    sub = store.get_submission(submission_id)
    return {
        "submission_id": submission_id,
        "human_id": sub.human_id if sub else f"#{submission_id[:8]}",
        "status": status.value,
        "warnings": validation.warnings,
    }


# ── 1b. UI SUBMISSION — Submit via Frontend ─────────────────────────────────

@app.post("/submissions", status_code=200)
async def create_submission(
    payload: SubmissionPayload,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(require_role('operator')),
):
    """Create a new submission from the frontend UI."""
    # Run shared validation
    validation = validate_submission(payload)
    if not validation.is_valid:
        raise HTTPException(status_code=422, detail={
            "message": "Validation failed",
            "errors": validation.errors,
            "warnings": validation.warnings,
        })

    # Check for duplicate in Excel (only for new routes)
    status = SubmissionStatus.PENDING

    if not payload.is_update and settings.excel_path.exists():
        updater = ExcelUpdater(settings.excel_path)
        try:
            updater.open()
            if updater.is_duplicate_submission(payload):
                status = SubmissionStatus.DUPLICATE
                logger.info(f"UI submission duplicate detected")
        except Exception as e:
            logger.error(f"Error checking for duplicate: {e}")
        finally:
            updater.close()

    # Phase 4: Determine submission type and changed_fields
    submission_type = "UPDATE" if payload.is_update else "NEW_ROUTE"
    changed_fields_json = None
    parent_submission_id = None
    if isinstance(payload, UpdateSubmissionPayload):
        import json as _json
        if payload.changed_fields:
            changed_fields_json = _json.dumps(payload.changed_fields)
        parent_submission_id = payload.parent_submission_id

    submission_id = store.add_submission(
        payload, 
        status=status, 
        user_uid=user['uid'], 
        source="ui",
        submitted_by_name=user.get('display_name', user['email']),
        submitted_by_role=user.get('role', 'operator'),
        submission_type=submission_type,
        changed_fields=changed_fields_json,
        parent_submission_id=parent_submission_id,
    )
    
    # Phase 3: Audit & Notification
    audit = get_audit_store()
    audit.add_record(
        submission_id, 
        AuditActionType.SUBMISSION_CREATED,
        performed_by_uid=user['uid'],
        performed_by_name=user.get('display_name', user['email']),
        performed_by_role=user.get('role', 'operator'),
        metadata={"source": "ui", "submission_type": submission_type}
    )
    
    email_service.send_submission_notification(
        submission_id, 
        payload, 
        submitter_name=user.get('display_name', user['email']), 
        submitter_role=user.get('role', 'operator')
    )

    logger.info(f"UI submission created: {submission_id} by {user['email']} ({submission_type})")
    sub = store.get_submission(submission_id)
    return {
        "submission_id": submission_id,
        "human_id": sub.human_id if sub else f"#{submission_id[:8]}",
        "status": status.value,
        "warnings": validation.warnings,
    }


# ── 1c. VALIDATE — Dry-run validation (no store) ────────────────────────────

@app.post("/submissions/validate", response_model=ValidationResponse)
async def validate_submission_endpoint(
    payload: SubmissionPayload,
    user: dict = Depends(require_role('operator')),
):
    """Dry-run validation of a submission payload. Includes server-side Drive link check."""
    validation = validate_submission(payload)

    # Server-side Drive link accessibility check
    drive_errors = await validate_all_drive_links(payload)

    return ValidationResponse(
        is_valid=validation.is_valid and len(drive_errors) == 0,
        errors=validation.errors,
        warnings=validation.warnings,
        drive_link_errors=drive_errors,
    )


# ── 1d. DUPLICATE CHECK — Check submissions.db + flights.db ─────────────────

@app.post("/submissions/check-duplicate", response_model=DuplicateCheckResponse)
async def check_duplicate(
    payload: SubmissionPayload,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(require_role('operator')),
):
    """Check for exact and near-duplicate submissions in submissions.db and flights.db."""
    import sqlite3 as _sqlite3

    result = DuplicateCheckResponse()

    # 1. Check submissions.db for exact duplicate payloads
    existing_subs = store.list_submissions()
    for sub in existing_subs:
        if sub.status in (SubmissionStatus.REJECTED,):
            continue
        p = sub.payload
        if (
            p.mission_filename == payload.mission_filename
            and abs(p.source_latitude - payload.source_latitude) < 0.0001
            and abs(p.source_longitude - payload.source_longitude) < 0.0001
            and abs(p.destination_latitude - payload.destination_latitude) < 0.0001
            and abs(p.destination_longitude - payload.destination_longitude) < 0.0001
            and p.takeoff_direction == payload.takeoff_direction
            and p.approach_direction == payload.approach_direction
        ):
            # If it's an update, don't flag against approved submissions (we are updating them!)
            if payload.is_update and sub.status == SubmissionStatus.APPROVED:
                continue

            result.is_exact_duplicate = True
            result.exact_match_id = sub.id
            result.message = f"Exact duplicate of submission #{sub.id[:8]} ({sub.status.value})"
            return result

    # 2. Check flights.db for already-approved routes (only for new routes)
    if payload.is_update:
        result.message = "Update submission - bypassing duplicate check against existing routes."
        return result

    flights_db = settings.instance_dir / "flights.db"
    if flights_db.exists():
        try:
            conn = _sqlite3.connect(str(flights_db))
            conn.row_factory = _sqlite3.Row
            rows = conn.execute("""
                SELECT fr.id, slz.latitude as s_lat, slz.longitude as s_lng,
                       elz.latitude as e_lat, elz.longitude as e_lng,
                       fr.takeoff_direction, fr.approach_direction,
                       wf.filename
                FROM flight_routes fr
                JOIN landing_zones slz ON fr.start_lz_id = slz.id
                JOIN landing_zones elz ON fr.end_lz_id = elz.id
                JOIN waypoint_files wf ON fr.waypoint_file_id = wf.id
            """).fetchall()
            conn.close()

            for r in rows:
                is_exact = (
                    r["filename"] == payload.mission_filename
                    and abs(r["s_lat"] - payload.source_latitude) < 0.0001
                    and abs(r["s_lng"] - payload.source_longitude) < 0.0001
                    and abs(r["e_lat"] - payload.destination_latitude) < 0.0001
                    and abs(r["e_lng"] - payload.destination_longitude) < 0.0001
                )
                if is_exact:
                    result.is_exact_duplicate = True
                    result.message = f"Route already exists in flights database (Route ID: {r['id']})"
                    return result

                # Near-duplicate check (coords within 0.001°)
                is_near = (
                    abs(r["s_lat"] - payload.source_latitude) < 0.001
                    and abs(r["s_lng"] - payload.source_longitude) < 0.001
                    and abs(r["e_lat"] - payload.destination_latitude) < 0.001
                    and abs(r["e_lng"] - payload.destination_longitude) < 0.001
                )
                if is_near:
                    result.is_near_duplicate = True
                    result.near_matches.append({
                        "route_id": r["id"],
                        "filename": r["filename"],
                        "s_lat": r["s_lat"], "s_lng": r["s_lng"],
                        "e_lat": r["e_lat"], "e_lng": r["e_lng"],
                    })
        except Exception as e:
            logger.warning(f"Duplicate check: failed to query flights.db: {e}")

    if result.is_near_duplicate:
        result.message = f"Found {len(result.near_matches)} near-duplicate route(s) within 0.001°"
    else:
        result.message = "No duplicates found"

    return result


# ── NETWORKS & ROUTES (from flights.db) ──────────────────────────────────────

@app.get("/networks", response_model=list[NetworkInfo])
async def list_networks(
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """List all networks from flights.db with route counts."""
    import sqlite3 as _sqlite3

    flights_db = settings.instance_dir / "flights.db"
    if not flights_db.exists():
        raise HTTPException(status_code=404, detail="flights.db not found")

    conn = _sqlite3.connect(str(flights_db))
    conn.row_factory = _sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT n.id, n.name, COUNT(fr.id) as route_count
            FROM networks n
            LEFT JOIN flight_routes fr ON fr.network_id = n.id
            GROUP BY n.id, n.name
            ORDER BY n.name
        """).fetchall()
        return [NetworkInfo(id=r["id"], name=r["name"], route_count=r["route_count"]) for r in rows]
    finally:
        conn.close()


@app.get("/networks/{network_id}/routes", response_model=list[RouteInfo])
async def get_network_routes(
    network_id: int,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """List all routes for a network from flights.db with full details."""
    import sqlite3 as _sqlite3

    flights_db = settings.instance_dir / "flights.db"
    if not flights_db.exists():
        raise HTTPException(status_code=404, detail="flights.db not found")

    conn = _sqlite3.connect(str(flights_db))
    conn.row_factory = _sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT
                fr.id,
                fr.network_id,
                sl.name as start_location_name,
                el.name as end_location_name,
                slz.name as start_lz_name,
                elz.name as end_lz_name,
                slz.latitude as start_latitude,
                slz.longitude as start_longitude,
                elz.latitude as end_latitude,
                elz.longitude as end_longitude,
                fr.takeoff_direction,
                fr.approach_direction,
                wf.filename as mission_filename,
                fr.status
            FROM flight_routes fr
            JOIN landing_zones slz ON fr.start_lz_id = slz.id
            JOIN landing_zones elz ON fr.end_lz_id = elz.id
            JOIN locations sl ON fr.start_location_id = sl.id
            JOIN locations el ON fr.end_location_id = el.id
            JOIN waypoint_files wf ON fr.waypoint_file_id = wf.id
            WHERE fr.network_id = ?
            ORDER BY fr.id
        """, (network_id,)).fetchall()
        return [RouteInfo(**dict(r)) for r in rows]
    finally:
        conn.close()


@app.get("/routes/{route_id}", response_model=RouteInfo)
async def get_route(
    route_id: int,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """Get full details of a specific route from flights.db."""
    import sqlite3 as _sqlite3

    flights_db = settings.instance_dir / "flights.db"
    if not flights_db.exists():
        raise HTTPException(status_code=404, detail="flights.db not found")

    conn = _sqlite3.connect(str(flights_db))
    conn.row_factory = _sqlite3.Row
    try:
        row = conn.execute("""
            SELECT
                fr.id,
                fr.network_id,
                sl.name as start_location_name,
                el.name as end_location_name,
                slz.name as start_lz_name,
                elz.name as end_lz_name,
                slz.latitude as start_latitude,
                slz.longitude as start_longitude,
                elz.latitude as end_latitude,
                elz.longitude as end_longitude,
                fr.takeoff_direction,
                fr.approach_direction,
                wf.filename as mission_filename,
                fr.status
            FROM flight_routes fr
            JOIN landing_zones slz ON fr.start_lz_id = slz.id
            JOIN landing_zones elz ON fr.end_lz_id = elz.id
            JOIN locations sl ON fr.start_location_id = sl.id
            JOIN locations el ON fr.end_location_id = el.id
            JOIN waypoint_files wf ON fr.waypoint_file_id = wf.id
            WHERE fr.id = ?
        """, (route_id,)).fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Route not found")
            
        return RouteInfo(**dict(row))
    finally:
        conn.close()


@app.get("/networks/{network_id}/landing-zones", response_model=list[LandingZoneInfo])
async def get_network_landing_zones(
    network_id: int,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """List all landing zones for a network, with location name and coordinates."""
    import sqlite3 as _sqlite3

    flights_db = settings.instance_dir / "flights.db"
    if not flights_db.exists():
        raise HTTPException(status_code=404, detail="flights.db not found")

    conn = _sqlite3.connect(str(flights_db))
    conn.row_factory = _sqlite3.Row
    try:
        # landing_zones has no network_id column — get LZs used in flight_routes for the network
        rows = conn.execute("""
            SELECT DISTINCT lz.id, lz.name, lz.latitude, lz.longitude,
                            l.id as location_id, l.name as location_name
            FROM landing_zones lz
            JOIN locations l ON lz.location_id = l.id
            JOIN (
                SELECT start_lz_id as lz_id, network_id FROM flight_routes WHERE network_id = ?
                UNION
                SELECT end_lz_id as lz_id, network_id FROM flight_routes WHERE network_id = ?
            ) used_lz ON lz.id = used_lz.lz_id
            ORDER BY l.name, lz.name
        """, (network_id, network_id)).fetchall()
        return [LandingZoneInfo(**dict(r)) for r in rows]
    finally:
        conn.close()


class LandingZoneCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    location_id: int

class LandingZoneUpdate(BaseModel):
    name: str
    latitude: float
    longitude: float

@app.post("/networks/{network_id}/landing-zones")
async def create_landing_zone(
    network_id: int,
    lz_data: LandingZoneCreate,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """Create a new landing zone in flights.db."""
    import sqlite3 as _sqlite3
    flights_db = settings.instance_dir / "flights.db"
    
    conn = _sqlite3.connect(str(flights_db))
    try:
        cursor = conn.cursor()
        # landing_zones table does NOT have network_id. 
        # It's associated via location_id.
        cursor.execute("""
            INSERT INTO landing_zones (location_id, name, latitude, longitude, status)
            VALUES (?, ?, ?, ?, ?)
        """, (lz_data.location_id, lz_data.name, lz_data.latitude, lz_data.longitude, True))
        conn.commit()
        return {"lz_id": cursor.lastrowid}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/locations", response_model=list[LocationInfo])
async def list_locations(
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """List all locations from flights.db."""
    import sqlite3 as _sqlite3
    flights_db = settings.instance_dir / "flights.db"
    
    conn = _sqlite3.connect(str(flights_db))
    conn.row_factory = _sqlite3.Row
    try:
        rows = conn.execute("SELECT id, name, code, location_type, COALESCE(landing_zone_count, 0) as landing_zone_count FROM locations ORDER BY name").fetchall()
        return [LocationInfo(**dict(r)) for r in rows]
    finally:
        conn.close()
        
@app.patch("/locations/{location_id}")
async def patch_location(
    location_id: int,
    updates: dict,
    settings: Settings = Depends(get_settings),
    _auth: dict = Depends(require_role('reviewer')),
):
    """Update location metadata like type (Hub/Node)."""
    import sqlite3 as _sqlite3
    flights_db = settings.instance_dir / "flights.db"
    
    conn = _sqlite3.connect(str(flights_db))
    try:
        if "location_type" in updates:
            conn.execute("UPDATE locations SET location_type = ? WHERE id = ?", (updates["location_type"], location_id))
            conn.commit()
            return {"status": "success"}
        raise HTTPException(status_code=400, detail="No valid fields to update")
    finally:
        conn.close()

@app.put("/landing-zones/{lz_id}")
async def update_landing_zone(
    lz_id: int,
    lz_data: LandingZoneUpdate,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """Update an existing landing zone in flights.db."""
    import sqlite3 as _sqlite3
    flights_db = settings.instance_dir / "flights.db"
    
    conn = _sqlite3.connect(str(flights_db))
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE landing_zones 
            SET name = ?, latitude = ?, longitude = ?
            WHERE id = ?
        """, (lz_data.name, lz_data.latitude, lz_data.longitude, lz_id))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Landing zone not found")
            
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.delete("/landing-zones/{lz_id}")
async def delete_landing_zone(
    lz_id: int,
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user),
):
    """Delete a landing zone from flights.db by its ID."""
    import sqlite3 as _sqlite3
    flights_db = settings.instance_dir / "flights.db"

    conn = _sqlite3.connect(str(flights_db))
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM landing_zones WHERE id = ?", (lz_id,))

        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Landing zone not found")

        conn.commit()
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()



@app.post("/waypoints/parse", response_model=WaypointFileResponse)
async def parse_waypoints_upload(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Stateless endpoint: parse an uploaded .waypoints file and return structured waypoint data."""
    import tempfile, os

    if not file.filename.endswith(".waypoints"):
        raise HTTPException(status_code=400, detail="Only .waypoints files are accepted")

    contents = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".waypoints") as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        result = parse_waypoints_file(tmp_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        os.unlink(tmp_path)


# ── 2. SUBMISSIONS API ──────────────────────────────────────────────────────

@app.get("/submissions", response_model=list[SubmissionResponse])
async def list_submissions(store: SubmissionStore = Depends(get_store), user: dict = Depends(get_current_user)):
    """List all submissions with their status."""
    return store.list_submissions()


@app.get("/submissions/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(get_current_user)):
    """Get full details of one submission. Mark as viewed if reviewer/admin."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    # Transparency: Mark as viewed if first time seen by someone other than submitter (or a reviewer/admin)
    current_role = user.get('role', 'operator')
    if current_role in ('reviewer', 'sde', 'admin') and not sub.viewed_by_name:
        user_name = user.get('display_name', user['email'])
        if store.mark_viewed(submission_id, user_name):
            # Refresh object for response
            sub = store.get_submission(submission_id)
            
    return sub


@app.patch("/submissions/{submission_id}/review-state")
async def update_review_state(
    submission_id: str,
    request: ReviewStateUpdateRequest,
    store: SubmissionStore = Depends(get_store),
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(require_role('operator'))):
    """Update verification flags for a submission."""
    sub = store.get_submission(submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Workflow State Logic
    new_state = None
    action_type = None
    
    if request.waypoint_verified:
        # Gate 1: Waypoints verified
        new_state = WorkflowState.WAYPOINT_VERIFIED
        action_type = AuditActionType.GATE1_PASSED
    elif request.id_resolution_reviewed:
        # Gate 2: ID Resolution reviewed
        if sub.workflow_state != WorkflowState.WAYPOINT_VERIFIED:
            raise HTTPException(status_code=400, detail="Must verify waypoints before ID resolution")
        new_state = WorkflowState.ID_RESOLUTION_CONFIRMED
        action_type = AuditActionType.GATE2_CONFIRMED

    affected = store.update_review_state(
        submission_id,
        waypoint_verified=request.waypoint_verified,
        id_resolution_reviewed=request.id_resolution_reviewed,
        user_uid=user['uid'],
        reviewer_name=user.get('display_name', user['email'])
    )
    
    if affected and new_state and action_type:
        store.update_workflow_state(
            submission_id, 
            new_state, 
            user_uid=user['uid'],
            performer_name=user.get('display_name', user['email'])
        )
        audit_store.add_record(
            submission_id, 
            action_type,
            performed_by_uid=user['uid'],
            performed_by_name=user.get('display_name', user['email']),
            performed_by_role=user.get('role', 'operator')
        )
        
        # Trigger email if Gate 1 passed
        if action_type == AuditActionType.GATE1_PASSED:
            email_service.send_verification_complete(
                submission_id, sub.payload,
                verifier_name=user.get('display_name', user['email']),
                verifier_role=user.get('role', 'operator')
            )

    if not affected:
        raise HTTPException(status_code=404, detail="Submission not found")
    return {"status": "ok"}


@app.patch("/submissions/{submission_id}/payload", response_model=SubmissionResponse)
async def update_submission_payload(
    submission_id: str,
    request: SubmissionPayloadUpdateRequest,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator')),
):
    """Inline-edit key payload fields used by ID resolution."""
    sub = store.get_submission(submission_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status != SubmissionStatus.PENDING:
        raise HTTPException(status_code=400, detail="Can only edit payload for pending submissions")

    updated_payload = sub.payload.model_copy(update=request.model_dump(exclude_none=True))
    affected = store.update_submission_payload(
        submission_id,
        updated_payload,
        user_uid=user['uid'],
    )
    if not affected:
        raise HTTPException(status_code=404, detail="Submission not found")
    return store.get_submission(submission_id)


@app.patch("/submissions/{submission_id}/status")
async def update_submission_status(
    submission_id: str,
    body: StatusUpdateRequest,
    store: SubmissionStore = Depends(get_store),
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(require_role('operator'))):
    """Update submission status (e.g., reject)."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    if body.status not in (SubmissionStatus.REJECTED, SubmissionStatus.PENDING):
        raise HTTPException(
            status_code=400,
            detail="Can only set status to 'rejected' or 'pending' via this endpoint",
        )

    store.update_status(submission_id, body.status, body.reason, user_uid=user['uid'])
    
    # Phase 3: Workflow State & Audit
    if body.status == SubmissionStatus.REJECTED:
        store.update_workflow_state(
            submission_id, 
            WorkflowState.REJECTED, 
            user_uid=user['uid'],
            rejection_reason=body.reason
        )
        audit_store.add_record(
            submission_id,
            AuditActionType.REJECTED,
            performed_by_uid=user['uid'],
            performed_by_name=user.get('display_name', user['email']),
            performed_by_role=user.get('role', 'operator'),
            metadata={"reason": body.reason}
        )
        email_service.send_rejection(
            submission_id, sub.payload,
            rejector_name=user.get('display_name', user['email']),
            rejector_role=user.get('role', 'operator'),
            reason=body.reason or "No reason provided"
        )

    return {"submission_id": submission_id, "status": body.status.value}


# ── 3. FILE DOWNLOAD ────────────────────────────────────────────────────────

@app.patch("/submissions/{submission_id}/mark-duplicate", response_model=SubmissionResponse)
async def mark_as_duplicate(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator'))):
    """Manually flag a submission as a duplicate."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    success = store.update_status(submission_id, SubmissionStatus.DUPLICATE, user_uid=user['uid'])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update status")
    
    return store.get_submission(submission_id)


@app.post("/submissions/{submission_id}/download-files", response_model=SubmissionResponse)
async def download_files(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(require_role('operator'))):
    """Download waypoints and image files from Google Drive."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    store.update_download_status(submission_id, DownloadStatus.IN_PROGRESS, user_uid=user['uid'])

    result = await download_submission_files(
        sub.payload, settings.repo_path, settings.GNOME_GOA_ACCOUNT_PATH
    )

    if result.success:
        store.update_download_status(
            submission_id,
            DownloadStatus.COMPLETED,
            {
                "mission_file": result.mission_file_path,
                "elevation_image": result.elevation_image_path,
                "route_image": result.route_image_path,
            },
            user_uid=user['uid']
        )
    else:
        store.update_download_status(
            submission_id, 
            DownloadStatus.FAILED, 
            error_detail=result.error,
            user_uid=user['uid']
        )

    return store.get_submission(submission_id)


# ── 4. WAYPOINT DATA ────────────────────────────────────────────────────────

@app.get(
    "/submissions/{submission_id}/waypoint-data",
    response_model=WaypointFileResponse,
)
async def get_waypoint_data(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user)):
    """Parse the downloaded .waypoints file and return structured JSON."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    mission_path = settings.missions_dir / sub.payload.mission_filename
    if not mission_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Mission file not downloaded yet: {sub.payload.mission_filename}",
        )

    try:
        return parse_waypoints_file(mission_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse waypoints: {e}")


# ── RESOLVE PREVIEW ─────────────────────────────────────────────────────────

@app.get(
    "/submissions/{submission_id}/resolve-preview",
    response_model=ResolvePreviewResponse,
)
async def resolve_preview(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(get_current_user)):
    """Dry-run of Excel resolution pipeline (Steps 2–8). No writes."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    if not settings.excel_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Excel file not found: {settings.excel_path}",
        )

    updater = ExcelUpdater(settings.excel_path)
    try:
        updater.open()
        preview = updater.resolve_preview(sub.payload)
        return preview
    finally:
        updater.close()


# ── 5. APPROVE ──────────────────────────────────────────────────────────────

@app.post("/submissions/{submission_id}/approve", response_model=PipelineResult)
async def approve_submission(
    submission_id: str,
    body: ApprovalRequest,
    store: SubmissionStore = Depends(get_store),
    audit_store: AuditStore = Depends(get_audit_store),
    settings: Settings = Depends(get_settings),
    user: dict = Depends(require_role('operator'))):
    """Run the full approval pipeline with confirmation gate."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    if sub.status == SubmissionStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Submission already approved")

    if sub.status == SubmissionStatus.REJECTED:
        raise HTTPException(status_code=400, detail="Submission was rejected")

    # Phase 3: Pipeline Lock
    try:
        store.acquire_pipeline_lock(user['uid'])
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Phase 3: Transition to PIPELINE_RUNNING
    store.update_workflow_state(
        submission_id, 
        WorkflowState.PIPELINE_RUNNING, 
        user_uid=user['uid'],
        performer_name=user.get('display_name', user['email'])
    )
    audit_store.add_record(
        submission_id,
        AuditActionType.APPROVED,
        performed_by_uid=user['uid'],
        performed_by_name=user.get('display_name', user['email']),
        performed_by_role=user.get('role', 'operator')
    )

    # Run the full pipeline
    result = run_approval_pipeline(
        submission_id, 
        body, 
        store, 
        settings,
        user_uid=user['uid'],
        user_name=user.get('display_name', user['email']),
        user_role=user.get('role', 'operator')
    )

    if not result.success:
        # Pipeline logic in pipeline.py handles releasing lock and setting status
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline failed at step {result.error_step}: {result.error_detail}",
        )

    return result


@app.get("/submissions/{submission_id}/audit", response_model=List[AuditRecord])
async def get_submission_audit(
    submission_id: str,
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(get_current_user)):
    """Get the audit history for a specific submission."""
    records = audit_store.get_records(submission_id)
    return records


# ── STATS ────────────────────────────────────────────────────────────────────

@app.get("/stats")
async def get_stats(
    settings: Settings = Depends(get_settings),
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(get_current_user)):
    """Aggregated stats from flights.db and submissions.db."""
    import sqlite3 as _sqlite3

    result = {
        "total_routes": 0,
        "active_routes": 0,
        "total_locations": 0,
        "total_landing_zones": 0,
        "total_networks": 0,
        "routes_per_network": [],
        "lz_per_location": [],
        "submission_statuses": {},
        "recent_approved": [],
        "db_last_sync_at": None,
        "db_last_sync_by": None,
        "excel_last_modified_at": None,
    }

    # ── flights.db stats ─────────────────────────────────────────────────
    flights_db = settings.instance_dir / "flights.db"
    if flights_db.exists():
        try:
            conn = _sqlite3.connect(str(flights_db))
            conn.row_factory = _sqlite3.Row

            # Total & active routes
            row = conn.execute("SELECT COUNT(*) as c FROM flight_routes").fetchone()
            result["total_routes"] = row["c"] if row else 0

            # Active routes (status=1 or status='true')
            try:
                row_active = conn.execute(
                    "SELECT COUNT(*) as c FROM flight_routes WHERE status=1 OR status='true'"
                ).fetchone()
                result["active_routes"] = row_active["c"] if row_active else result["total_routes"]
            except Exception:
                result["active_routes"] = result["total_routes"]

            row = conn.execute("SELECT COUNT(*) as c FROM locations").fetchone()
            result["total_locations"] = row["c"] if row else 0

            row = conn.execute("SELECT COUNT(*) as c FROM landing_zones").fetchone()
            result["total_landing_zones"] = row["c"] if row else 0

            # Total networks
            try:
                row_net = conn.execute("SELECT COUNT(*) as c FROM networks").fetchone()
                result["total_networks"] = row_net["c"] if row_net else 0
            except Exception:
                pass

            # Routes per network with active/inactive split
            try:
                rows = conn.execute(
                    "SELECT n.name, "
                    "COUNT(fr.id) as cnt, "
                    "SUM(CASE WHEN fr.status=1 OR fr.status='true' THEN 1 ELSE 0 END) as active_cnt "
                    "FROM flight_routes fr JOIN networks n ON fr.network_id = n.id "
                    "GROUP BY n.name ORDER BY cnt DESC"
                ).fetchall()
                result["routes_per_network"] = [
                    {
                        "name": r["name"],
                        "count": r["cnt"],
                        "active": r["active_cnt"] if r["active_cnt"] else r["cnt"],
                        "inactive": r["cnt"] - (r["active_cnt"] if r["active_cnt"] else r["cnt"]),
                    }
                    for r in rows
                ]
            except Exception:
                pass

            # LZ per location (top 10)
            try:
                rows = conn.execute(
                    "SELECT l.name, COUNT(lz.id) as cnt "
                    "FROM landing_zones lz JOIN locations l ON lz.location_id = l.id "
                    "GROUP BY l.name ORDER BY cnt DESC LIMIT 10"
                ).fetchall()
                result["lz_per_location"] = [
                    {"name": r["name"], "count": r["cnt"]} for r in rows
                ]
            except Exception:
                pass

            conn.close()
        except Exception as e:
            logger.warning("Stats: failed to read flights.db: %s", e)

    # ── Excel last modified ──────────────────────────────────────────────
    import os
    excel_path = settings.instance_dir / "Flight_data_updated.xlsx"
    if excel_path.exists():
        try:
            mtime = os.path.getmtime(str(excel_path))
            from datetime import datetime, timezone
            result["excel_last_modified_at"] = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        except Exception:
            pass

    # ── submissions.db stats ─────────────────────────────────────────────
    try:
        subs = store.list_submissions()
        status_counts: dict[str, int] = {}
        recent: list[dict] = []
        for s in subs:
            status_counts[s.status.value] = status_counts.get(s.status.value, 0) + 1
            if s.status.value == "approved" and len(recent) < 10:
                recent.append({
                    "id": s.id,
                    "human_id": s.human_id,
                    "route": f"{s.payload.source_location_name} → {s.payload.destination_location_name}",
                    "mission_file": s.payload.mission_filename,
                    "created_at": s.created_at,
                })
        result["submission_statuses"] = status_counts
        result["recent_approved"] = recent

        # Find last PIPELINE_COMPLETE audit for db_last_sync
        for s in subs:
            if s.workflow_state == "PIPELINE_COMPLETE":
                result["db_last_sync_at"] = s.updated_at or s.created_at
                result["db_last_sync_by"] = getattr(s, 'approved_by_name', None) or getattr(s, 'db_updated_by_name', None)
                break
    except Exception as e:
        logger.warning("Stats: failed to read submissions: %s", e)

    return result


@app.get("/submissions/{submission_id}/pipeline-status")
async def get_pipeline_status(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(get_current_user)):
    """Return current pipeline step/status for live UI polling during approval."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    return {
        "submission_id": submission_id,
        "status": sub.status.value,
        "download_status": sub.download_status.value,
        "error_detail": sub.error_detail,
    }


# ── CONFIG ENDPOINT ─────────────────────────────────────────────────────────

@app.get("/config/cesium-token")
async def get_cesium_token(settings: Settings = Depends(get_settings), user: dict = Depends(get_current_user)):
    """Return the Cesium Ion token for the frontend."""
    return {"token": settings.CESIUM_ION_TOKEN}


# ── DRAFTS (Phase 4) ────────────────────────────────────────────────────────

class DraftSaveRequest(BaseModel):
    payload_json: str
    submission_type: str = "NEW_ROUTE"
    draft_id: Optional[str] = None
    parent_submission_id: Optional[str] = None
    label: Optional[str] = None


@app.post("/drafts", response_model=dict)
async def save_draft(
    body: DraftSaveRequest,
    store: SubmissionStore = Depends(get_store),
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(require_role('operator')),
):
    """Save or update a draft submission."""
    draft_id = store.save_draft(
        user_uid=user['uid'],
        payload_json=body.payload_json,
        submission_type=body.submission_type,
        draft_id=body.draft_id,
        parent_submission_id=body.parent_submission_id,
        label=body.label,
    )
    audit_store.add_record(
        draft_id,
        AuditActionType.DRAFT_SAVED,
        performed_by_uid=user['uid'],
        performed_by_name=user.get('display_name', user['email']),
        performed_by_role=user.get('role', 'operator'),
    )
    return {"draft_id": draft_id}


@app.get("/drafts", response_model=List[DraftResponse])
async def list_drafts(
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator')),
):
    """List all drafts for the current user."""
    return store.get_drafts_by_user(user['uid'])


@app.get("/drafts/{draft_id}", response_model=DraftResponse)
async def get_draft(
    draft_id: str,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator')),
):
    """Get a specific draft by ID."""
    draft = store.get_draft(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by_uid != user['uid']:
        raise HTTPException(status_code=403, detail="Not your draft")
    return draft


@app.delete("/drafts/{draft_id}")
async def delete_draft(
    draft_id: str,
    store: SubmissionStore = Depends(get_store),
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(require_role('operator')),
):
    """Soft-delete a draft."""
    draft = store.get_draft(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.created_by_uid != user['uid']:
        raise HTTPException(status_code=403, detail="Not your draft")
    store.delete_draft(draft_id, user['uid'])
    audit_store.add_record(
        draft_id,
        AuditActionType.DRAFT_DELETED,
        performed_by_uid=user['uid'],
        performed_by_name=user.get('display_name', user['email']),
        performed_by_role=user.get('role', 'operator'),
    )
    return {"status": "deleted"}


# ── RESUBMISSION HYDRATION ──────────────────────────────────────────────────

@app.get("/submissions/{submission_id}/resubmit-data")
async def get_resubmit_data(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator')),
):
    """Hydration endpoint: returns a rejected submission's payload for resubmission."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status != SubmissionStatus.REJECTED:
        raise HTTPException(status_code=400, detail="Only rejected submissions can be resubmitted")
    return {
        "parent_submission_id": submission_id,
        "submission_type": sub.submission_type,
        "payload": sub.payload.model_dump(),
        "changed_fields": sub.changed_fields,
        "rejection_reason": sub.rejection_reason,
    }


@app.get("/stats/team-activity")
async def get_team_activity_stats(
    audit_store: AuditStore = Depends(get_audit_store),
    user: dict = Depends(require_role('reviewer')),
):
    """Return team-wide activity stats for the dashboard."""
    return audit_store.get_team_activity()


@app.get("/network-map")
async def get_network_map(
    settings: Settings = Depends(get_settings),
    store: SubmissionStore = Depends(get_store),
    user: dict = Depends(require_role('operator')),
):
    """Return hub-node route groups and locations for the network map."""
    flights_db = settings.instance_dir / "flights.db"
    
    route_groups = {}
    locations = []
    lzs = []
    pending_submissions = []

    if flights_db.exists():
        conn = sqlite3.connect(flights_db)
        conn.row_factory = sqlite3.Row
        location_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(locations)").fetchall()
        }
        if "location_type" in location_columns:
            location_type_expr = "l.location_type"
        elif "location_type_id" in location_columns:
            # Legacy/newer DB schema stores type by id (2 = HUB, others as NODE).
            location_type_expr = "CASE WHEN l.location_type_id = 2 THEN 'HUB' ELSE 'NODE' END"
        else:
            location_type_expr = "'NODE'"
        
        # Get all locations and map type
        loc_rows = conn.execute(f"""
            SELECT l.id, l.name, l.code, {location_type_expr} as location_type,
                   AVG(lz.latitude) as latitude, AVG(lz.longitude) as longitude
            FROM locations l
            LEFT JOIN landing_zones lz ON lz.location_id = l.id
            GROUP BY l.id, l.name, l.code, {location_type_expr}
        """).fetchall()
        locations = [dict(l) for l in loc_rows]
        loc_type_map = {l['id']: l['location_type'] for l in locations}
        loc_name_map = {l['id']: l['name'] for l in locations}
        
        # Get all LZs
        lz_rows = conn.execute("""
            SELECT lz.id, lz.name, lz.latitude, lz.longitude, l.name as location_name
            FROM landing_zones lz
            JOIN locations l ON lz.location_id = l.id
        """).fetchall()
        lzs = [dict(lz) for lz in lz_rows]

        # Get all routes (Active and Inactive)
        routes_query = """
            SELECT 
                r.id, r.network_id, n.name as network_name,
                r.start_location_id, r.end_location_id,
                lz1.name as start_lz_name, lz2.name as end_lz_name,
                lz1.latitude as start_latitude, lz1.longitude as start_longitude,
                lz2.latitude as end_latitude, lz2.longitude as end_longitude,
                wf.filename as mission_filename, r.status,
                r.takeoff_direction, r.approach_direction
            FROM flight_routes r
            JOIN networks n ON r.network_id = n.id
            JOIN landing_zones lz1 ON r.start_lz_id = lz1.id
            JOIN landing_zones lz2 ON r.end_lz_id = lz2.id
            LEFT JOIN waypoint_files wf ON r.waypoint_file_id = wf.id
        """
        routes_rows = conn.execute(routes_query).fetchall()
        
        # Fetch approved sub snapshots for latest_submission_id & metadata
        # We fetch all approved subs and map them to routes
        approved_subs = []
        for s in store.list_submissions():
            if s.status == SubmissionStatus.APPROVED:
                approved_subs.append(s)
        
        # Mapping: route_id -> latest_approved_sub
        route_to_sub = {}
        for s in approved_subs:
            rid = s.payload.update_for_route_id
            if rid:
                if rid not in route_to_sub or s.created_at > route_to_sub[rid].created_at:
                    route_to_sub[rid] = s
            else:
                # Match by filename
                fname = s.payload.mission_filename
                # We'll match this later during route iteration
        
        for r_row in routes_rows:
            r = dict(r_row)
            sid = r['start_location_id']
            eid = r['end_location_id']
            
            # Identify Hub and Node
            if loc_type_map.get(sid) == 'HUB':
                hub_id, node_id = sid, eid
                direction = "HUB_TO_NODE"
            elif loc_type_map.get(eid) == 'HUB':
                hub_id, node_id = eid, sid
                direction = "NODE_TO_HUB"
            else:
                # Fallback to ID sort if neither/both are hubs
                hub_id, node_id = (sid, eid) if sid < eid else (eid, sid)
                direction = "HUB_TO_NODE" if sid == hub_id else "NODE_TO_HUB"

            group_key = f"{hub_id}-{node_id}"
            if group_key not in route_groups:
                route_groups[group_key] = {
                    "hub_location_id": hub_id,
                    "hub_location_name": loc_name_map.get(hub_id),
                    "node_location_id": node_id,
                    "node_location_name": loc_name_map.get(node_id),
                    "network_id": r['network_id'],
                    "network_name": r['network_name'],
                    "start_latitude": r['start_latitude'], # Reference points for drawing
                    "start_longitude": r['start_longitude'],
                    "end_latitude": r['end_latitude'],
                    "end_longitude": r['end_longitude'],
                    "routes": []
                }
            
            # Variant extraction (L01/L02)
            fname = r['mission_filename'] or ""
            variant = "L01" if fname.startswith("L01_") else "L02" if fname.startswith("L02_") else "Unknown"
            
            # Find latest submission
            latest_sub = route_to_sub.get(r['id'])
            if not latest_sub:
                # Search by filename in approved_subs
                for s in approved_subs:
                    if s.payload.mission_filename == fname:
                        if not latest_sub or s.created_at > latest_sub.created_at:
                            latest_sub = s
            
            route_groups[group_key]["routes"].append({
                "id": r['id'],
                "mission_filename": fname,
                "direction": direction,
                "variant": variant,
                "start_lz_name": r['start_lz_name'],
                "end_lz_name": r['end_lz_name'],
                "start_location_type": loc_type_map.get(sid, 'NODE'),
                "end_location_type": loc_type_map.get(eid, 'NODE'),
                "status": "ACTIVE" if r['status'] == 1 else "INACTIVE",
                "last_updated": latest_sub.created_at if latest_sub else None,
                "last_updated_by": latest_sub.approved_by_name if latest_sub else None,
                "latest_submission_id": latest_sub.id if latest_sub else None,
                "takeoff_direction": r.get('takeoff_direction'),
                "approach_direction": r.get('approach_direction')
            })

        conn.close()

    all_subs = store.list_submissions()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    now = datetime.now(timezone.utc).isoformat()
    
    for sub in all_subs:
        sub_time = datetime.fromisoformat(sub.created_at.replace('Z', '+00:00'))
        if sub.status == SubmissionStatus.PENDING and sub_time >= week_ago:
            pending_submissions.append({
                "id": sub.id,
                "route": f"{sub.payload.source_location_name} → {sub.payload.destination_location_name}",
                "start_latitude": sub.payload.source_latitude,
                "start_longitude": sub.payload.source_longitude,
                "end_latitude": sub.payload.destination_latitude,
                "end_longitude": sub.payload.destination_longitude,
                "created_at": sub.created_at,
                "submitted_by": sub.submitted_by_name
            })

    # Stats: total active routes, hub-node pairs, pending
    total_active = 0
    for group in route_groups.values():
        total_active += sum(1 for r in group['routes'] if r['status'] == 'ACTIVE')

    return {
        "route_groups": list(route_groups.values()),
        "locations": locations,
        "landing_zones": lzs,
        "pending_submissions": pending_submissions,
        "stats": {
            "total_active": total_active,
            "pair_count": len(route_groups),
            "pending_count": len(pending_submissions),
            "last_sync": now
        }
    }


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health(settings: Settings = Depends(get_settings)):
    import httpx
    
    comp_status: dict[str, str] = {}
    
    # Check submissions DB
    try:
        comp_status["submissions_db"] = "ok" if Path(settings.SUBMISSIONS_DB_PATH).exists() else "missing"
    except Exception as e:
        comp_status["submissions_db"] = f"error: {str(e)}"
        
    # Check flights DB
    flights_db = settings.instance_dir / "flights.db"
    try:
        comp_status["flights_db"] = "ok" if flights_db.exists() else "missing"
    except Exception as e:
        comp_status["flights_db"] = f"error: {str(e)}"
        
    # Check Excel
    try:
        comp_status["excel"] = "ok" if settings.excel_path.exists() else "missing"
    except Exception as e:
        comp_status["excel"] = f"error: {str(e)}"
        
    return {
        "status": "ok",
        "service": "redwing-db-automation",
        "components": comp_status
    }


# ── 15. Route Tracker — AUTHORITATIVE LOG ─────────────────────────────────────

@app.get("/route-tracker")
async def get_route_tracker(
    event_type: Optional[str] = None,
    network_id: Optional[int] = None,
    days: Optional[int] = None,
    search: Optional[str] = None,
    _auth: dict = Depends(require_role('sde')),
    audit_store: AuditStore = Depends(get_audit_store),
    settings: Settings = Depends(get_settings)
):
    """AUTHORITATIVE log of flights.db updates (PIPELINE_COMPLETE)."""
    return audit_store.get_route_tracker_data(
        submissions_db_path=settings.SUBMISSIONS_DB_PATH,
        event_type=event_type,
        network_id=network_id,
        days=days,
        search=search
    )


# Backwards-compatible Admin aliases for spec-compliant endpoints

@app.patch("/admin/users/{uid}/role")
async def patch_admin_user_role(
    uid: str,
    body: dict,
    _auth: dict = Depends(require_role('admin')),
):
    """Update only the user's role (Admin only). Convenience wrapper."""
    import auth as auth_helper
    new_role = body.get("role")
    if not new_role:
        raise HTTPException(status_code=400, detail="Missing 'role' in body")
    auth_helper.update_user_info(uid, {"role": new_role})
    return {"status": "success"}


@app.patch("/admin/users/{uid}/deactivate")
async def deactivate_admin_user(
    uid: str,
    body: Optional[dict] = None,
    _auth: dict = Depends(require_role('admin')),
):
    """Deactivate a user account without deleting it (Admin only)."""
    import auth as auth_helper
    # Display-only convention: status field is used by the frontend to mute rows.
    reason = (body or {}).get("reason")
    updates = {"status": "Inactive"}
    if reason:
        updates["deactivation_reason"] = reason
    auth_helper.update_user_info(uid, updates)
    return {"status": "success"}


@app.get("/admin/audit")
async def get_admin_audit_alias(
    page: int = 1,
    limit: int = 50,
    action_type: Optional[str] = None,
    uid: Optional[str] = None,
    days: Optional[int] = None,
    _auth: dict = Depends(require_role('admin')),
    audit_store: AuditStore = Depends(get_audit_store)
):
    """Alias for /admin/audit-log to match spec."""
    return audit_store.get_all_audit_paginated(
        page=page,
        limit=limit,
        action_type=action_type,
        uid=uid,
        days=days
    )


@app.get("/admin/audit/export")
async def export_admin_audit_alias(
    _auth: dict = Depends(require_role('admin')),
    audit_store: AuditStore = Depends(get_audit_store)
):
    """Alias for /admin/audit-log/export to match spec."""
    return await export_admin_audit_log(_auth=_auth, audit_store=audit_store)


# ── 16. Admin Control Panel ───────────────────────────────────────────────────

@app.get("/admin/users")
async def get_admin_users(
    _auth: dict = Depends(require_role('admin')),
):
    """List all users from Auth and Firestore (Admin only)."""
    import auth as auth_helper
    return auth_helper.get_all_users_info()


@app.patch("/admin/users/{uid}")
async def patch_admin_user(
    uid: str,
    updates: dict,
    _auth: dict = Depends(require_role('admin')),
):
    """Update user role, status (deactivate), or flags (Admin only)."""
    import auth as auth_helper
    auth_helper.update_user_info(uid, updates)
    return {"status": "success"}


@app.get("/admin/feature-visibility")
async def get_admin_feature_visibility(
    _auth: dict = Depends(require_role('admin')),
):
    """Fetch feature visibility matrix (Admin only)."""
    import auth as auth_helper
    return auth_helper.get_feature_visibility()


@app.patch("/admin/feature-visibility/{feature_id}")
async def patch_admin_feature_visibility(
    feature_id: str,
    updates: dict,
    _auth: dict = Depends(require_role('admin')),
):
    """Update feature visibility matrix (Admin only)."""
    import auth as auth_helper
    auth_helper.update_feature_visibility(feature_id, updates)
    return {"status": "success"}


@app.get("/admin/audit-log")
async def get_admin_audit_log(
    page: int = 1,
    limit: int = 50,
    action_type: Optional[str] = None,
    uid: Optional[str] = None,
    days: Optional[int] = None,
    _auth: dict = Depends(require_role('admin')),
    audit_store: AuditStore = Depends(get_audit_store)
):
    """Full system audit log viewer (Admin only)."""
    return audit_store.get_all_audit_paginated(
        page=page,
        limit=limit,
        action_type=action_type,
        uid=uid,
        days=days
    )


@app.get("/admin/audit-log/export")
async def export_admin_audit_log(
    _auth: dict = Depends(require_role('admin')),
    audit_store: AuditStore = Depends(get_audit_store)
):
    """Export full audit log to CSV for external auditing."""
    import csv
    import io
    from fastapi.responses import StreamingResponse
    import json

    rows = audit_store.get_all_audit_for_export()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp (UTC)", "Action", "User", "Submission ID", "Details"])
    
    for row in rows:
        meta = row["metadata"]
        memo = ""
        if meta:
            try:
                m_obj = json.loads(meta) if isinstance(meta, str) else meta
                memo = m_obj.get("memo", str(meta))
            except:
                memo = str(meta)
        
        writer.writerow([
            row["timestamp_utc"],
            row["action_type"],
            row["performed_by_name"],
            row["submission_id"] or "System",
            memo
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=redwing_audit_log.csv"}
    )
