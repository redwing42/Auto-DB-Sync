"""FastAPI application for RedWing DB Automation.

All routes: webhook, submissions CRUD, file downloads, waypoint parsing,
resolve preview, and approval pipeline.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from config import Settings, get_settings
from drive_downloader import download_submission_files
from excel_updater import ExcelUpdater
from models import (
    ApprovalRequest,
    DownloadResult,
    DownloadStatus,
    PipelineResult,
    ResolvePreviewResponse,
    StatusUpdateRequest,
    SubmissionPayload,
    SubmissionResponse,
    SubmissionStatus,
    WaypointFileResponse,
)
from pipeline import run_approval_pipeline
from submission_store import SubmissionStore
from waypoint_parser import parse_waypoints_file

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


# ── Dependencies ─────────────────────────────────────────────────────────────

_store: Optional[SubmissionStore] = None


def get_store() -> SubmissionStore:
    global _store
    if _store is None:
        settings = get_settings()
        _store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    return _store


def init_app() -> None:
    """Initialize the app on startup."""
    settings = get_settings()
    # Ensure submission store is ready
    get_store()
    logger.info("RedWing DB Automation backend started")
    logger.info(f"  Repo path: {settings.repo_path}")
    logger.info(f"  Excel: {settings.excel_path}")


@app.on_event("startup")
async def startup_event():
    init_app()


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

    submission_id = store.add_submission(payload, status=status)
    logger.info(f"New submission received: {submission_id} (Status: {status})")
    return {"submission_id": submission_id, "status": status.value}


# ── 2. SUBMISSIONS API ──────────────────────────────────────────────────────

@app.get("/submissions", response_model=list[SubmissionResponse])
async def list_submissions(store: SubmissionStore = Depends(get_store)):
    """List all submissions with their status."""
    return store.list_submissions()


@app.get("/submissions/{submission_id}", response_model=SubmissionResponse)
async def get_submission(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
):
    """Get full details of one submission."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub


@app.patch("/submissions/{submission_id}/status")
async def update_submission_status(
    submission_id: str,
    body: StatusUpdateRequest,
    store: SubmissionStore = Depends(get_store),
):
    """Update submission status (e.g., reject)."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    if body.status not in (SubmissionStatus.REJECTED, SubmissionStatus.PENDING):
        raise HTTPException(
            status_code=400,
            detail="Can only set status to 'rejected' or 'pending' via this endpoint",
        )

    store.update_status(submission_id, body.status, body.reason)
    return {"submission_id": submission_id, "status": body.status.value}


# ── 3. FILE DOWNLOAD ────────────────────────────────────────────────────────

@app.patch("/submissions/{submission_id}/mark-duplicate", response_model=SubmissionResponse)
async def mark_as_duplicate(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
):
    """Manually flag a submission as a duplicate."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    success = store.update_status(submission_id, SubmissionStatus.DUPLICATE)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update status")
    
    return store.get_submission(submission_id)


@app.post("/submissions/{submission_id}/download-files", response_model=SubmissionResponse)
async def download_files(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
):
    """Download waypoints and image files from Google Drive."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    store.update_download_status(submission_id, DownloadStatus.IN_PROGRESS)

    result = await download_submission_files(sub.payload, settings.repo_path)

    if result.success:
        store.update_download_status(
            submission_id,
            DownloadStatus.COMPLETED,
            {
                "mission_file": result.mission_file_path,
                "elevation_image": result.elevation_image_path,
                "route_image": result.route_image_path,
            },
        )
    else:
        store.update_download_status(submission_id, DownloadStatus.FAILED)

    return result


# ── 4. WAYPOINT DATA ────────────────────────────────────────────────────────

@app.get(
    "/submissions/{submission_id}/waypoint-data",
    response_model=WaypointFileResponse,
)
async def get_waypoint_data(
    submission_id: str,
    store: SubmissionStore = Depends(get_store),
    settings: Settings = Depends(get_settings),
):
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
):
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
    settings: Settings = Depends(get_settings),
):
    """Run the full approval pipeline with confirmation gate."""
    sub = store.get_submission(submission_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    if sub.status == SubmissionStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Submission already approved")

    if sub.status == SubmissionStatus.REJECTED:
        raise HTTPException(status_code=400, detail="Submission was rejected")

    # Run pre-check for confirmations
    if not settings.excel_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Excel file not found: {settings.excel_path}",
        )

    updater = ExcelUpdater(settings.excel_path)
    try:
        updater.open()
        preview = updater.resolve_preview(sub.payload)
    finally:
        updater.close()

    # Validate confirmations
    from pipeline import validate_confirmations

    validation_error = validate_confirmations(preview, body.confirmed_new_entities)
    if validation_error:
        raise HTTPException(status_code=403, detail=validation_error)

    # Run the full pipeline
    result = run_approval_pipeline(submission_id, body, store, settings)

    if not result.success:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline failed at step {result.error_step}: {result.error_detail}",
        )

    return result


# ── CONFIG ENDPOINT ─────────────────────────────────────────────────────────

@app.get("/config/cesium-token")
async def get_cesium_token(settings: Settings = Depends(get_settings)):
    """Return the Cesium Ion token for the frontend."""
    return {"token": settings.CESIUM_ION_TOKEN}


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "redwing-db-automation"}
