"""Mission Planner waypoint file parser for RedWing DB Automation.

Parses .waypoints files in the QGroundControl WPL 1.1 format.
Each line (after the header) is tab-separated with columns:
  index, current_wp, coord_frame, command, param1, param2, param3, param4,
  latitude, longitude, altitude, autocontinue
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from models import WaypointData, WaypointFileResponse

EXPECTED_HEADER = "QGC WPL 110"
EXPECTED_COLUMN_COUNT = 12


class WaypointParseError(Exception):
    """Raised when a .waypoints file cannot be parsed."""
    pass


def parse_waypoints_file(filepath: Path) -> WaypointFileResponse:
    """Parse a Mission Planner waypoint file and return structured data.

    Args:
        filepath: Path to the .waypoints file.

    Returns:
        WaypointFileResponse with all parsed waypoints.

    Raises:
        WaypointParseError: If the file is malformed.
        FileNotFoundError: If the file does not exist.
    """
    if not filepath.exists():
        raise FileNotFoundError(f"Waypoint file not found: {filepath}")

    text = filepath.read_text(encoding="utf-8").strip()
    if not text:
        raise WaypointParseError("Waypoint file is empty")

    lines = text.splitlines()

    # Validate header
    header = lines[0].strip()
    if header != EXPECTED_HEADER:
        raise WaypointParseError(
            f"Invalid header: expected '{EXPECTED_HEADER}', got '{header}'"
        )

    waypoints: List[WaypointData] = []

    for line_num, line in enumerate(lines[1:], start=2):
        line = line.strip()
        if not line:
            continue  # skip blank lines

        parts = line.split("\t")
        if len(parts) != EXPECTED_COLUMN_COUNT:
            raise WaypointParseError(
                f"Line {line_num}: expected {EXPECTED_COLUMN_COUNT} columns, "
                f"got {len(parts)}"
            )

        try:
            wp = WaypointData(
                index=int(parts[0]),
                current_wp=int(parts[1]),
                coord_frame=int(parts[2]),
                command=int(parts[3]),
                param1=float(parts[4]),
                param2=float(parts[5]),
                param3=float(parts[6]),
                param4=float(parts[7]),
                latitude=float(parts[8]),
                longitude=float(parts[9]),
                altitude=float(parts[10]),
                autocontinue=int(parts[11]),
            )
            waypoints.append(wp)
        except (ValueError, IndexError) as e:
            raise WaypointParseError(
                f"Line {line_num}: could not parse values — {e}"
            )

    return WaypointFileResponse(
        mission_filename=filepath.name,
        waypoints=waypoints,
        total_waypoints=len(waypoints),
    )
