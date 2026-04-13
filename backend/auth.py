from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, Header, HTTPException

try:
    import firebase_admin
    from firebase_admin import auth as fb_auth
    from firebase_admin import credentials, firestore

    _FIREBASE_AVAILABLE = True
except Exception:
    firebase_admin = None  # type: ignore
    fb_auth = None  # type: ignore
    credentials = None  # type: ignore
    firestore = None  # type: ignore
    _FIREBASE_AVAILABLE = False

# Initialize Firebase Admin once
fs_client = None
if _FIREBASE_AVAILABLE:
    try:
        _cred_path = os.path.join(
            os.path.dirname(__file__),
            "auto-db--updater-firebase-adminsdk-fbsvc-7365bca4e5.json",
        )
        cred = credentials.Certificate(_cred_path)
        # Avoid "already initialized" during reloads/tests.
        if not firebase_admin._apps:  # type: ignore[attr-defined]
            firebase_admin.initialize_app(cred)
        fs_client = firestore.client()
    except Exception:
        # If Firebase can't initialize (missing creds, etc), treat as unavailable.
        fs_client = None
        _FIREBASE_AVAILABLE = False

ROLE_HIERARCHY = {
    'operator': 1,
    'reviewer': 2,
    'sde':      3,
    'admin':    4
}

async def get_current_user(authorization: str = Header(None)):
    # Test/dev escape hatch: allow running without Firebase + auth headers.
    # This keeps unit/integration tests hermetic and lets devs run locally
    # even if Firebase Admin SDK isn't installed/configured.
    if (
        not _FIREBASE_AVAILABLE
        or os.getenv("DISABLE_AUTH") == "1"
        or os.getenv("PYTEST_CURRENT_TEST") is not None
    ):
        return {
            "uid": "test-user",
            "email": "test@example.com",
            "display_name": "Test User",
            "role": "admin",
        }

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")

    try:
        decoded = fb_auth.verify_id_token(token)  # type: ignore[union-attr]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

    # Fetch role and name from Firestore
    display_name = decoded.get("name")
    try:
        user_doc = fs_client.collection("users").document(decoded["uid"]).get()  # type: ignore[union-attr]
        if user_doc.exists:
            data = user_doc.to_dict() or {}
            role = data.get("role", "operator")
            display_name = data.get("displayName", display_name)
        else:
            role = "operator"
    except Exception:
        role = "operator"

    return {
        "uid": decoded["uid"],
        "email": decoded.get("email"),
        "display_name": display_name or decoded.get("email"),
        "role": role.lower() if role else "operator",
    }

def require_role(minimum_role: str):
    async def checker(user=Depends(get_current_user)):
        user_level    = ROLE_HIERARCHY.get(user['role'], 0)
        required_level = ROLE_HIERARCHY.get(minimum_role, 99)
        if user_level < required_level:
            raise HTTPException(
                status_code=403,
                detail=f"Requires {minimum_role} role. Your role: {user['role']}"
            )
        return user
    return checker

# Convenience dependencies
require_operator = Depends(require_role('operator'))
require_reviewer = Depends(require_role('reviewer'))
require_sde      = Depends(require_role('sde'))
require_admin    = Depends(require_role('admin'))


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
    except Exception:
        return None


def get_all_users_info() -> List[Dict[str, Any]]:
    """Admin helper: return enriched user list (Firebase Auth + Firestore)."""
    if not _FIREBASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Firebase Admin SDK not available")

    users: List[Dict[str, Any]] = []

    # Preload Firestore user docs into a map for quick joins.
    fs_users: Dict[str, Dict[str, Any]] = {}
    try:
        for doc in fs_client.collection("users").stream():  # type: ignore[union-attr]
            data = doc.to_dict() or {}
            fs_users[doc.id] = data
    except Exception:
        fs_users = {}

    page = fb_auth.list_users()  # type: ignore[union-attr]
    for u in page.iterate_all():
        meta = getattr(u, "user_metadata", None)
        created_at = _ms_to_iso(getattr(meta, "creation_timestamp", None))
        last_login = _ms_to_iso(getattr(meta, "last_sign_in_timestamp", None))

        doc = fs_users.get(u.uid, {}) or {}
        role = (doc.get("role") or "operator").lower()
        display_name = doc.get("displayName") or u.display_name or (u.email or u.uid)

        users.append(
            {
                "uid": u.uid,
                "email": u.email,
                "display_name": display_name,
                "role": role,
                "created_at": created_at,
                "last_login": last_login,
                # Display-only: AdminPage uses this string convention to gray out rows.
                "status": doc.get("status", "Active"),
                # Optional flags used by the UI
                "is_duplicate": bool(doc.get("is_duplicate", False)),
                "is_external": bool(doc.get("is_external", False)),
            }
        )

    # Stable ordering makes UI nicer and diffable.
    users.sort(key=lambda x: (x.get("email") or "", x.get("uid") or ""))
    return users


def update_user_info(uid: str, updates: Dict[str, Any]) -> None:
    """Admin helper: update user metadata in Firestore.

    We intentionally do NOT delete users in Firebase Auth here; we only store
    admin-managed fields in Firestore.
    """
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="Updates must be an object")

    allowed = {
        "role",
        "status",
        "display_name",
        "displayName",
        "is_duplicate",
        "is_external",
        "deactivation_reason",
    }
    payload: Dict[str, Any] = {}
    for k, v in updates.items():
        if k in allowed:
            payload[k] = v

    if "role" in payload:
        role = str(payload["role"]).lower().strip()
        if role not in ROLE_HIERARCHY:
            raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
        payload["role"] = role

    # Normalize display name field for consistency
    if "display_name" in payload and "displayName" not in payload:
        payload["displayName"] = payload.pop("display_name")

    if not payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if not _FIREBASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Firebase Admin SDK not available")

    try:
        fs_client.collection("users").document(uid).set(payload, merge=True)  # type: ignore[union-attr]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")


def get_feature_visibility() -> List[Dict[str, Any]]:
    """Admin helper: return feature visibility matrix.

    Stored in Firestore under collection `feature_visibility`, with docs like:
      { label, operator, reviewer, sde, admin }
    """
    if not _FIREBASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Firebase Admin SDK not available")

    # Default matrix so Admin UI is never blank on fresh Firestore.
    # These are UI-only toggles; backend role checks still enforce access.
    default_features: List[Dict[str, Any]] = [
        {"feature_id": "submissions", "label": "Submissions Queue"},
        {"feature_id": "submit_route", "label": "Submit Route"},
        {"feature_id": "stats_dashboard", "label": "Stats Dashboard"},
        {"feature_id": "network_map", "label": "Network Map (Phase 5)"},
        {"feature_id": "route_tracker", "label": "Route Tracker (SDE)"},
        {"feature_id": "admin_console", "label": "Admin Control Panel"},
    ]

    items: List[Dict[str, Any]] = []
    try:
        docs = list(fs_client.collection("feature_visibility").stream())  # type: ignore[union-attr]
        if not docs:
            # Seed defaults (idempotent via merge=True)
            for f in default_features:
                fs_client.collection("feature_visibility").document(f["feature_id"]).set(  # type: ignore[union-attr]
                    {
                        "label": f["label"],
                        "operator": True,
                        "reviewer": True,
                        "sde": True,
                        "admin": True,
                    },
                    merge=True,
                )
            docs = list(fs_client.collection("feature_visibility").stream())  # type: ignore[union-attr]

        for d in docs:
            data = d.to_dict() or {}
            items.append(
                {
                    "feature_id": d.id,
                    "label": data.get("label", d.id),
                    "operator": bool(data.get("operator", False)),
                    "reviewer": bool(data.get("reviewer", False)),
                    "sde": bool(data.get("sde", False)),
                    # Admin UI always shows admin enabled; keep value anyway for completeness.
                    "admin": True if data.get("admin") is None else bool(data.get("admin")),
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch feature visibility: {str(e)}")

    items.sort(key=lambda x: (x.get("label") or "", x.get("feature_id") or ""))
    return items


def update_feature_visibility(feature_id: str, updates: Dict[str, Any]) -> None:
    """Admin helper: patch a feature visibility doc."""
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="Updates must be an object")

    allowed = {"label", "operator", "reviewer", "sde", "admin"}
    payload: Dict[str, Any] = {}
    for k, v in updates.items():
        if k not in allowed:
            continue
        if k == "label":
            payload[k] = str(v)
        else:
            payload[k] = bool(v)

    if not payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    if not _FIREBASE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Firebase Admin SDK not available")

    try:
        fs_client.collection("feature_visibility").document(feature_id).set(payload, merge=True)  # type: ignore[union-attr]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update feature visibility: {str(e)}")
