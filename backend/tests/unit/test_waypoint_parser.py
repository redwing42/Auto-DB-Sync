"""Unit tests for waypoint_parser.py."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from waypoint_parser import WaypointParseError, parse_waypoints_file


class TestValidParsing:
    """Test parsing a valid Mission Planner waypoint file."""

    def test_parses_sample_file(self, sample_waypoints_path: Path):
        result = parse_waypoints_file(sample_waypoints_path)
        assert result.total_waypoints == 7
        assert result.mission_filename == "sample.waypoints"

    def test_correct_field_types(self, sample_waypoints_path: Path):
        result = parse_waypoints_file(sample_waypoints_path)
        wp = result.waypoints[0]
        assert isinstance(wp.index, int)
        assert isinstance(wp.current_wp, int)
        assert isinstance(wp.coord_frame, int)
        assert isinstance(wp.command, int)
        assert isinstance(wp.param1, float)
        assert isinstance(wp.param2, float)
        assert isinstance(wp.param3, float)
        assert isinstance(wp.param4, float)
        assert isinstance(wp.latitude, float)
        assert isinstance(wp.longitude, float)
        assert isinstance(wp.altitude, float)
        assert isinstance(wp.autocontinue, int)

    def test_correct_values_first_waypoint(self, sample_waypoints_path: Path):
        result = parse_waypoints_file(sample_waypoints_path)
        wp = result.waypoints[0]
        assert wp.index == 0
        assert wp.current_wp == 1
        assert wp.command == 16
        assert abs(wp.latitude - 13.163775) < 0.0001
        assert abs(wp.longitude - 77.867277) < 0.0001
        assert wp.altitude == 100.0

    def test_correct_values_last_waypoint(self, sample_waypoints_path: Path):
        result = parse_waypoints_file(sample_waypoints_path)
        wp = result.waypoints[-1]
        assert wp.index == 6
        assert wp.command == 21  # LAND command
        assert wp.altitude == 0.0
        assert wp.autocontinue == 1


class TestMalformedFiles:
    """Test handling of malformed .waypoints files."""

    def test_missing_header(self, tmp_path: Path):
        bad_file = tmp_path / "bad.waypoints"
        bad_file.write_text("0\t1\t0\t16\t0\t0\t0\t0\t13.0\t77.0\t100\t1\n")
        with pytest.raises(WaypointParseError, match="Invalid header"):
            parse_waypoints_file(bad_file)

    def test_wrong_column_count(self, tmp_path: Path):
        bad_file = tmp_path / "bad.waypoints"
        bad_file.write_text("QGC WPL 110\n0\t1\t0\t16\t0\t0\n")
        with pytest.raises(WaypointParseError, match="expected 12 columns"):
            parse_waypoints_file(bad_file)

    def test_non_numeric_coordinates(self, tmp_path: Path):
        bad_file = tmp_path / "bad.waypoints"
        bad_file.write_text(
            "QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\tabc\txyz\t100\t1\n"
        )
        with pytest.raises(WaypointParseError, match="could not parse"):
            parse_waypoints_file(bad_file)

    def test_empty_file(self, tmp_path: Path):
        bad_file = tmp_path / "bad.waypoints"
        bad_file.write_text("")
        with pytest.raises(WaypointParseError, match="empty"):
            parse_waypoints_file(bad_file)

    def test_file_not_found(self, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            parse_waypoints_file(tmp_path / "nonexistent.waypoints")


class TestEdgeCases:
    """Test edge cases."""

    def test_single_waypoint(self, tmp_path: Path):
        f = tmp_path / "single.waypoints"
        f.write_text(
            "QGC WPL 110\n0\t1\t0\t16\t0.0\t0.0\t0.0\t0.0\t13.0\t77.0\t100.0\t1\n"
        )
        result = parse_waypoints_file(f)
        assert result.total_waypoints == 1

    def test_waypoint_with_zero_altitude(self, tmp_path: Path):
        f = tmp_path / "zero_alt.waypoints"
        f.write_text(
            "QGC WPL 110\n0\t1\t0\t16\t0.0\t0.0\t0.0\t0.0\t13.0\t77.0\t0.0\t1\n"
        )
        result = parse_waypoints_file(f)
        assert result.waypoints[0].altitude == 0.0

    def test_blank_lines_ignored(self, tmp_path: Path):
        f = tmp_path / "blanks.waypoints"
        f.write_text(
            "QGC WPL 110\n\n0\t1\t0\t16\t0.0\t0.0\t0.0\t0.0\t13.0\t77.0\t100.0\t1\n\n"
        )
        result = parse_waypoints_file(f)
        assert result.total_waypoints == 1
