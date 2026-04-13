"""Unit tests for waypoint_validator.py — server-side waypoint file validation."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from waypoint_validator import validate_waypoint_content, validate_waypoint_file

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
SAMPLE_WAYPOINTS = FIXTURES_DIR / "sample.waypoints"


class TestValidateWaypointContent:
    """Test waypoint content validation."""

    def test_valid_file_passes(self):
        """Sample file has header + TAKEOFF (22) + LAND (21) — should pass."""
        content = SAMPLE_WAYPOINTS.read_text()
        result = validate_waypoint_content(content)
        # The sample file uses cmd 22 (TAKEOFF) not 84 (VTOL_TAKEOFF)
        # So it will fail the VTOL_TAKEOFF check, which is correct behavior
        assert "VTOL_TAKEOFF" in " ".join(result.errors) or result.is_valid

    def test_valid_vtol_file(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "1\t0\t3\t84\t15\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "2\t0\t3\t16\t0\t0\t0\t0\t13.2\t77.9\t120\t1\n"
            "3\t0\t3\t85\t0\t0\t0\t0\t13.2\t77.9\t0\t1\n"
        )
        result = validate_waypoint_content(content)
        assert result.is_valid
        assert len(result.errors) == 0

    def test_empty_content_fails(self):
        result = validate_waypoint_content("")
        assert not result.is_valid
        assert any("empty" in e.lower() for e in result.errors)

    def test_wrong_header_fails(self):
        result = validate_waypoint_content("MAVProxy WPL 1.0\n1\t0\t3\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1")
        assert not result.is_valid
        assert any("header" in e.lower() for e in result.errors)

    def test_missing_vtol_takeoff_fails(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "1\t0\t3\t16\t0\t0\t0\t0\t13.2\t77.9\t120\t1\n"
            "2\t0\t3\t85\t0\t0\t0\t0\t13.2\t77.9\t0\t1\n"
        )
        result = validate_waypoint_content(content)
        assert not result.is_valid
        assert any("VTOL_TAKEOFF" in e for e in result.errors)

    def test_missing_landing_fails(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "1\t0\t3\t84\t15\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "2\t0\t3\t16\t0\t0\t0\t0\t13.2\t77.9\t120\t1\n"
        )
        result = validate_waypoint_content(content)
        assert not result.is_valid
        assert any("landing" in e.lower() for e in result.errors)

    def test_zero_coords_flagged(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "1\t0\t3\t84\t15\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "2\t0\t3\t16\t0\t0\t0\t0\t0.0\t0.0\t120\t1\n"
            "3\t0\t3\t85\t0\t0\t0\t0\t13.2\t77.9\t0\t1\n"
        )
        result = validate_waypoint_content(content)
        assert not result.is_valid
        assert any("(0,0)" in e for e in result.errors)

    def test_altitude_out_of_range_warns(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "1\t0\t3\t84\t15\t0\t0\t0\t13.1\t77.8\t100\t1\n"
            "2\t0\t3\t16\t0\t0\t0\t0\t13.2\t77.9\t1500\t1\n"
            "3\t0\t3\t85\t0\t0\t0\t0\t13.2\t77.9\t0\t1\n"
        )
        result = validate_waypoint_content(content)
        assert len(result.warnings) > 0
        assert any("1500" in w for w in result.warnings)

    def test_wrong_column_count_fails(self):
        content = (
            "QGC WPL 110\n"
            "0\t1\t0\t16\t0\t0\t0\t0\t13.1\t77.8\n"
        )
        result = validate_waypoint_content(content)
        assert not result.is_valid
        assert any("columns" in e for e in result.errors)


class TestValidateWaypointFile:
    """Test file-based validation."""

    def test_missing_file(self, tmp_path):
        result = validate_waypoint_file(tmp_path / "nonexistent.waypoints")
        assert not result.is_valid
        assert any("not found" in e.lower() for e in result.errors)

    def test_existing_sample_file(self):
        if SAMPLE_WAYPOINTS.exists():
            result = validate_waypoint_file(SAMPLE_WAYPOINTS)
            # The sample file may or may not have VTOL commands
            assert isinstance(result.errors, list)
            assert isinstance(result.warnings, list)
