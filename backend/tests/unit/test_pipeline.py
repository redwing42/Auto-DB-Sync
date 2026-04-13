"""Unit tests for pipeline.py."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from models import (
    ApprovalRequest,
    ConfirmedNewEntities,
    SubmissionPayload,
    SubmissionStatus,
)
from pipeline import (
    _run_command_with_retries,
    _validate_branch_name,
    run_approval_pipeline,
    validate_confirmations,
)
from submission_store import SubmissionStore


@pytest.fixture
def populated_store(test_store: SubmissionStore, sample_payload: SubmissionPayload) -> tuple:
    """Create a store with one submission."""
    sub_id = test_store.add_submission(sample_payload)
    return test_store, sub_id


class TestValidateConfirmations:
    """Test the confirmation gate logic."""

    def test_all_existing_passes(self):
        from models import EntityPreview, EntityAction, ResolvePreviewResponse

        preview = ResolvePreviewResponse(
            network=EntityPreview(id=1, name="Net", action=EntityAction.EXISTING),
            source_location=EntityPreview(id=1, name="Src", action=EntityAction.EXISTING),
            source_lz=EntityPreview(id=1, name="SrcLZ", action=EntityAction.EXISTING),
            destination_location=EntityPreview(id=2, name="Dst", action=EntityAction.EXISTING),
            destination_lz=EntityPreview(id=2, name="DstLZ", action=EntityAction.EXISTING),
            waypoint_file=EntityPreview(id=1, name="wp", action=EntityAction.NEW),
            flight_route=EntityPreview(id=1, action=EntityAction.NEW),
        )
        confirmed = ConfirmedNewEntities()
        assert validate_confirmations(preview, confirmed) is None

    def test_new_entity_without_confirmation_fails(self):
        from models import EntityPreview, EntityAction, ResolvePreviewResponse

        preview = ResolvePreviewResponse(
            network=EntityPreview(id=1, name="Net", action=EntityAction.EXISTING),
            source_location=EntityPreview(id=10, name="New Src", action=EntityAction.NEW),
            source_lz=EntityPreview(id=1, name="SrcLZ", action=EntityAction.EXISTING),
            destination_location=EntityPreview(id=2, name="Dst", action=EntityAction.EXISTING),
            destination_lz=EntityPreview(id=2, name="DstLZ", action=EntityAction.EXISTING),
            waypoint_file=EntityPreview(id=1, name="wp", action=EntityAction.NEW),
            flight_route=EntityPreview(id=1, action=EntityAction.NEW),
        )
        confirmed = ConfirmedNewEntities(source_location=False)
        error = validate_confirmations(preview, confirmed)
        assert error is not None
        assert "source_location" in error

    def test_network_not_found_always_blocks(self):
        from models import EntityPreview, EntityAction, ResolvePreviewResponse

        preview = ResolvePreviewResponse(
            network=EntityPreview(name="Bad Net", action=EntityAction.NOT_FOUND),
            source_location=EntityPreview(id=1, name="Src", action=EntityAction.EXISTING),
            source_lz=EntityPreview(id=1, name="SrcLZ", action=EntityAction.EXISTING),
            destination_location=EntityPreview(id=2, name="Dst", action=EntityAction.EXISTING),
            destination_lz=EntityPreview(id=2, name="DstLZ", action=EntityAction.EXISTING),
            waypoint_file=EntityPreview(id=1, name="wp", action=EntityAction.NEW),
            flight_route=EntityPreview(id=1, action=EntityAction.NEW),
        )
        confirmed = ConfirmedNewEntities(
            source_location=True, source_lz=True,
            destination_location=True, destination_lz=True,
        )
        error = validate_confirmations(preview, confirmed)
        assert error is not None
        assert "Network" in error


class TestRunApprovalPipeline:
    """Test the full pipeline with mocks."""

    def test_submission_not_found(self, test_store: SubmissionStore, test_settings):
        approval = ApprovalRequest(confirmed_new_entities=ConfirmedNewEntities())
        result = run_approval_pipeline("nonexistent-id", approval, test_store, test_settings)
        assert not result.success
        assert "not found" in result.error_detail

    def test_excel_not_found(self, populated_store, test_settings):
        store, sub_id = populated_store
        # Point to nonexistent Excel
        test_settings.EXCEL_FILENAME = "nonexistent.xlsx"

        approval = ApprovalRequest(
            confirmed_new_entities=ConfirmedNewEntities(
                source_location=True, source_lz=True,
                destination_location=True, destination_lz=True,
            )
        )
        result = run_approval_pipeline(sub_id, approval, store, test_settings)
        assert not result.success

    @patch("pipeline.subprocess.run")
    def test_full_pipeline_with_mocked_subprocess(
        self, mock_subprocess, populated_store, test_settings, test_excel_path
    ):
        store, sub_id = populated_store

        # Mock populate_data.py success
        mock_populate = MagicMock()
        mock_populate.returncode = 0
        mock_populate.stdout = "DB created"
        mock_populate.stderr = ""

        # Mock git commands success
        mock_git = MagicMock()
        mock_git.returncode = 0
        mock_git.stdout = "OK"
        mock_git.stderr = ""

        # side_effect that simulates populate_data.py creating the db file
        instance_dir = test_settings.instance_dir

        def subprocess_side_effect(*args, **kwargs):
            cmd = args[0] if args else kwargs.get("args", [])
            if "populate_data.py" in str(cmd):
                instance_dir.mkdir(exist_ok=True)
                (instance_dir / "flights.db").touch()
                return mock_populate
            return mock_git

        mock_subprocess.side_effect = subprocess_side_effect

        approval = ApprovalRequest(
            confirmed_new_entities=ConfirmedNewEntities(
                destination_lz=True,  # Demo Alpha South Pad doesn't exist in test
            )
        )
        result = run_approval_pipeline(sub_id, approval, store, test_settings)

        assert result.success
        assert result.flight_route_id is not None
        assert result.network_id == 1

        # Verify submission status updated
        sub = store.get_submission(sub_id)
        assert sub.status == SubmissionStatus.APPROVED

    @patch("pipeline.subprocess.run")
    def test_populate_script_failure_restores_backup(
        self, mock_subprocess, populated_store, test_settings, test_excel_path
    ):
        store, sub_id = populated_store

        # Mock populate_data.py failure
        mock_populate = MagicMock()
        mock_populate.returncode = 1
        mock_populate.stdout = ""
        mock_populate.stderr = "Error: something broke"

        mock_subprocess.return_value = mock_populate

        approval = ApprovalRequest(
            confirmed_new_entities=ConfirmedNewEntities(
                destination_lz=True,
            )
        )
        result = run_approval_pipeline(sub_id, approval, store, test_settings)

        assert not result.success
        assert result.error_step == 10
        assert "populate_data.py failed" in result.error_detail

        # Verify submission status is failed
        sub = store.get_submission(sub_id)
        assert sub.status == SubmissionStatus.FAILED

    def test_missing_confirmations_returns_error(
        self, populated_store, test_settings, test_excel_path
    ):
        store, sub_id = populated_store

        # Don't confirm destination_lz which will be NEW
        approval = ApprovalRequest(
            confirmed_new_entities=ConfirmedNewEntities(
                destination_lz=False,
            )
        )
        result = run_approval_pipeline(sub_id, approval, store, test_settings)

        assert not result.success
        assert "confirmation required" in result.error_detail.lower() or "User confirmation" in result.error_detail


class TestPipelineHardening:
    def test_validate_branch_name(self):
        assert _validate_branch_name("db-update/add-routes-for-hq-to-node")
        assert _validate_branch_name("db-update/update-route-hq-to-node-20260413")
        assert not _validate_branch_name("feature/random-branch")

    @patch("pipeline.subprocess.run")
    def test_run_command_with_retries_records_retry(self, mock_run, tmp_path):
        fail = MagicMock(returncode=1, stdout="", stderr="fail")
        ok = MagicMock(returncode=0, stdout="ok", stderr="")
        mock_run.side_effect = [fail, ok]
        audit = MagicMock()

        result = _run_command_with_retries(
            ["echo", "x"],
            tmp_path,
            timeout=5,
            retries=1,
            step=10,
            submission_id="sub-1",
            audit=audit,
            user_uid="u1",
            user_name="User",
            user_role="operator",
        )
        assert result.returncode == 0
        assert mock_run.call_count == 2
        audit.add_record.assert_called_once()
