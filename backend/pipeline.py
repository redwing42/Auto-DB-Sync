"""Approval pipeline orchestrator for RedWing DB Automation.

Runs Steps 1–11 atomically:
  1. Open Excel
  2–8. Resolve/create entities (via ExcelUpdater)
  9. Save Excel
  10. Regenerate SQLite database
  11. Git commit & push

Uses backup/restore pattern — if any step fails, the original Excel is restored.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from config import Settings
from excel_updater import ExcelUpdater
from models import (
    ApprovalRequest,
    ConfirmedNewEntities,
    EntityAction,
    PipelineResult,
    ResolvePreviewResponse,
    SubmissionPayload,
    SubmissionStatus,
)
from submission_store import SubmissionStore

logger = logging.getLogger(__name__)


class PipelineError(Exception):
    """Raised when a pipeline step fails."""

    def __init__(self, step: int, message: str):
        self.step = step
        self.message = message
        super().__init__(f"Step {step}: {message}")


def validate_confirmations(
    preview: ResolvePreviewResponse,
    confirmed: ConfirmedNewEntities,
) -> Optional[str]:
    """Validate that all new entities have been confirmed by the user.

    Returns an error message if validation fails, None if OK.
    """
    # Network not found always blocks
    if preview.network.action == EntityAction.NOT_FOUND:
        return "Network does not exist. Contact supervisor."

    checks = [
        ("source_location", preview.source_location, confirmed.source_location),
        ("source_lz", preview.source_lz, confirmed.source_lz),
        ("destination_location", preview.destination_location, confirmed.destination_location),
        ("destination_lz", preview.destination_lz, confirmed.destination_lz),
    ]
    for name, entity_preview, is_confirmed in checks:
        if entity_preview.action == EntityAction.NEW and not is_confirmed:
            return f"User confirmation required for new entity: {name}"

    return None


def run_approval_pipeline(
    submission_id: str,
    approval: ApprovalRequest,
    store: SubmissionStore,
    settings: Settings,
) -> PipelineResult:
    """Run the full approval pipeline for a submission.

    Args:
        submission_id: UUID of the submission.
        approval: The approval request with confirmed entities.
        store: The submission store.
        settings: App settings.

    Returns:
        PipelineResult with success status and all resolved IDs.
    """
    submission = store.get_submission(submission_id)
    if submission is None:
        return PipelineResult(
            success=False,
            submission_id=submission_id,
            error_step=0,
            error_detail="Submission not found",
        )

    payload = submission.payload
    excel_path = settings.excel_path
    backup_path = excel_path.with_suffix(".xlsx.bak")

    updater: Optional[ExcelUpdater] = None

    try:
        # ── Step 1: Open Excel & create backup ──────────────────────────
        logger.info(f"[Pipeline {submission_id}] Step 1: Opening Excel")
        if not excel_path.exists():
            raise PipelineError(1, f"Excel file not found: {excel_path}")

        shutil.copy2(str(excel_path), str(backup_path))
        updater = ExcelUpdater(excel_path)
        updater.open()

        # ── Pre-check: Validate confirmations against dry run ────────────
        logger.info(f"[Pipeline {submission_id}] Validating confirmations")
        preview = updater.resolve_preview(payload)
        validation_error = validate_confirmations(preview, approval.confirmed_new_entities)
        if validation_error:
            updater.close()
            backup_path.unlink(missing_ok=True)
            return PipelineResult(
                success=False,
                submission_id=submission_id,
                error_step=2,
                error_detail=validation_error,
            )

        # ── Steps 2–9: Execute pipeline (resolve, create, save) ─────────
        logger.info(f"[Pipeline {submission_id}] Steps 2–9: Executing pipeline")
        # We need to reopen since dry_run path and write path share state
        updater.close()
        updater = ExcelUpdater(excel_path)
        updater.open()

        ids = updater.execute_pipeline(payload)
        updater.close()
        updater = None

        logger.info(f"[Pipeline {submission_id}] Excel updated: {ids}")

        # ── Step 10: Regenerate Database ────────────────────────────────
        logger.info(f"[Pipeline {submission_id}] Step 10: Regenerating database")
        instance_dir = settings.instance_dir
        if instance_dir.exists():
            shutil.rmtree(str(instance_dir))

        repo_venv_python = settings.repo_path / "venv" / "bin" / "python"
        python_exe = str(repo_venv_python) if repo_venv_python.exists() else "python3"

        result = subprocess.run(
            [python_exe, settings.POPULATE_SCRIPT],
            cwd=str(settings.repo_path),
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            raise PipelineError(
                10,
                f"populate_data.py failed (exit {result.returncode}):\n{result.stderr}",
            )

        db_path = instance_dir / "flights.db"
        if not db_path.exists():
            raise PipelineError(10, "flights.db was not created after populate_data.py")

        logger.info(f"[Pipeline {submission_id}] Database regenerated successfully")

        # ── Step 11: Git Commit & Push (DISABLED) ──────────────────────────
        logger.info(f"[Pipeline {submission_id}] Step 11: Git commit & push (Skipped per user request)")
        """
        route_id = ids["flight_route_id"]
        src = payload.source_location_name
        dst = payload.destination_location_name
        filename = payload.mission_filename
        takeoff = payload.takeoff_direction
        approach = payload.approach_direction

        commit_msg = (
            f"Database Update: Added route {src} to {dst} (Route ID: {route_id})\n\n"
            f"- Takeoff direction: {takeoff}°, Approach: {approach}°\n"
            f"- Mission file: {filename}"
        )

        git_commands = [
            [
                "git", "add",
                settings.EXCEL_FILENAME,
                "instance/flights.db",
                "missions/",
                "frontend/public/Elevation and flight routes/",
            ],
            ["git", "commit", "-m", commit_msg],
            # ["git", "push", "origin", settings.GIT_BRANCH],  # User requested manual push
        ]

        git_output_parts = []
        for cmd in git_commands:
            git_result = subprocess.run(
                cmd,
                cwd=str(settings.repo_path),
                capture_output=True,
                text=True,
                timeout=60,
            )
            git_output_parts.append(
                f"$ {' '.join(cmd[:3])}...\n{git_result.stdout}\n{git_result.stderr}"
            )
            if git_result.returncode != 0:
                raise PipelineError(
                    11,
                    f"Git command failed: {' '.join(cmd)}\n{git_result.stderr}",
                )

        git_output = "\n".join(git_output_parts)
        logger.info(f"[Pipeline {submission_id}] Git commit & push complete")
        """
        git_output = "Skipped per user request"
        logger.info(f"[Pipeline {submission_id}] Git process skipped")

        # ── Success ─────────────────────────────────────────────────────
        # Remove backup
        backup_path.unlink(missing_ok=True)

        store.update_status(submission_id, SubmissionStatus.APPROVED)

        return PipelineResult(
            success=True,
            submission_id=submission_id,
            network_id=ids["network_id"],
            source_location_id=ids["source_location_id"],
            source_lz_id=ids["source_lz_id"],
            destination_location_id=ids["destination_location_id"],
            destination_lz_id=ids["destination_lz_id"],
            waypoint_file_id=ids["waypoint_file_id"],
            flight_route_id=ids["flight_route_id"],
            git_output=git_output,
        )

    except PipelineError as e:
        logger.error(f"[Pipeline {submission_id}] {e}")
        _restore_backup(excel_path, backup_path, e.step)
        if updater:
            updater.close()
        store.update_status(
            submission_id,
            SubmissionStatus.FAILED,
            error_detail=f"Step {e.step}: {e.message}",
        )
        return PipelineResult(
            success=False,
            submission_id=submission_id,
            error_step=e.step,
            error_detail=e.message,
        )
    except Exception as e:
        logger.exception(f"[Pipeline {submission_id}] Unexpected error")
        _restore_backup(excel_path, backup_path, 0)
        if updater:
            updater.close()
        store.update_status(
            submission_id,
            SubmissionStatus.FAILED,
            error_detail=str(e),
        )
        return PipelineResult(
            success=False,
            submission_id=submission_id,
            error_step=0,
            error_detail=str(e),
        )


def _restore_backup(excel_path: Path, backup_path: Path, failed_step: int) -> None:
    """Restore the Excel backup if the pipeline failed after writing."""
    if backup_path.exists():
        shutil.move(str(backup_path), str(excel_path))
        logger.info(
            f"Restored Excel backup after failure at step {failed_step}"
        )
