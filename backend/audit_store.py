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

from models import (
    AuditActionType,
    AuditRecord,
)


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

    # ── Admin Audit Viewer (paginated) ───────────────────────────────────────

    def get_all_audit_paginated(
        self,
        page: int = 1,
        limit: int = 50,
        action_type: Optional[str] = None,
        uid: Optional[str] = None,
        days: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Return system-wide audit log in a UI-friendly, paginated shape."""
        page = max(1, int(page or 1))
        limit = min(200, max(1, int(limit or 50)))

        where: List[str] = []
        params: List[Any] = []

        if action_type:
            where.append("action_type = ?")
            params.append(action_type)

        if uid:
            where.append("performed_by_uid = ?")
            params.append(uid)

        if days is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
            where.append("timestamp_utc >= ?")
            params.append(cutoff)

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        conn = self._get_conn()
        try:
            total_row = conn.execute(
                f"SELECT COUNT(*) as c FROM audit_log {where_sql}",
                tuple(params),
            ).fetchone()
            total = int(total_row["c"]) if total_row else 0

            offset = (page - 1) * limit
            rows = conn.execute(
                f"""
                SELECT *
                FROM audit_log
                {where_sql}
                ORDER BY timestamp_utc DESC
                LIMIT ? OFFSET ?
                """,
                tuple(params + [limit, offset]),
            ).fetchall()

            records: List[Dict[str, Any]] = []
            for r in rows:
                memo = ""
                if r["metadata"]:
                    try:
                        m_obj = json.loads(r["metadata"])
                        if isinstance(m_obj, dict):
                            memo = str(m_obj.get("memo", "")) if m_obj.get("memo") is not None else ""
                        else:
                            memo = str(m_obj)
                    except Exception:
                        memo = str(r["metadata"])

                records.append(
                    {
                        "id": r["id"],
                        "submission_id": r["submission_id"],
                        "action_type": r["action_type"],
                        "performed_by_uid": r["performed_by_uid"],
                        "performed_by_name": r["performed_by_name"],
                        "performed_by_role": r["performed_by_role"],
                        "timestamp_utc": r["timestamp_utc"],
                        # Admin UI expects a flat memo string
                        "memo": memo,
                    }
                )

            return {"records": records, "total_count": total}
        finally:
            conn.close()

    def get_all_audit_for_export(
        self,
        action_type: Optional[str] = None,
        uid: Optional[str] = None,
        days: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Return audit log rows for CSV export (unpaginated)."""
        where: List[str] = []
        params: List[Any] = []

        if action_type:
            where.append("action_type = ?")
            params.append(action_type)
        if uid:
            where.append("performed_by_uid = ?")
            params.append(uid)
        if days is not None:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=int(days))).isoformat()
            where.append("timestamp_utc >= ?")
            params.append(cutoff)

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        conn = self._get_conn()
        try:
            rows = conn.execute(
                f"""
                SELECT *
                FROM audit_log
                {where_sql}
                ORDER BY timestamp_utc DESC
                """,
                tuple(params),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # ── Route Tracker (read-only analytics) ──────────────────────────────────

    def get_route_tracker_data(
        self,
        submissions_db_path: str,
        event_type: Optional[str] = None,
        network_id: Optional[int] = None,
        days: Optional[int] = None,
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build the authoritative route tracker timeline and stats.

        This is append-only, derived entirely from `audit_log` (PIPELINE_COMPLETE)
        and read-only views of `submissions.db` and `flights.db`.
        """
        # Normalize filters
        normalized_event = None
        if event_type:
            et = event_type.upper()
            if et in ("NEW_ROUTE", "NEW"):
                normalized_event = "NEW_ROUTE"
            elif et in ("UPDATE", "ROUTE_UPDATE"):
                normalized_event = "UPDATE"

        # Open connections (read-only where possible)
        conn_audit = self._get_conn()
        conn_sub: Optional[sqlite3.Connection] = None
        conn_flights: Optional[sqlite3.Connection] = None

        try:
            # Submissions DB
            conn_sub = sqlite3.connect(submissions_db_path)
            conn_sub.row_factory = sqlite3.Row

            # Flights DB (for network_id mapping, if available)
            flights_db_path = None
            # flights.db typically lives alongside submissions.db in instance dir
            try:
                from pathlib import Path

                flights_db_candidate = Path(submissions_db_path).parent / "flights.db"
                if flights_db_candidate.exists():
                    flights_db_path = str(flights_db_candidate)
            except Exception:
                flights_db_path = None

            if flights_db_path:
                conn_flights = sqlite3.connect(flights_db_path)
                conn_flights.row_factory = sqlite3.Row
            # Map: network_name -> id
            network_name_to_id: Dict[str, int] = {}
            if conn_flights:
                try:
                    rows = conn_flights.execute(
                        "SELECT id, name FROM networks"
                    ).fetchall()
                    for r in rows:
                        network_name_to_id[r["name"]] = r["id"]
                except Exception:
                    network_name_to_id = {}

            # Build base audit query
            params: List[Any] = [AuditActionType.PIPELINE_COMPLETE.value]
            where_clauses = ["action_type = ?"]

            if days is not None:
                cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
                where_clauses.append("timestamp_utc >= ?")
                params.append(cutoff)

            query = f"""
                SELECT *
                FROM audit_log
                WHERE {' AND '.join(where_clauses)}
                ORDER BY timestamp_utc DESC
            """
            audit_rows = conn_audit.execute(query, tuple(params)).fetchall()

            events: List[Dict[str, Any]] = []

            # Preload submissions into map for fast lookup
            sub_rows = conn_sub.execute(
                """
                SELECT
                    id,
                    payload,
                    submission_type,
                    changed_fields,
                    branch_name,
                    branch_merged,
                    submitted_by_name,
                    submitted_by_role,
                    serial_id
                FROM submissions
            """
            ).fetchall()
            submissions_by_id: Dict[str, sqlite3.Row] = {r["id"]: r for r in sub_rows}

            for row in audit_rows:
                sub_id = row["submission_id"]
                s = submissions_by_id.get(sub_id)
                if not s:
                    continue

                submission_type = (s["submission_type"] or "NEW_ROUTE").upper()
                event_label = (
                    "NEW ROUTE" if submission_type == "NEW_ROUTE" else "ROUTE UPDATE"
                )

                if normalized_event and (
                    (normalized_event == "NEW_ROUTE" and event_label != "NEW ROUTE")
                    or (normalized_event == "UPDATE" and event_label != "ROUTE UPDATE")
                ):
                    continue

                # Decode payload and changed_fields
                try:
                    payload = json.loads(s["payload"])
                except Exception:
                    payload = {}

                changed_fields_obj: Optional[Dict[str, Dict[str, Any]]] = None
                if s["changed_fields"]:
                    try:
                        changed_fields_obj = json.loads(s["changed_fields"])
                    except Exception:
                        changed_fields_obj = None

                # Basic fields from payload
                src_lz = payload.get("source_takeoff_zone_name") or payload.get(
                    "source_location_name", ""
                )
                dst_lz = payload.get("destination_landing_zone_name") or payload.get(
                    "destination_location_name", ""
                )
                route_str = f"{src_lz} → {dst_lz}"
                network_name = payload.get("network_name", "")

                # Optional network_id filter (derived via name)
                if network_id is not None:
                    derived_id = network_name_to_id.get(network_name)
                    if derived_id is None or derived_id != network_id:
                        continue

                # Text search filter
                if search:
                    term = search.lower()
                    human_id = f"RW-{s['serial_id']}" if s["serial_id"] is not None else ""
                    haystack = " ".join(
                        [
                            sub_id.lower(),
                            human_id.lower(),
                            route_str.lower(),
                            network_name.lower(),
                        ]
                    )
                    if term not in haystack:
                        continue

                human_id = (
                    f"RW-{s['serial_id']}" if s["serial_id"] is not None else sub_id
                )
                meta = None
                if row["metadata"]:
                    try:
                        meta = json.loads(row["metadata"])
                    except Exception:
                        meta = None

                branch_name = s["branch_name"]
                is_merged = bool(s["branch_merged"]) if "branch_merged" in s.keys() else False

                events.append(
                    {
                        "id": row["id"],
                        "submission_id": sub_id,
                        "human_id": human_id,
                        "event_type": event_label,
                        "route": route_str,
                        "network": network_name,
                        "branch_name": branch_name,
                        "performed_by_name": row["performed_by_name"] or s["submitted_by_name"],
                        "performed_by_role": row["performed_by_role"] or s["submitted_by_role"],
                        "timestamp": row["timestamp_utc"],
                        "is_merged": is_merged,
                        "changed_fields": changed_fields_obj,
                        "payload": payload,
                    }
                )

            # Stats for current month
            now = datetime.now(timezone.utc)
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

            total_pushed = 0
            new_routes = 0
            updates = 0
            network_counts: Dict[str, int] = {}
            weekly_counts: List[int] = [0] * 8
            last_push: Optional[Dict[str, Any]] = None

            for ev in events:
                ts_raw = ev.get("timestamp") if isinstance(ev, dict) else None
                if not ts_raw:
                    continue
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
                if ts >= month_start:
                    total_pushed += 1
                    if ev.get("event_type") == "NEW ROUTE":
                        new_routes += 1
                    else:
                        updates += 1
                    net = ev.get("network")
                    if net:
                        network_counts[net] = network_counts.get(net, 0) + 1

                # Weekly buckets (0 = this week, 7 = 7 weeks ago)
                week_delta = int((now - ts).days // 7)
                if 0 <= week_delta < 8:
                    weekly_counts[7 - week_delta] += 1

                if last_push is None or ts > datetime.fromisoformat(
                    last_push["timestamp"].replace("Z", "+00:00")
                ):
                    last_push = {
                        "timestamp": ev.get("timestamp"),
                        "branch_name": ev.get("branch_name"),
                        "performed_by_name": ev.get("performed_by_name"),
                        "performed_by_role": ev.get("performed_by_role"),
                    }

            most_active_network = None
            if network_counts:
                most_active_network = max(network_counts.items(), key=lambda x: x[1])[0]

            stats = {
                "total_pushed_this_month": total_pushed,
                "new_routes_this_month": new_routes,
                "updates_this_month": updates,
                "most_active_network_month": most_active_network,
                "last_push": last_push,
                "weekly_pushes": weekly_counts,
            }

            return {"events": events, "stats": stats}
        finally:
            conn_audit.close()
            if conn_sub is not None:
                conn_sub.close()
            if conn_flights is not None:
                conn_flights.close()

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
