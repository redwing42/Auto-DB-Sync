"""Server-side waypoint file content validator.

Validates .waypoints file content against RedWing standards:
  - QGC WPL 1.1 format header
  - Must contain VTOL_TAKEOFF (cmd 84) command
  - Must contain VTOL_LAND (cmd 85) or DO_LAND_START (cmd 218)
  - No (0,0) coordinates on navigation commands
  - Altitudes within 0–1200m range
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

EXPECTED_HEADER = "QGC WPL 110"
EXPECTED_COLUMNS = 12

# MAVLink command IDs
CMD_VTOL_TAKEOFF = 84
CMD_VTOL_LAND = 85
CMD_DO_LAND_START = 218
CMD_LAND = 21

# Navigation commands that should have valid coords
NAV_COMMANDS = {16, 17, 18, 19, 20, 21, 22, 23, 24, 84, 85, 93, 177, 189}

ALTITUDE_MIN = 0
ALTITUDE_MAX = 1200


@dataclass
class WaypointValidationResult:
    """Result of validating a .waypoints file."""
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0


def validate_waypoint_content(content: str) -> WaypointValidationResult:
    """Validate .waypoints file content string.

    Args:
        content: Raw text content of the .waypoints file.

    Returns:
        WaypointValidationResult with errors and warnings.
    """
    result = WaypointValidationResult()

    if not content or not content.strip():
        result.errors.append("Waypoint file is empty")
        return result

    lines = content.strip().splitlines()

    # ── Header check ─────────────────────────────────────────────────────
    header = lines[0].strip()
    if header != EXPECTED_HEADER:
        result.errors.append(
            f"Invalid header: expected '{EXPECTED_HEADER}', got '{header}'"
        )
        return result  # Can't parse further if header is wrong

    # ── Parse waypoints ──────────────────────────────────────────────────
    has_vtol_takeoff = False
    has_landing_cmd = False
    zero_coord_lines = []
    altitude_violations = []

    for line_num, line in enumerate(lines[1:], start=2):
        line = line.strip()
        if not line:
            continue

        parts = line.split("\t")
        if len(parts) != EXPECTED_COLUMNS:
            result.errors.append(
                f"Line {line_num}: expected {EXPECTED_COLUMNS} columns, got {len(parts)}"
            )
            continue

        try:
            index = int(parts[0])
            cmd = int(parts[3])
            lat = float(parts[8])
            lng = float(parts[9])
            alt = float(parts[10])
        except (ValueError, IndexError) as e:
            result.errors.append(f"Line {line_num}: could not parse values — {e}")
            continue

        # Track command presence
        if cmd == CMD_VTOL_TAKEOFF:
            has_vtol_takeoff = True
        if cmd in (CMD_VTOL_LAND, CMD_DO_LAND_START, CMD_LAND):
            has_landing_cmd = True

        # Check for (0,0) coordinates on nav commands (skip index 0 home)
        if cmd in NAV_COMMANDS and index > 0:
            if lat == 0.0 and lng == 0.0:
                zero_coord_lines.append(line_num)

        # Altitude check (only on nav commands with non-zero coords)
        if cmd in NAV_COMMANDS and not (lat == 0.0 and lng == 0.0):
            if alt < ALTITUDE_MIN or alt > ALTITUDE_MAX:
                altitude_violations.append(
                    f"Line {line_num} (WP {index}): altitude {alt}m outside {ALTITUDE_MIN}–{ALTITUDE_MAX}m range"
                )

    # ── Aggregate results ────────────────────────────────────────────────
    if not has_vtol_takeoff:
        result.errors.append(
            "Missing VTOL_TAKEOFF (cmd 84) command — required for VTOL operations"
        )

    if not has_landing_cmd:
        result.errors.append(
            "Missing landing command — must have VTOL_LAND (cmd 85), DO_LAND_START (cmd 218), or LAND (cmd 21)"
        )

    if zero_coord_lines:
        result.errors.append(
            f"Found (0,0) coordinates on navigation waypoints at line(s): {', '.join(str(l) for l in zero_coord_lines)}"
        )

    if altitude_violations:
        for v in altitude_violations:
            result.warnings.append(v)

    return result


def validate_waypoint_file(filepath: Path) -> WaypointValidationResult:
    """Validate a .waypoints file from disk.

    Args:
        filepath: Path to the .waypoints file.

    Returns:
        WaypointValidationResult with errors and warnings.
    """
    if not filepath.exists():
        return WaypointValidationResult(errors=[f"File not found: {filepath}"])

    content = filepath.read_text(encoding="utf-8")
    return validate_waypoint_content(content)
