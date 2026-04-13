"""SQLite-backed submission queue for RedWing DB Automation."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from models import (
    DownloadStatus,
    DraftResponse,
    SubmissionPayload,
    SubmissionResponse,
    SubmissionStatus,
    WorkflowState,
)


class SubmissionStore:
    """Manages submissions in a local SQLite database."""

    def __init__(self, db_path: str = "./submissions.db"):
        self.db_path = db_path
        self._ensure_db()

    # ── Schema ───────────────────────────────────────────────────────────

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_db(self) -> None:
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                download_status TEXT NOT NULL DEFAULT 'not_started',
                error_detail TEXT,
                downloaded_files TEXT,
                files_downloaded INTEGER NOT NULL DEFAULT 0,
                waypoint_verified INTEGER NOT NULL DEFAULT 0,
                id_resolution_reviewed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                created_by_uid TEXT,
                updated_by_uid TEXT,
                deleted_at TEXT,
                deleted_by_uid TEXT
            )
        """)

        # ── Migrations: add columns if missing (safe for existing data) ──
        migration_columns = [
            "files_downloaded INTEGER NOT NULL DEFAULT 0",
            "waypoint_verified INTEGER NOT NULL DEFAULT 0",
            "id_resolution_reviewed INTEGER NOT NULL DEFAULT 0",
            "updated_at TEXT",
            "created_by_uid TEXT",
            "updated_by_uid TEXT",
            "deleted_at TEXT",
            "deleted_by_uid TEXT",
            "source TEXT DEFAULT 'webhook'",
            # Phase 3 columns
            "workflow_state TEXT DEFAULT 'SUBMITTED'",
            "submitted_by_uid TEXT",
            "submitted_by_name TEXT",
            "submitted_by_role TEXT",
            "branch_name TEXT",
            "branch_merged INTEGER DEFAULT 0",
            "rejection_reason TEXT",
            "reviewed_by_name TEXT",
            "verified_by_name TEXT",
            "validated_by_name TEXT",
            "approved_by_name TEXT",
            "db_updated_by_name TEXT",
            "viewed_by_name TEXT",
            "serial_id INTEGER",
            # Phase 4 columns
            "submission_type TEXT DEFAULT 'NEW_ROUTE'",
            "changed_fields TEXT",
            "parent_submission_id TEXT",
        ]
        for col in migration_columns:
            try:
                conn.execute(f"ALTER TABLE submissions ADD COLUMN {col}")
            except sqlite3.OperationalError:
                pass  # Column already exists

        # Backfill serial_id if null (using rowid as a safe sequence)
        conn.execute("UPDATE submissions SET serial_id = rowid WHERE serial_id IS NULL")

        # ── Pipeline Lock table ──────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_lock (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                is_locked INTEGER NOT NULL DEFAULT 0,
                locked_at TEXT,
                locked_by_uid TEXT
            )
        """)
        # Ensure single row exists
        conn.execute("""
            INSERT OR IGNORE INTO pipeline_lock (id, is_locked)
            VALUES (1, 0)
        """)

        conn.commit()

        # ── Drafts table ─────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS drafts (
                id TEXT PRIMARY KEY,
                submission_type TEXT NOT NULL DEFAULT 'NEW_ROUTE',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                created_by_uid TEXT NOT NULL,
                parent_submission_id TEXT,
                label TEXT DEFAULT 'Untitled Draft',
                deleted_at TEXT,
                deleted_by_uid TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_drafts_user
            ON drafts(created_by_uid)
        """)
        conn.commit()
        conn.close()

    # ── CRUD ─────────────────────────────────────────────────────────────

    def add_submission(
        self,
        payload: SubmissionPayload,
        status: SubmissionStatus = SubmissionStatus.PENDING,
        user_uid: Optional[str] = None,
        source: str = "webhook",
        submitted_by_name: Optional[str] = None,
        submitted_by_role: Optional[str] = None,
        submission_type: str = "NEW_ROUTE",
        changed_fields: Optional[str] = None,
        parent_submission_id: Optional[str] = None,
    ) -> str:
        submission_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO submissions
               (id, payload, status, download_status, files_downloaded,
                waypoint_verified, id_resolution_reviewed, created_at,
                created_by_uid, source, workflow_state,
                submitted_by_uid, submitted_by_name, submitted_by_role,
                submission_type, changed_fields, parent_submission_id,
                serial_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       (SELECT COALESCE(MAX(serial_id), 0) + 1 FROM submissions))""",
            (
                submission_id,
                payload.model_dump_json(),
                status.value,
                DownloadStatus.NOT_STARTED.value,
                0,
                0,
                0,
                now,
                user_uid,
                source,
                WorkflowState.SUBMITTED.value,
                user_uid,
                submitted_by_name,
                submitted_by_role,
                submission_type,
                changed_fields,
                parent_submission_id,
            ),
        )
        conn.commit()
        conn.close()
        return submission_id

    def get_submission(self, submission_id: str) -> Optional[SubmissionResponse]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM submissions WHERE id = ?", (submission_id,)
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return self._row_to_response(row)

    def list_submissions(self) -> List[SubmissionResponse]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM submissions WHERE deleted_at IS NULL ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [self._row_to_response(r) for r in rows]

    def update_status(
        self,
        submission_id: str,
        status: SubmissionStatus,
        error_detail: Optional[str] = None,
        user_uid: Optional[str] = None,
    ) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        if error_detail:
            conn.execute(
                "UPDATE submissions SET status = ?, error_detail = ?, updated_at = ?, updated_by_uid = ? WHERE id = ?",
                (status.value, error_detail, now, user_uid, submission_id),
            )
        else:
            conn.execute(
                "UPDATE submissions SET status = ?, updated_at = ?, updated_by_uid = ? WHERE id = ?",
                (status.value, now, user_uid, submission_id),
            )
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    def update_download_status(
        self,
        submission_id: str,
        download_status: DownloadStatus,
        downloaded_files: Optional[dict] = None,
        error_detail: Optional[str] = None,
        user_uid: Optional[str] = None,
    ) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        files_json = json.dumps(downloaded_files) if downloaded_files else None
        
        is_completed = 1 if download_status == DownloadStatus.COMPLETED else 0
        
        if error_detail:
            conn.execute(
                "UPDATE submissions SET download_status = ?, downloaded_files = ?, error_detail = ?, files_downloaded = ?, updated_at = ?, updated_by_uid = ? WHERE id = ?",
                (download_status.value, files_json, error_detail, is_completed, now, user_uid, submission_id),
            )
        else:
            conn.execute(
                "UPDATE submissions SET download_status = ?, downloaded_files = ?, files_downloaded = ?, updated_at = ?, updated_by_uid = ? WHERE id = ?",
                (download_status.value, files_json, is_completed, now, user_uid, submission_id),
            )
        conn.commit()
        conn.close()
        return True

    def update_review_state(
        self,
        submission_id: str,
        waypoint_verified: Optional[bool] = None,
        id_resolution_reviewed: Optional[bool] = None,
        user_uid: Optional[str] = None,
        reviewer_name: Optional[str] = None,
    ) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        updates = ["updated_at = ?", "updated_by_uid = ?"]
        params: list[Any] = [now, user_uid]
        if waypoint_verified is not None:
            updates.append("waypoint_verified = ?")
            params.append(1 if waypoint_verified else 0)
            if waypoint_verified: # Gate 1 passed
                updates.append("verified_by_name = ?")
                params.append(reviewer_name)
        if id_resolution_reviewed is not None:
            updates.append("id_resolution_reviewed = ?")
            params.append(1 if id_resolution_reviewed else 0)
            if id_resolution_reviewed: # Gate 2 passed
                updates.append("validated_by_name = ?")
                params.append(reviewer_name)

        if len(updates) == 2: # Only updated_at and updated_by_uid
            conn.close()
            return False

        params.append(submission_id)
        query = f"UPDATE submissions SET {', '.join(updates)} WHERE id = ?"
        conn.execute(query, tuple(params))
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    def update_submission_payload(
        self,
        submission_id: str,
        payload: SubmissionPayload,
        user_uid: Optional[str] = None,
    ) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        conn.execute(
            """
            UPDATE submissions
            SET payload = ?, id_resolution_reviewed = 0, updated_at = ?, updated_by_uid = ?
            WHERE id = ?
            """,
            (payload.model_dump_json(), now, user_uid, submission_id),
        )
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    # ── Workflow State ───────────────────────────────────────────────────

    def update_workflow_state(
        self,
        submission_id: str,
        state: WorkflowState,
        user_uid: Optional[str] = None,
        performer_name: Optional[str] = None,
        rejection_reason: Optional[str] = None,
        branch_name: Optional[str] = None,
    ) -> bool:
        """Update workflow_state and optionally set rejection_reason or branch_name."""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        updates = ["workflow_state = ?", "updated_at = ?", "updated_by_uid = ?"]
        params: list[Any] = [state.value, now, user_uid]

        if state in (WorkflowState.PIPELINE_RUNNING, WorkflowState.APPROVED):
            updates.append("approved_by_name = ?")
            params.append(performer_name)

        if state == WorkflowState.PIPELINE_COMPLETE:
            updates.append("db_updated_by_name = ?")
            params.append(performer_name)

        if rejection_reason is not None:
            updates.append("rejection_reason = ?")
            params.append(rejection_reason)
        if branch_name is not None:
            updates.append("branch_name = ?")
            params.append(branch_name)

        params.append(submission_id)
        query = f"UPDATE submissions SET {', '.join(updates)} WHERE id = ?"
        conn.execute(query, tuple(params))
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    def mark_viewed(self, submission_id: str, user_name: str) -> bool:
        """Set viewed_by_name if not already set."""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        # Only set if currently NULL
        conn.execute(
            "UPDATE submissions SET viewed_by_name = ?, updated_at = ? WHERE id = ? AND viewed_by_name IS NULL",
            (user_name, now, submission_id),
        )
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    def set_branch_name(self, submission_id: str, branch_name: str) -> bool:
        """Record the git branch name for a submission."""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        conn.execute(
            "UPDATE submissions SET branch_name = ?, updated_at = ? WHERE id = ?",
            (branch_name, now, submission_id),
        )
        conn.commit()
        conn.close()
        return True

    # ── Pipeline Lock ────────────────────────────────────────────────────

    def acquire_pipeline_lock(self, user_uid: str) -> bool:
        """Try to acquire the pipeline lock. Returns True if successful.
        
        Raises RuntimeError if already locked.
        """
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        row = conn.execute(
            "SELECT is_locked, locked_at, locked_by_uid FROM pipeline_lock WHERE id = 1"
        ).fetchone()

        if row and row["is_locked"]:
            conn.close()
            raise RuntimeError(
                f"Pipeline is locked by {row['locked_by_uid']} since {row['locked_at']}"
            )

        conn.execute(
            "UPDATE pipeline_lock SET is_locked = 1, locked_at = ?, locked_by_uid = ? WHERE id = 1",
            (now, user_uid),
        )
        conn.commit()
        conn.close()
        return True

    def release_pipeline_lock(self) -> None:
        """Unconditionally release the pipeline lock."""
        conn = self._get_conn()
        conn.execute(
            "UPDATE pipeline_lock SET is_locked = 0, locked_at = NULL, locked_by_uid = NULL WHERE id = 1"
        )
        conn.commit()
        conn.close()

    def is_pipeline_locked(self) -> Optional[dict]:
        """Check pipeline lock status.
        
        Returns dict with lock info if locked, None if unlocked.
        """
        conn = self._get_conn()
        row = conn.execute(
            "SELECT is_locked, locked_at, locked_by_uid FROM pipeline_lock WHERE id = 1"
        ).fetchone()
        conn.close()
        if row and row["is_locked"]:
            return {
                "is_locked": True,
                "locked_at": row["locked_at"],
                "locked_by_uid": row["locked_by_uid"],
            }
        return None

    # ── Helpers ──────────────────────────────────────────────────────────

    def _row_to_response(self, row: sqlite3.Row) -> SubmissionResponse:
        downloaded_files = None
        if row["downloaded_files"]:
            downloaded_files = json.loads(row["downloaded_files"])

        # Graceful column access for older schemas
        def _safe_get(key: str, default=None):
            try:
                val = row[key]
                return val if val is not None else default
            except (IndexError, KeyError):
                return default

        # Parse changed_fields JSON if present
        changed_fields_raw = _safe_get("changed_fields")
        changed_fields = None
        if changed_fields_raw:
            try:
                changed_fields = json.loads(changed_fields_raw)
            except (json.JSONDecodeError, TypeError):
                changed_fields = None

        return SubmissionResponse(
            id=row["id"],
            payload=SubmissionPayload.model_validate_json(row["payload"]),
            status=SubmissionStatus(row["status"]),
            download_status=DownloadStatus(row["download_status"]),
            error_detail=row["error_detail"],
            created_at=row["created_at"],
            downloaded_files=downloaded_files,
            files_downloaded=bool(row["files_downloaded"]),
            waypoint_verified=bool(row["waypoint_verified"]),
            id_resolution_reviewed=bool(row["id_resolution_reviewed"]),
            source=_safe_get("source", "webhook"),
            # Phase 3 fields
            workflow_state=_safe_get("workflow_state", "SUBMITTED"),
            submitted_by_uid=_safe_get("submitted_by_uid"),
            submitted_by_name=_safe_get("submitted_by_name"),
            submitted_by_role=_safe_get("submitted_by_role"),
            branch_name=_safe_get("branch_name"),
            rejection_reason=_safe_get("rejection_reason"),
            reviewed_by_name=_safe_get("reviewed_by_name"),
            verified_by_name=_safe_get("verified_by_name"),
            validated_by_name=_safe_get("validated_by_name"),
            approved_by_name=_safe_get("approved_by_name"),
            db_updated_by_name=_safe_get("db_updated_by_name"),
            viewed_by_name=_safe_get("viewed_by_name"),
            human_id=f"RW-{_safe_get('serial_id', '???')}",
            # Phase 4 fields
            submission_type=_safe_get("submission_type", "NEW_ROUTE"),
            changed_fields=changed_fields,
            parent_submission_id=_safe_get("parent_submission_id"),
        )

    # ── Draft CRUD ────────────────────────────────────────────────────────

    def save_draft(
        self,
        user_uid: str,
        payload_json: str,
        submission_type: str = "NEW_ROUTE",
        draft_id: Optional[str] = None,
        parent_submission_id: Optional[str] = None,
        label: Optional[str] = None,
    ) -> str:
        """Create or update a draft. Returns draft ID."""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()

        if draft_id:
            # Update existing draft
            conn.execute(
                """UPDATE drafts SET payload_json = ?, updated_at = ?,
                   submission_type = ?, label = ? WHERE id = ? AND created_by_uid = ?""",
                (payload_json, now, submission_type,
                 label or "Untitled Draft", draft_id, user_uid),
            )
        else:
            draft_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO drafts
                   (id, submission_type, payload_json, created_at, created_by_uid,
                    parent_submission_id, label)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (draft_id, submission_type, payload_json, now, user_uid,
                 parent_submission_id, label or "Untitled Draft"),
            )

        conn.commit()
        conn.close()
        return draft_id

    def get_drafts_by_user(self, user_uid: str) -> List[DraftResponse]:
        """Return all non-deleted drafts for a user."""
        conn = self._get_conn()
        rows = conn.execute(
            """SELECT * FROM drafts
               WHERE created_by_uid = ? AND deleted_at IS NULL
               ORDER BY COALESCE(updated_at, created_at) DESC""",
            (user_uid,),
        ).fetchall()
        conn.close()
        return [self._row_to_draft(r) for r in rows]

    def get_draft(self, draft_id: str) -> Optional[DraftResponse]:
        """Return a single draft by ID."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM drafts WHERE id = ? AND deleted_at IS NULL",
            (draft_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return self._row_to_draft(row)

    def delete_draft(self, draft_id: str, user_uid: str) -> bool:
        """Soft-delete a draft."""
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        conn.execute(
            "UPDATE drafts SET deleted_at = ?, deleted_by_uid = ? WHERE id = ?",
            (now, user_uid, draft_id),
        )
        conn.commit()
        affected = conn.total_changes
        conn.close()
        return affected > 0

    def soft_delete_stale_drafts(self, days: int = 7) -> int:
        """Soft-delete drafts older than N days."""
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        conn = self._get_conn()
        cursor = conn.execute(
            """UPDATE drafts SET deleted_at = ?, deleted_by_uid = 'system'
               WHERE deleted_at IS NULL
               AND COALESCE(updated_at, created_at) < ?""",
            (datetime.now(timezone.utc).isoformat(), cutoff),
        )
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        return affected

    def _row_to_draft(self, row: sqlite3.Row) -> DraftResponse:
        def _safe(key, default=None):
            try:
                val = row[key]
                return val if val is not None else default
            except (IndexError, KeyError):
                return default
        return DraftResponse(
            id=row["id"],
            submission_type=_safe("submission_type", "NEW_ROUTE"),
            payload_json=row["payload_json"],
            created_at=row["created_at"],
            updated_at=_safe("updated_at"),
            created_by_uid=row["created_by_uid"],
            parent_submission_id=_safe("parent_submission_id"),
            label=_safe("label", "Untitled Draft"),
        )
