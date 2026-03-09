"""Google Drive file downloader for RedWing DB Automation.

Downloads files from shared Google Drive links without needing API credentials.
Converts share URLs to direct download URLs and streams to disk.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

import httpx

from models import DownloadResult, SubmissionPayload

logger = logging.getLogger(__name__)


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


async def download_file(drive_link: str, dest_path: Path) -> Path:
    """Download a file from Google Drive to the given destination path.

    Args:
        drive_link: Google Drive share URL.
        dest_path: Local file path to save to.

    Returns:
        The destination Path on success.

    Raises:
        ValueError: If the drive link is invalid.
        httpx.HTTPStatusError: If the download fails.
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
            # Extract confirm token
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
                    # Check if the first chunk looks like HTML (Google login pages start with <!doctype html> or <html)
                    if chunk.startswith(b"<!doctype html") or chunk.startswith(b"<html"):
                        raise ValueError("File is restricted or requires login. Ensure the link is shared as 'Anyone with the link'.")
                    first_chunk = False
                f.write(chunk)

    logger.info(f"Downloaded {drive_link} → {dest_path}")
    return dest_path


def get_mission_stem(mission_filename: str) -> str:
    """Get filename without extension (e.g., 'HQ-DEMO-180m.waypoints' → 'HQ-DEMO-180m')."""
    return Path(mission_filename).stem


async def download_submission_files(
    payload: SubmissionPayload,
    repo_path: Path,
) -> DownloadResult:
    """Download all files for a submission (waypoints + images).

    Args:
        payload: The submission payload with Drive links.
        repo_path: Path to the RedWing repo.

    Returns:
        DownloadResult with file paths or error.
    """
    missions_dir = repo_path / "missions"
    images_dir = repo_path / "frontend" / "public" / "Elevation and flight routes"
    stem = get_mission_stem(payload.mission_filename)

    mission_path = missions_dir / payload.mission_filename
    elevation_path = images_dir / f"{stem} elevation graph.png"
    route_path = images_dir / f"{stem} flight route.png"

    try:
        # Download mission file
        await download_file(payload.mission_drive_link, mission_path)

        # Download elevation graph image (if link is provided)
        if (payload.elevation_image_drive_link):
            await download_file(payload.elevation_image_drive_link, elevation_path)

        # Download flight route image (if link is provided)
        if (payload.route_image_drive_link):
            await download_file(payload.route_image_drive_link, route_path)

        return DownloadResult(
            success=True,
            mission_file_path=str(mission_path),
            elevation_image_path=str(elevation_path),
            route_image_path=str(route_path),
        )
    except Exception as e:
        logger.exception("File download failed")
        return DownloadResult(success=False, error=str(e))
