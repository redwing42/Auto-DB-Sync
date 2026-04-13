"""Append-only audit log stored in a separate SQLite database (audit.db).

Design principles:
  - Append-only: only add_record() and get_records() methods exist.
  - No update or delete methods at application layer.
  - Each record is immutable once written.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from models import AuditActionType, AuditRecord


class AuditStore:
    """Manages audit records in audit.db."""

    def __init__(self, db_path: str = "./audit.db"):
        self.db_path = db_path
        self._ensure_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_db(self) -> None:
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                performed_by_uid TEXT,
                performed_by_name TEXT,
                performed_by_role TEXT,
                timestamp_utc TEXT NOT NULL,
                metadata TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_submission
            ON audit_log(submission_id)
        """)
        conn.commit()
        conn.close()

    def add_record(
        self,
        submission_id: str,
        action_type: AuditActionType,
        performed_by_uid: Optional[str] = None,
        performed_by_name: Optional[str] = None,
        performed_by_role: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Append one audit record. Returns the new record ID."""
        record_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        meta_json = json.dumps(metadata) if metadata else None

        conn = self._get_conn()
        conn.execute(
            """INSERT INTO audit_log
               (id, submission_id, action_type, performed_by_uid,
                performed_by_name, performed_by_role, timestamp_utc, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record_id,
                submission_id,
                action_type.value,
                performed_by_uid,
                performed_by_name,
                performed_by_role,
                now,
                meta_json,
            ),
        )
        conn.commit()
        conn.close()
        return record_id

    def get_records(self, submission_id: str) -> List[AuditRecord]:
        """Return all audit records for a submission, ordered chronologically."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM audit_log WHERE submission_id = ? ORDER BY timestamp_utc ASC",
            (submission_id,),
        ).fetchall()
        conn.close()
        return [self._row_to_record(r) for r in rows]

    def get_latest_action(
        self, submission_id: str
    ) -> Optional[AuditRecord]:
        """Return the most recent audit record for a submission."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM audit_log WHERE submission_id = ? ORDER BY timestamp_utc DESC LIMIT 1",
            (submission_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        return self._row_to_record(row)

    def _row_to_record(self, row: sqlite3.Row) -> AuditRecord:
        meta = None
        if row["metadata"]:
            try:
                meta = json.loads(row["metadata"])
            except (json.JSONDecodeError, TypeError):
                meta = None
        return AuditRecord(
            id=row["id"],
            submission_id=row["submission_id"],
            action_type=row["action_type"],
            performed_by_uid=row["performed_by_uid"],
            performed_by_name=row["performed_by_name"],
            performed_by_role=row["performed_by_role"],
            timestamp_utc=row["timestamp_utc"],
            metadata=meta,
        )
