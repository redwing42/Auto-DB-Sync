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
from datetime import datetime, timezone, timedelta
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

    def get_team_activity(self) -> List[Dict[str, Any]]:
        """Calculate team-wide activity stats for the current week."""
        conn = self._get_conn()
        # Query for activity in the last 7 days
        # We want: Name, Role, Count(Reviewed), Count(Approved), Count(Rejected), Avg(Time to Decision)
        
        # 1. Get raw actions for the week
        now = datetime.now(timezone.utc)
        week_ago = (now - timedelta(days=7)).isoformat()
        
        # We need to find: 
        # - Decisions: APPROVED, REJECTED
        # - Pre-decisions: GATE1_PASSED, GATE2_CONFIRMED
        # - Creation: SUBMISSION_CREATED (to calculate latency)
        
        # Let's simplify and get all records for the week
        rows = conn.execute("""
            SELECT performed_by_uid, performed_by_name, performed_by_role, action_type, timestamp_utc, submission_id
            FROM audit_log
            WHERE timestamp_utc >= ?
        """, (week_ago,)).fetchall()
        
        # Also need creation timestamps for decision latency calculation (might be older than a week)
        # But for stats, let's just focus on throughput
        
        users = {}
        for r in rows:
            uid = r['performed_by_uid']
            if not uid: continue
            
            if uid not in users:
                users[uid] = {
                    "uid": uid,
                    "name": r['performed_by_name'],
                    "role": r['performed_by_role'],
                    "reviewed": 0,
                    "approved": 0,
                    "rejected": 0,
                    "latencies": []
                }
            
            u = users[uid]
            action = r['action_type']
            
            if action == "APPROVED":
                u["approved"] += 1
                u["reviewed"] += 1
            elif action == "REJECTED":
                u["rejected"] += 1
                u["reviewed"] += 1
            elif action in ["GATE1_PASSED", "GATE2_CONFIRMED"]:
                u["reviewed"] += 1

        # Calculate average review time (this requires more complex matching, 
        # let's do a simple version: average time between submission and final action for submissions decided this week)
        for uid, u in users.items():
            # For each submission this user decided this week, find when it was created
            submission_ids = [r['submission_id'] for r in rows if r['performed_by_uid'] == uid and r['action_type'] in ["APPROVED", "REJECTED"]]
            if submission_ids:
                # This part is a bit heavy for a single query, but okay for a dashboard with low volume
                placeholders = ','.join(['?'] * len(submission_ids))
                creations = conn.execute(f"""
                    SELECT submission_id, timestamp_utc 
                    FROM audit_log 
                    WHERE submission_id IN ({placeholders}) AND action_type = 'SUBMISSION_CREATED'
                """, submission_ids).fetchall()
                
                creation_map = {c['submission_id']: c['timestamp_utc'] for c in creations}
                
                for r in rows:
                    if r['performed_by_uid'] == uid and r['action_type'] in ["APPROVED", "REJECTED"]:
                        sub_id = r['submission_id']
                        if sub_id in creation_map:
                            t1 = datetime.fromisoformat(creation_map[sub_id].replace('Z', '+00:00'))
                            t2 = datetime.fromisoformat(r['timestamp_utc'].replace('Z', '+00:00'))
                            diff = (t2 - t1).total_seconds() / 3600.0  # Hours
                            u["latencies"].append(diff)
            
            if u["latencies"]:
                u["avg_review_time_hours"] = sum(u["latencies"]) / len(u["latencies"])
            else:
                u["avg_review_time_hours"] = 0
                
            del u["latencies"]

        conn.close()
        return sorted(list(users.values()), key=lambda x: x['reviewed'], reverse=True)

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
