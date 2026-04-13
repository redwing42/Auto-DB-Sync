"""Unit tests for validation.py — shared submission validation."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from tests.conftest import SAMPLE_PAYLOAD_DICT
from models import SubmissionPayload
from validation import validate_submission, ValidationResult


@pytest.fixture
def valid_payload():
    return SubmissionPayload(**SAMPLE_PAYLOAD_DICT)


class TestValidateSubmission:
    """Test the main validate_submission function."""

    def test_valid_payload_passes(self, valid_payload):
        result = validate_submission(valid_payload)
        assert result.is_valid
        assert len(result.errors) == 0

    def test_zero_source_coordinates_rejected(self):
        data = {**SAMPLE_PAYLOAD_DICT, "source_latitude": 0, "source_longitude": 0}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert not result.is_valid
        assert any("(0, 0)" in e for e in result.errors)

    def test_zero_destination_coordinates_rejected(self):
        data = {**SAMPLE_PAYLOAD_DICT, "destination_latitude": 0, "destination_longitude": 0}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert not result.is_valid
        assert any("(0, 0)" in e for e in result.errors)

    def test_out_of_bounds_coordinates_warn(self):
        data = {**SAMPLE_PAYLOAD_DICT, "source_latitude": 50.0, "source_longitude": 10.0}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        # Should still be valid but with warnings
        assert result.is_valid
        assert any("outside India" in w for w in result.warnings)

    def test_missing_filename_rejected(self):
        data = {**SAMPLE_PAYLOAD_DICT, "mission_filename": ""}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert not result.is_valid
        assert any("filename" in e.lower() for e in result.errors)

    def test_wrong_filename_extension_rejected(self):
        data = {**SAMPLE_PAYLOAD_DICT, "mission_filename": "mission.txt"}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert not result.is_valid
        assert any(".waypoints" in e for e in result.errors)

    def test_direction_warning_triggered(self):
        data = {**SAMPLE_PAYLOAD_DICT, "takeoff_direction": 90, "approach_direction": 100}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert result.is_valid  # Warnings don't block
        assert any("differ by" in w for w in result.warnings)

    def test_direction_no_warning_for_normal_diff(self):
        data = {**SAMPLE_PAYLOAD_DICT, "takeoff_direction": 90, "approach_direction": 270}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert result.is_valid
        assert len(result.warnings) == 0

    def test_invalid_drive_link_rejected(self):
        data = {**SAMPLE_PAYLOAD_DICT, "mission_drive_link": "not-a-link"}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert not result.is_valid
        assert any("Drive" in e for e in result.errors)

    def test_valid_drive_link_passes(self):
        data = {**SAMPLE_PAYLOAD_DICT, "mission_drive_link": "https://drive.google.com/file/d/abc123xyz/view"}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert result.is_valid

    def test_empty_optional_drive_links_pass(self):
        data = {**SAMPLE_PAYLOAD_DICT, "elevation_image_drive_link": "", "route_image_drive_link": ""}
        payload = SubmissionPayload(**data)
        result = validate_submission(payload)
        assert result.is_valid
