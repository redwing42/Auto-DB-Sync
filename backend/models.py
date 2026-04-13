"""Pydantic models for RedWing DB Automation."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────────────

class SubmissionType(str, enum.Enum):
    NEW_ROUTE = "NEW_ROUTE"
    UPDATE = "UPDATE"


class SubmissionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"
    DUPLICATE = "duplicate"


class WorkflowState(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    FILES_DOWNLOADED = "FILES_DOWNLOADED"
    WAYPOINT_VERIFIED = "WAYPOINT_VERIFIED"
    ID_RESOLUTION_CONFIRMED = "ID_RESOLUTION_CONFIRMED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RESUBMITTED = "RESUBMITTED"
    PIPELINE_RUNNING = "PIPELINE_RUNNING"
    PIPELINE_COMPLETE = "PIPELINE_COMPLETE"
    PIPELINE_FAILED = "PIPELINE_FAILED"


class AuditActionType(str, enum.Enum):
    SUBMISSION_CREATED = "SUBMISSION_CREATED"
    DRAFT_SAVED = "DRAFT_SAVED"
    DRAFT_DELETED = "DRAFT_DELETED"
    GATE1_PASSED = "GATE1_PASSED"
    GATE1_FAILED = "GATE1_FAILED"
    GATE2_CONFIRMED = "GATE2_CONFIRMED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RESUBMITTED = "RESUBMITTED"
    PIPELINE_STEP_COMPLETE = "PIPELINE_STEP_COMPLETE"
    PIPELINE_STEP_FAILED = "PIPELINE_STEP_FAILED"
    PIPELINE_COMPLETE = "PIPELINE_COMPLETE"
    PIPELINE_FAILED = "PIPELINE_FAILED"
    PIPELINE_STEP_RETRIED = "PIPELINE_STEP_RETRIED"
    EMAIL_FAILED = "EMAIL_FAILED"
    BRANCH_CREATED = "BRANCH_CREATED"


class EntityAction(str, enum.Enum):
    EXISTING = "existing"
    NEW = "new"
    NOT_FOUND = "not_found"


class DownloadStatus(str, enum.Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Submission Payload (from Google Form webhook) ────────────────────────────

class SubmissionPayload(BaseModel):
    network_name: str
    source_location_name: str
    source_takeoff_zone_name: str
    source_latitude: float
    source_longitude: float
    destination_location_name: str
    destination_landing_zone_name: str
    destination_latitude: float
    destination_longitude: float
    takeoff_direction: int
    approach_direction: int
    mission_filename: str
    mission_drive_link: str
    elevation_image_drive_link: str
    route_image_drive_link: str
    is_update: bool = False
    update_for_route_id: Optional[int] = None


class UpdateSubmissionPayload(SubmissionPayload):
    """Extended payload for route update submissions with field-level diffing."""
    submission_type: str = "UPDATE"
    changed_fields: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description='{ "field_name": { "old": "val1", "new": "val2" } }',
    )
    parent_submission_id: Optional[str] = None

# ── Submission Response ──────────────────────────────────────────────────────

class SubmissionResponse(BaseModel):
    id: str
    payload: SubmissionPayload
    status: SubmissionStatus
    download_status: DownloadStatus = DownloadStatus.NOT_STARTED
    error_detail: Optional[str] = None
    created_at: str
    downloaded_files: Optional[Dict[str, str]] = None
    files_downloaded: bool = False
    waypoint_verified: bool = False
    id_resolution_reviewed: bool = False
    source: str = "webhook"
    # Phase 3 fields
    workflow_state: str = "SUBMITTED"
    submitted_by_uid: Optional[str] = None
    submitted_by_name: Optional[str] = None
    submitted_by_role: Optional[str] = None
    branch_name: Optional[str] = None
    rejection_reason: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    verified_by_name: Optional[str] = None
    validated_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    db_updated_by_name: Optional[str] = None
    human_id: str = ""
    viewed_by_name: Optional[str] = None
    # Phase 4 fields
    submission_type: str = "NEW_ROUTE"
    changed_fields: Optional[Dict[str, Dict[str, Any]]] = None
    parent_submission_id: Optional[str] = None


# ── Draft Response ───────────────────────────────────────────────────────────

class DraftResponse(BaseModel):
    id: str
    submission_type: str = "NEW_ROUTE"
    payload_json: str  # Serialized partial payload
    created_at: str
    updated_at: Optional[str] = None
    created_by_uid: str
    parent_submission_id: Optional[str] = None
    label: str = "Untitled Draft"


# ── Status Update ────────────────────────────────────────────────────────────

class StatusUpdateRequest(BaseModel):
    status: SubmissionStatus
    reason: Optional[str] = None


class ReviewStateUpdateRequest(BaseModel):
    waypoint_verified: Optional[bool] = None
    id_resolution_reviewed: Optional[bool] = None


class SubmissionPayloadUpdateRequest(BaseModel):
    network_name: Optional[str] = None
    source_location_name: Optional[str] = None
    source_takeoff_zone_name: Optional[str] = None
    source_latitude: Optional[float] = None
    source_longitude: Optional[float] = None
    destination_location_name: Optional[str] = None
    destination_landing_zone_name: Optional[str] = None
    destination_latitude: Optional[float] = None
    destination_longitude: Optional[float] = None


# ── Approval Request (with confirmation gate) ───────────────────────────────

class ConfirmedNewEntities(BaseModel):
    source_location: bool = False
    source_lz: bool = False
    destination_location: bool = False
    destination_lz: bool = False


class ApprovalRequest(BaseModel):
    confirmed_new_entities: ConfirmedNewEntities


# ── Resolve Preview ─────────────────────────────────────────────────────────

class EntityPreview(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    action: EntityAction


class ResolvePreviewResponse(BaseModel):
    network: EntityPreview
    source_location: EntityPreview
    source_lz: EntityPreview
    destination_location: EntityPreview
    destination_lz: EntityPreview
    waypoint_file: EntityPreview
    flight_route: EntityPreview
    warnings: List[str] = Field(default_factory=list)


# ── Waypoint Data ───────────────────────────────────────────────────────────

class WaypointData(BaseModel):
    index: int
    current_wp: int
    coord_frame: int
    coord_frame_name: str
    command: int
    command_name: str
    param1: float
    param2: float
    param3: float
    param4: float
    latitude: float
    longitude: float
    altitude: float
    autocontinue: int
    is_nav_command: bool
    is_action_command: bool


class WaypointFileResponse(BaseModel):
    mission_filename: str
    waypoints: List[WaypointData]
    total_waypoints: int


# ── Pipeline Result ─────────────────────────────────────────────────────────

class PipelineResult(BaseModel):
    success: bool
    submission_id: str
    network_id: Optional[int] = None
    source_location_id: Optional[int] = None
    source_lz_id: Optional[int] = None
    destination_location_id: Optional[int] = None
    destination_lz_id: Optional[int] = None
    waypoint_file_id: Optional[int] = None
    flight_route_id: Optional[int] = None
    error_step: Optional[int] = None
    error_detail: Optional[str] = None
    git_output: Optional[str] = None


# ── Download Result ─────────────────────────────────────────────────────────

class DownloadResult(BaseModel):
    success: bool
    mission_file_path: Optional[str] = None
    elevation_image_path: Optional[str] = None
    route_image_path: Optional[str] = None
    error: Optional[str] = None


# ── Validation Result ───────────────────────────────────────────────────────

class ValidationResponse(BaseModel):
    is_valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    drive_link_errors: List[str] = Field(default_factory=list)


# ── Network & Route Info (from flights.db) ──────────────────────────────────

class NetworkInfo(BaseModel):
    id: int
    name: str
    route_count: int = 0


class LocationInfo(BaseModel):
    id: int
    name: str
    code: Optional[str] = None
    landing_zone_count: Optional[int] = 0


class LandingZoneInfo(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    location_id: int
    location_name: str


class RouteInfo(BaseModel):
    id: int
    network_id: int
    start_location_name: str
    end_location_name: str
    start_lz_name: str
    end_lz_name: str
    start_latitude: float
    start_longitude: float
    end_latitude: float
    end_longitude: float
    takeoff_direction: int
    approach_direction: int
    mission_filename: Optional[str] = None
    status: Optional[int] = None


class DuplicateCheckResponse(BaseModel):
    is_exact_duplicate: bool = False
    is_near_duplicate: bool = False
    exact_match_id: Optional[str] = None
    near_matches: List[Dict[str, Any]] = Field(default_factory=list)
    message: str = ""


class AuditRecord(BaseModel):
    id: str
    submission_id: str
    action_type: str
    performed_by_uid: Optional[str] = None
    performed_by_name: Optional[str] = None
    performed_by_role: Optional[str] = None
    timestamp_utc: str
    metadata: Optional[Dict[str, Any]] = None
