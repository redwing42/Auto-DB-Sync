"""SQLite-backed submission queue for RedWing DB Automation."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from models import (
    DownloadStatus,
    SubmissionPayload,
    SubmissionResponse,
    SubmissionStatus,
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
                created_at TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

    # ── CRUD ─────────────────────────────────────────────────────────────

    def add_submission(
        self, payload: SubmissionPayload, status: SubmissionStatus = SubmissionStatus.PENDING
    ) -> str:
        submission_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        conn.execute(
            """INSERT INTO submissions (id, payload, status, download_status, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                submission_id,
                payload.model_dump_json(),
                status.value,
                DownloadStatus.NOT_STARTED.value,
                now,
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
            "SELECT * FROM submissions ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [self._row_to_response(r) for r in rows]

    def update_status(
        self,
        submission_id: str,
        status: SubmissionStatus,
        error_detail: Optional[str] = None,
    ) -> bool:
        conn = self._get_conn()
        if error_detail:
            conn.execute(
                "UPDATE submissions SET status = ?, error_detail = ? WHERE id = ?",
                (status.value, error_detail, submission_id),
            )
        else:
            conn.execute(
                "UPDATE submissions SET status = ? WHERE id = ?",
                (status.value, submission_id),
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
    ) -> bool:
        conn = self._get_conn()
        files_json = json.dumps(downloaded_files) if downloaded_files else None
        if error_detail:
            conn.execute(
                "UPDATE submissions SET download_status = ?, downloaded_files = ?, error_detail = ? WHERE id = ?",
                (download_status.value, files_json, error_detail, submission_id),
            )
        else:
            conn.execute(
                "UPDATE submissions SET download_status = ?, downloaded_files = ? WHERE id = ?",
                (download_status.value, files_json, submission_id),
            )
        conn.commit()
        conn.close()
        return True

    # ── Helpers ──────────────────────────────────────────────────────────

    def _row_to_response(self, row: sqlite3.Row) -> SubmissionResponse:
        downloaded_files = None
        if row["downloaded_files"]:
            downloaded_files = json.loads(row["downloaded_files"])
        return SubmissionResponse(
            id=row["id"],
            payload=SubmissionPayload.model_validate_json(row["payload"]),
            status=SubmissionStatus(row["status"]),
            download_status=DownloadStatus(row["download_status"]),
            error_detail=row["error_detail"],
            created_at=row["created_at"],
            downloaded_files=downloaded_files,
        )
