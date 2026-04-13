"""Google Drive file downloader for RedWing DB Automation.

Downloads files from Google Drive using authenticated access via GNOME
Online Accounts.  Falls back to unauthenticated public-link downloads
when a token is unavailable.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Optional

import httpx

from auth_utils import get_gnome_oauth_token
from models import DownloadResult, SubmissionPayload

logger = logging.getLogger(__name__)

# ── Google Drive Client ──────────────────────────────────────────────────



# ── Drive API Search ─────────────────────────────────────────────────────────


async def search_drive_by_name(
    filename: str, token: str
) -> Optional[str]:
    """Search Google Drive for a file by exact name.

    Uses Drive API v3 with ``includeItemsFromAllDrives`` so it finds files
    in Shared Drives and "Shared with me" as well.

    Returns:
        The file ID if found, else None.
    """
    url = "https://www.googleapis.com/drive/v3/files"
    params = {
        "q": f"name='{filename}' and trashed=false",
        "fields": "files(id,name)",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
        "corpora": "allDrives",
    }
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params=params, headers=headers)
        response.raise_for_status()
        data = response.json()

    files = data.get("files", [])
    if files:
        file_id = files[0]["id"]
        logger.info("Drive API: found '%s' → id=%s", filename, file_id)
        return file_id

    logger.warning("Drive API: '%s' not found", filename)
    return None


# ── File ID Extraction ───────────────────────────────────────────────────────


def extract_file_id(drive_link: str) -> Optional[str]:
    """Extract file ID from various Google Drive URL formats."""
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",       # /file/d/FILEID/...
        r"id=([a-zA-Z0-9_-]+)",             # ?id=FILEID
        r"/open\?id=([a-zA-Z0-9_-]+)",      # /open?id=FILEID
        r"^([a-zA-Z0-9_-]{20,})$",          # bare file ID
    ]
    for pattern in patterns:
        match = re.search(pattern, drive_link)
        if match:
            return match.group(1)
    return None


def build_direct_download_url(file_id: str) -> str:
    """Build direct download URL from Google Drive file ID."""
    return f"https://drive.google.com/uc?export=download&id={file_id}"


# ── Authenticated Download ───────────────────────────────────────────────────


async def download_file_authenticated(
    file_id: str, dest_path: Path, token: str
) -> Path:
    """Download a file from Google Drive using Drive API v3 with auth.

    This bypasses sharing restrictions — any file the GNOME account can
    access will download successfully.

    Args:
        file_id: Google Drive file ID.
        dest_path: Local file path to save to.
        token: OAuth2 access token.

    Returns:
        The destination Path on success.
    """
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}"
    params = {"alt": "media", "supportsAllDrives": "true"}
    headers = {"Authorization": f"Bearer {token}"}

    dest_path.parent.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
        async with client.stream("GET", url, params=params, headers=headers) as response:
            response.raise_for_status()
            with open(dest_path, "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)

    logger.info("Downloaded (authenticated) file_id=%s → %s", file_id, dest_path)
    return dest_path


# ── Unauthenticated Download (legacy fallback) ──────────────────────────────


async def download_file(drive_link: str, dest_path: Path) -> Path:
    """Download a file from Google Drive via public share link (no auth).

    Args:
        drive_link: Google Drive share URL.
        dest_path: Local file path to save to.

    Returns:
        The destination Path on success.

    Raises:
        ValueError: If the drive link is invalid or the file requires login.
    """
    file_id = extract_file_id(drive_link)
    if not file_id:
        raise ValueError(f"Could not extract file ID from Drive link: {drive_link}")

    url = build_direct_download_url(file_id)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
        # First request — may get a virus-scan warning page for large files
        response = await client.get(url)
        response.raise_for_status()

        # Check if we got a confirmation page (large file warning)
        if b"confirm=" in response.content and b"download" in response.content:
            confirm_match = re.search(
                r"confirm=([a-zA-Z0-9_-]+)", response.text
            )
            if confirm_match:
                confirm_url = f"{url}&confirm={confirm_match.group(1)}"
                response = await client.get(confirm_url)
                response.raise_for_status()

        with open(dest_path, "wb") as f:
            first_chunk = True
            async for chunk in response.aiter_bytes():
                if first_chunk:
                    if chunk.startswith(b"<!doctype html") or chunk.startswith(b"<html"):
                        raise ValueError(
                            "File is restricted or requires login. "
                            "Ensure the link is shared as 'Anyone with the link'."
                        )
                    first_chunk = False
                f.write(chunk)

    logger.info("Downloaded %s → %s", drive_link, dest_path)
    return dest_path


# ── Helpers ──────────────────────────────────────────────────────────────────


def get_mission_stem(mission_filename: str) -> str:
    """Get filename without extension (e.g., 'HQ-DEMO-180m.waypoints' → 'HQ-DEMO-180m')."""
    return Path(mission_filename).stem


# ── Main Download Orchestrator ───────────────────────────────────────────────


async def download_submission_files(
    payload: SubmissionPayload,
    repo_path: Path,
    goa_account_path: str = "/org/gnome/OnlineAccounts/Accounts/account_1773050616_0",
) -> DownloadResult:
    """Download all files for a submission (waypoints + images).

    Strategy:
      1. Try authenticated download via GNOME OAuth + Drive API (search by name).
      2. If that fails, fall back to unauthenticated public-link download.

    Args:
        payload: The submission payload with Drive links.
        repo_path: Path to the RedWing repo.
        goa_account_path: D-Bus path for GNOME Online Account.

    Returns:
        DownloadResult with file paths or error.
    """
    missions_dir = repo_path / "missions"
    images_dir = repo_path / "frontend" / "public" / "Elevation and flight routes"
    stem = get_mission_stem(payload.mission_filename)

    mission_path = missions_dir / payload.mission_filename
    elevation_path = images_dir / f"{stem} elevation graph.png"
    route_path = images_dir / f"{stem} flight route.png"

    # ── Step 1: Get OAuth token ──────────────────────────────────────────
    token = get_gnome_oauth_token(goa_account_path)

    # ── Step 2: Download mission file (required — fatal on failure) ──────
    mission_downloaded = False

    if token:
        try:
            # Try searching by filename first
            file_id = await search_drive_by_name(payload.mission_filename, token)
            if file_id:
                await download_file_authenticated(file_id, mission_path, token)
                mission_downloaded = True
            else:
                # File not found by name — try extracting ID from the link
                file_id = extract_file_id(payload.mission_drive_link)
                if file_id:
                    logger.info("File not found by name, trying link ID: %s", file_id)
                    await download_file_authenticated(file_id, mission_path, token)
                    mission_downloaded = True
        except Exception as e:
            logger.warning("Authenticated download failed, trying unauthenticated: %s", e)

    if not mission_downloaded:
        try:
            await download_file(payload.mission_drive_link, mission_path)
            mission_downloaded = True
        except Exception as e:
            logger.exception("Mission file download failed (all methods)")
            return DownloadResult(success=False, error=str(e))

    # ── Step 3: Download images (optional — non-fatal) ───────────────────
    elevation_result = ""
    route_result = ""

    if payload.elevation_image_drive_link:
        try:
            if token:
                file_id = extract_file_id(payload.elevation_image_drive_link)
                if file_id:
                    await download_file_authenticated(file_id, elevation_path, token)
                    elevation_result = str(elevation_path)
                else:
                    await download_file(payload.elevation_image_drive_link, elevation_path)
                    elevation_result = str(elevation_path)
            else:
                await download_file(payload.elevation_image_drive_link, elevation_path)
                elevation_result = str(elevation_path)
        except Exception as e:
            logger.warning("Elevation image download failed (non-fatal): %s", e)

    if payload.route_image_drive_link:
        try:
            if token:
                file_id = extract_file_id(payload.route_image_drive_link)
                if file_id:
                    await download_file_authenticated(file_id, route_path, token)
                    route_result = str(route_path)
                else:
                    await download_file(payload.route_image_drive_link, route_path)
                    route_result = str(route_path)
            else:
                await download_file(payload.route_image_drive_link, route_path)
                route_result = str(route_path)
        except Exception as e:
            logger.warning("Flight route image download failed (non-fatal): %s", e)

    return DownloadResult(
        success=True,
        mission_file_path=str(mission_path),
        elevation_image_path=elevation_result,
        route_image_path=route_result,
    )
