"""Approval pipeline orchestrator for RedWing DB Automation.

Runs Steps 1–11 atomically:
  1. Open Excel
  2–8. Resolve/create entities (via ExcelUpdater)
  9. Save Excel
  10. Regenerate SQLite database
  11. Git commit & push to db-update branch

Uses backup/restore pattern — if any step fails, the original Excel is restored.
Pipeline lock is acquired from DB at start and released on completion/failure.
Each step is recorded in the audit log.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from audit_store import AuditStore
from config import Settings
from email_service import send_approval, send_pipeline_failure
from excel_updater import ExcelUpdater
from models import (
    ApprovalRequest,
    AuditActionType,
    ConfirmedNewEntities,
    EntityAction,
    PipelineResult,
    ResolvePreviewResponse,
    SubmissionPayload,
    SubmissionStatus,
    WorkflowState,
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


def _generate_branch_shortform(payload: SubmissionPayload, settings: Settings) -> str:
    """Generate a branch shortform from location codes and LZ names.

    Pattern: {src_location_code}-{src_lz_short}-to-{dst_location_code}-{dst_lz_short}
    Falls back to sanitized location names if codes aren't available.
    """
    import sqlite3 as _sqlite3

    flights_db = settings.instance_dir / "flights.db"
    src_code = payload.source_location_name
    dst_code = payload.destination_location_name

    # Try to look up location codes from flights.db
    if flights_db.exists():
        try:
            conn = _sqlite3.connect(str(flights_db))
            conn.row_factory = _sqlite3.Row

            row = conn.execute(
                "SELECT code FROM locations WHERE name = ?",
                (payload.source_location_name,),
            ).fetchone()
            if row and row["code"]:
                src_code = row["code"]

            row = conn.execute(
                "SELECT code FROM locations WHERE name = ?",
                (payload.destination_location_name,),
            ).fetchone()
            if row and row["code"]:
                dst_code = row["code"]

            conn.close()
        except Exception as e:
            logger.warning(f"Failed to look up location codes: {e}")

    # Sanitize for git branch naming
    def _sanitize(name: str) -> str:
        return name.strip().replace(" ", "-").replace("/", "-").lower()[:20]

    shortform = f"{_sanitize(src_code)}-to-{_sanitize(dst_code)}"
    return shortform


def _generate_branch_name(payload: SubmissionPayload, settings: Settings) -> str:
    """Generate the full git branch name.

    New route: db-update/add-routes-for-{SHORTFORM}
    Update route: db-update/update-route-{SHORTFORM}
    If branch exists: append -{YYYYMMDD}
    """
    shortform = _generate_branch_shortform(payload, settings)

    if payload.is_update:
        base = f"db-update/update-route-{shortform}"
    else:
        base = f"db-update/add-routes-for-{shortform}"

    # Check if branch already exists
    try:
        result = subprocess.run(
            ["git", "branch", "-a", "--list", f"*{base}*"],
            cwd=str(settings.repo_path),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.stdout.strip():
            # Branch exists — append date suffix
            date_suffix = datetime.now(timezone.utc).strftime("%Y%m%d")
            return f"{base}-{date_suffix}"
    except Exception as e:
        logger.warning(f"Failed to check existing branches: {e}")

    return base


def run_approval_pipeline(
    submission_id: str,
    approval: ApprovalRequest,
    store: SubmissionStore,
    settings: Settings,
    user_uid: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
) -> PipelineResult:
    """Run the full approval pipeline for a submission.

    Args:
        submission_id: UUID of the submission.
        approval: The approval request with confirmed entities.
        store: The submission store.
        settings: App settings.
        user_uid: UID of the approving user.
        user_name: Display name of the approving user.
        user_role: Role of the approving user.

    Returns:
        PipelineResult with success status and all resolved IDs.
    """
    audit = AuditStore(settings.AUDIT_DB_PATH)

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
        audit.add_record(
            submission_id, AuditActionType.PIPELINE_STEP_COMPLETE,
            user_uid, user_name, user_role,
            {"step": 1, "description": "Excel opened & backup created"},
        )

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
        updater.close()
        updater = ExcelUpdater(excel_path)
        updater.open()

        ids = updater.execute_pipeline(payload)
        updater.close()
        updater = None

        logger.info(f"[Pipeline {submission_id}] Excel updated: {ids}")
        audit.add_record(
            submission_id, AuditActionType.PIPELINE_STEP_COMPLETE,
            user_uid, user_name, user_role,
            {"step": 9, "description": "Excel entities resolved and saved", "ids": ids},
        )

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
        audit.add_record(
            submission_id, AuditActionType.PIPELINE_STEP_COMPLETE,
            user_uid, user_name, user_role,
            {"step": 10, "description": "Database regenerated"},
        )

        # ── Step 11: Git Branch, Commit & Push ──────────────────────────
        logger.info(f"[Pipeline {submission_id}] Step 11: Git branch & commit")

        branch_name = _generate_branch_name(payload, settings)
        logger.info(f"[Pipeline {submission_id}] Branch name: {branch_name}")

        route_id = ids["flight_route_id"]
        src = payload.source_location_name
        dst = payload.destination_location_name

        commit_msg = (
            f"Database Update: Added route {src} to {dst} (Route ID: {route_id})\n\n"
            f"- Takeoff direction: {payload.takeoff_direction}°, "
            f"Approach: {payload.approach_direction}°\n"
            f"- Mission file: {payload.mission_filename}"
        )

        git_commands = [
            ["git", "checkout", "-b", branch_name],
            [
                "git", "add",
                settings.EXCEL_FILENAME,
                "instance/flights.db",
                "missions/",
                "frontend/public/Elevation and flight routes/",
            ],
            ["git", "commit", "-m", commit_msg],
            ["git", "push", "origin", branch_name],
            ["git", "checkout", settings.GIT_BRANCH],  # Return to main
        ]

        git_output_parts = []
        for cmd in git_commands:
            # Skip push if disabled in config
            if cmd[1] == "push" and not settings.ENABLE_GIT_PUSH:
                logger.info(f"[Pipeline {submission_id}] Skipping git push (disabled in config)")
                git_output_parts.append("$ git push... (skipped)")
                continue

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
        logger.info(f"[Pipeline {submission_id}] Git branch created & pushed: {branch_name}")

        # Record branch name in submission and audit
        store.set_branch_name(submission_id, branch_name)
        audit.add_record(
            submission_id, AuditActionType.BRANCH_CREATED,
            user_uid, user_name, user_role,
            {"step": 11, "branch_name": branch_name},
        )

        # ── Success ─────────────────────────────────────────────────────
        backup_path.unlink(missing_ok=True)

        # Mark submission approved for UI list/status chips
        store.update_status(
            submission_id,
            SubmissionStatus.APPROVED,
            user_uid=user_uid,
        )

        store.update_workflow_state(
            submission_id, WorkflowState.PIPELINE_COMPLETE,
            user_uid=user_uid, performer_name=user_name, branch_name=branch_name,
        )

        audit.add_record(
            submission_id, AuditActionType.PIPELINE_COMPLETE,
            user_uid, user_name, user_role,
            {"branch_name": branch_name, "ids": ids},
        )

        # Send approval email (async — won't block)
        send_approval(
            submission_id, payload,
            approver_name=user_name or "System",
            approver_role=user_role or "unknown",
            branch_name=branch_name,
        )

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
            user_uid=user_uid,
        )
        store.update_workflow_state(
            submission_id, WorkflowState.PIPELINE_FAILED, user_uid=user_uid,
        )

        audit.add_record(
            submission_id, AuditActionType.PIPELINE_STEP_FAILED,
            user_uid, user_name, user_role,
            {"step": e.step, "error": e.message},
        )
        audit.add_record(
            submission_id, AuditActionType.PIPELINE_FAILED,
            user_uid, user_name, user_role,
            {"step": e.step, "error": e.message},
        )

        # Send pipeline failure email (async)
        send_pipeline_failure(submission_id, e.step, e.message)

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
            user_uid=user_uid,
        )
        store.update_workflow_state(
            submission_id, WorkflowState.PIPELINE_FAILED, user_uid=user_uid,
        )

        audit.add_record(
            submission_id, AuditActionType.PIPELINE_FAILED,
            user_uid, user_name, user_role,
            {"step": 0, "error": str(e)},
        )

        send_pipeline_failure(submission_id, 0, str(e))

        return PipelineResult(
            success=False,
            submission_id=submission_id,
            error_step=0,
            error_detail=str(e),
        )
    finally:
        # Always release pipeline lock
        try:
            store.release_pipeline_lock()
        except Exception:
            logger.error("Failed to release pipeline lock")


def _restore_backup(excel_path: Path, backup_path: Path, failed_step: int) -> None:
    """Restore the Excel backup if the pipeline failed after writing."""
    if backup_path.exists():
        shutil.move(str(backup_path), str(excel_path))
        logger.info(
            f"Restored Excel backup after failure at step {failed_step}"
        )
