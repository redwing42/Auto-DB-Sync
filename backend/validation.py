"""Shared submission validation for RedWing DB Automation.

Used by both POST /webhook/new-submission (Google Form) and
POST /submissions (UI) to validate payloads before storing.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

import httpx

from models import SubmissionPayload

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

# India bounding box (generous)
LAT_MIN, LAT_MAX = 6.0, 38.0
LNG_MIN, LNG_MAX = 68.0, 98.0

ALTITUDE_MIN = 0
ALTITUDE_MAX = 1200

DIRECTION_WARN_MIN = 30
DIRECTION_WARN_MAX = 330

NEAR_DUPLICATE_THRESHOLD = 0.001  # ~111m


@dataclass
class ValidationResult:
    """Result of validating a submission payload."""
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0


# ── Core Validation ──────────────────────────────────────────────────────────

def validate_submission(payload: SubmissionPayload) -> ValidationResult:
    """Run all validation checks on a submission payload.

    Returns ValidationResult with errors (blocking) and warnings (non-blocking).
    """
    result = ValidationResult()

    _validate_coordinates(payload, result)
    _validate_directions(payload, result)
    _validate_filename(payload, result)
    _validate_drive_links(payload, result)

    return result


def _validate_coordinates(payload: SubmissionPayload, result: ValidationResult) -> None:
    """Check that coordinates are non-zero and within India bounding box."""
    coords = [
        ("Source", payload.source_latitude, payload.source_longitude),
        ("Destination", payload.destination_latitude, payload.destination_longitude),
    ]
    for label, lat, lng in coords:
        if lat == 0 and lng == 0:
            result.errors.append(f"{label} coordinates are (0, 0) — likely missing data")
        elif not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
            result.warnings.append(
                f"{label} coordinates ({lat}, {lng}) are outside India bounding box"
            )


def _validate_directions(payload: SubmissionPayload, result: ValidationResult) -> None:
    """Warn if takeoff and approach directions are too close or nearly opposite."""
    diff = abs(payload.takeoff_direction - payload.approach_direction) % 360
    if diff < DIRECTION_WARN_MIN or diff > DIRECTION_WARN_MAX:
        result.warnings.append(
            f"Takeoff ({payload.takeoff_direction}°) and approach ({payload.approach_direction}°) "
            f"directions differ by only {diff}° — verify this is intentional"
        )


def _validate_filename(payload: SubmissionPayload, result: ValidationResult) -> None:
    """Validate the mission filename format."""
    if not payload.mission_filename:
        result.errors.append("Mission filename is empty")
    elif not payload.mission_filename.strip().endswith(".waypoints"):
        result.errors.append(
            f"Mission filename must end with .waypoints, got: {payload.mission_filename}"
        )


def _validate_drive_links(payload: SubmissionPayload, result: ValidationResult) -> None:
    """Validate Drive link format (extractable file ID)."""
    drive_link_pattern = re.compile(
        r"(?:/file/d/|id=|/open\?id=)([a-zA-Z0-9_-]+)|^([a-zA-Z0-9_-]{20,})$"
    )
    links = [
        ("Mission file", payload.mission_drive_link, True),
        ("Elevation image", payload.elevation_image_drive_link, False),
        ("Route image", payload.route_image_drive_link, False),
    ]
    for label, link, required in links:
        if not link:
            if required:
                result.errors.append(f"{label} Drive link is empty")
            continue
        if not drive_link_pattern.search(link):
            result.errors.append(
                f"{label} Drive link does not contain a valid Google Drive file ID"
            )


# ── Drive Link Accessibility Check (server-side) ────────────────────────────

async def validate_drive_link_accessible(drive_link: str, label: str = "File") -> Optional[str]:
    """Ping a Google Drive link to check if it's accessible.

    Uses the GNOME OAuth token (same auth as drive_downloader) for
    authenticated access to private/shared Drive files.

    Returns an error string if inaccessible, None if OK.
    """
    from drive_downloader import get_gnome_oauth_token
    from config import Settings

    # Extract file ID
    match = re.search(
        r"(?:/file/d/|id=|/open\?id=)([a-zA-Z0-9_-]+)", drive_link
    )
    if not match:
        return f"{label}: Could not extract file ID from link"

    file_id = match.group(1)
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?fields=id,name&supportsAllDrives=true"

    # Get authenticated token
    settings = Settings()
    token = get_gnome_oauth_token(settings.GNOME_GOA_ACCOUNT_PATH)

    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return None
            elif resp.status_code == 404:
                return f"{label}: File not found on Google Drive"
            elif resp.status_code == 403:
                return f"{label}: Access denied — file is not shared with this account"
            else:
                return f"{label}: Drive returned HTTP {resp.status_code}"
    except Exception as e:
        return f"{label}: Could not reach Google Drive — {e}"


async def validate_all_drive_links(payload: SubmissionPayload) -> List[str]:
    """Check accessibility of all Drive links in a payload.

    Returns a list of error strings (empty if all OK).
    """
    errors = []
    checks = [
        (payload.mission_drive_link, "Mission file"),
    ]
    # Only check image links if provided
    if payload.elevation_image_drive_link:
        checks.append((payload.elevation_image_drive_link, "Elevation image"))
    if payload.route_image_drive_link:
        checks.append((payload.route_image_drive_link, "Route image"))

    for link, label in checks:
        err = await validate_drive_link_accessible(link, label)
        if err:
            errors.append(err)

    return errors
