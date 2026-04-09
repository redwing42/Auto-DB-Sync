"""Async email notification service for RedWing DB Automation.

Uses Gmail SMTP with XOAUTH2 authentication via GNOME Online Accounts.
All sends run as background tasks and never block the API response.
Failed sends are logged to audit.db.

Recipients are fetched dynamically from Firebase Firestore users collection.
"""

from __future__ import annotations

import asyncio
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict, List, Optional

from auth_utils import get_gnome_oauth_token

logger = logging.getLogger(__name__)


# ── Firestore Recipient Lookup ───────────────────────────────────────────────

def _get_users_by_role(min_role: str) -> List[Dict[str, str]]:
    """Fetch users from Firestore whose role is >= min_role.

    Returns list of dicts with 'email', 'display_name', 'role' keys.
    """
    from auth import fs_client, ROLE_HIERARCHY

    min_level = ROLE_HIERARCHY.get(min_role, 0)
    users = []
    try:
        docs = fs_client.collection("users").stream()
        for doc in docs:
            data = doc.to_dict()
            role = data.get("role", "operator")
            level = ROLE_HIERARCHY.get(role, 0)
            if level >= min_level and data.get("email"):
                users.append({
                    "email": data["email"],
                    "display_name": data.get("display_name", data["email"]),
                    "role": role,
                })
    except Exception as e:
        logger.error(f"Failed to fetch users from Firestore: {e}")
    return users


def _get_users_with_role(role: str) -> List[Dict[str, str]]:
    """Fetch users from Firestore with exactly the given role."""
    from auth import fs_client

    users = []
    try:
        docs = fs_client.collection("users").where("role", "==", role).stream()
        for doc in docs:
            data = doc.to_dict()
            if data.get("email"):
                users.append({
                    "email": data["email"],
                    "display_name": data.get("display_name", data["email"]),
                    "role": role,
                })
    except Exception as e:
        logger.error(f"Failed to fetch users with role {role}: {e}")
    return users


def _get_reviewers_and_sdes() -> List[Dict[str, str]]:
    """Get all Reviewers and SDEs."""
    reviewers = _get_users_with_role("reviewer")
    sdes = _get_users_with_role("sde")
    return reviewers + sdes


def _get_admins() -> List[Dict[str, str]]:
    """Get all Admin users."""
    return _get_users_with_role("admin")


def _get_sdes() -> List[Dict[str, str]]:
    """Get all SDE users."""
    return _get_users_with_role("sde")


# ── Email Templates ──────────────────────────────────────────────────────────

def _email_html(title: str, body_html: str, link_url: str = "", link_text: str = "View Submission") -> str:
    """Wrap body content in branded HTML email template."""
    link_block = ""
    if link_url:
        link_block = f"""
        <tr>
          <td style="padding:20px 30px 10px;">
            <a href="{link_url}"
               style="display:inline-block;padding:10px 24px;
                      background:#2563eb;color:#fff;text-decoration:none;
                      border-radius:6px;font-size:14px;font-weight:600;">
              {link_text}
            </a>
          </td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr>
          <td style="padding:24px 30px;border-bottom:2px solid #2563eb;">
            <strong style="font-size:18px;color:#111;">🦅 RedWing DB Automation</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 30px;">
            <h2 style="margin:0 0 16px;color:#111;font-size:18px;">{title}</h2>
            {body_html}
          </td>
        </tr>
        {link_block}
        <tr>
          <td style="padding:20px 30px;border-top:1px solid #e5e7eb;
                     color:#6b7280;font-size:12px;">
            This is an automated notification from RedWing DB Automation.
            Do not reply to this email.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _detail_table(rows: List[tuple]) -> str:
    """Generate an HTML table for key-value detail rows."""
    trs = ""
    for label, value in rows:
        trs += f"""<tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;width:160px;">{label}</td>
          <td style="padding:6px 0;color:#111;font-size:13px;font-weight:500;">{value}</td>
        </tr>"""
    return f'<table style="width:100%;border-collapse:collapse;">{trs}</table>'


# ── Send Engine ──────────────────────────────────────────────────────────────

async def _send_email(
    to: List[str],
    subject: str,
    html: str,
    bcc: Optional[List[str]] = None,
    submission_id: Optional[str] = None,
) -> None:
    """Send an email via Gmail SMTP with XOAUTH2 using GNOME OAuth2 token."""
    # Tests/dev environments shouldn't require GNOME Online Accounts.
    if os.getenv("PYTEST_CURRENT_TEST") is not None or os.getenv("DISABLE_EMAIL") == "1":
        logger.info("Email disabled; skipping send for subject=%r", subject)
        return

    from config import get_settings
    settings = get_settings()

    # 1. Get OAuth2 Token from GNOME Online Accounts
    token = get_gnome_oauth_token(settings.GNOME_GOA_ACCOUNT_PATH)
    if not token:
        raise RuntimeError("Could not obtain GNOME OAuth2 token for Gmail send")

    try:
        import aiosmtplib

        # 2. Build RFC 2822 Message
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM_ADDRESS}>"

        to_header = ", ".join(to) if to else settings.EMAIL_FROM_ADDRESS
        msg["To"] = to_header
        msg["Subject"] = subject

        # BCC: Always include ADMIN_EMAILS for fail-safe auditing
        bcc_list = list(bcc) if bcc else []
        for admin_email in settings.admin_emails_list:
            if admin_email not in bcc_list:
                bcc_list.append(admin_email)

        if bcc_list:
            msg["Bcc"] = ", ".join(bcc_list)

        msg.attach(MIMEText(html, "html"))

        all_recipients = list(to) + bcc_list

        # 3. Build XOAUTH2 string using the actual Google account (GOA_EMAIL)
        import base64
        goa_email = settings.GOA_EMAIL
        xoauth2_string = f"user={goa_email}\x01auth=Bearer {token}\x01\x01"
        xoauth2_b64 = base64.b64encode(xoauth2_string.encode()).decode()

        # 4. Send via Gmail SMTP with explicit XOAUTH2 AUTH
        #    aiosmtplib v4 auto-STARTTLSes on port 587 during connect()
        smtp = aiosmtplib.SMTP(hostname="smtp.gmail.com", port=587, start_tls=True)
        await smtp.connect()
        await smtp.execute_command(b"AUTH XOAUTH2 " + xoauth2_b64.encode())
        
        await smtp.sendmail(
            goa_email,
            all_recipients,
            msg.as_string(),
        )
        await smtp.quit()
        logger.info(f"Email sent via Gmail SMTP (XOAUTH2): '{subject}' to {to}")

    except Exception as e:
        logger.error(f"Email send failed: {e}")
        # Log failure to audit
        try:
            from audit_store import AuditStore
            from models import AuditActionType

            audit = AuditStore(settings.AUDIT_DB_PATH)
            audit.add_record(
                submission_id=submission_id or "unknown",
                action_type=AuditActionType.EMAIL_FAILED,
                metadata={"error": str(e), "subject": subject, "to": to},
            )
        except Exception as audit_err:
            logger.error(f"Failed to log email failure to audit: {audit_err}")



def _fire_and_forget(coro):
    """Schedule a coroutine as a background task without blocking."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        # No running loop — run synchronously as fallback
        logger.warning("No event loop — running email send synchronously")
        asyncio.run(coro)


# ── Public API ───────────────────────────────────────────────────────────────
# Routing rules:
#   Operator submits   → TO: reviewers,           CC: ADMIN_EMAILS
#   Reviewer validates → TO: SDE,                 CC: ADMIN_EMAILS
#   Reviewer rejects   → TO: operator (submitter), CC: SDE + ADMIN_EMAILS
#   SDE approves       → TO: operator + reviewer,  CC: ADMIN_EMAILS
#   Pipeline failure   → TO: SDE,                 CC: ADMIN_EMAILS
#   Resubmission       → TO: reviewers,           CC: ADMIN_EMAILS
#
# ADMIN_EMAILS (.env) are ALWAYS injected as BCC by _send_email().


def send_submission_notification(submission_id: str, payload, submitter_name: str, submitter_role: str):
    """Operator submitted a route → notify reviewers."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"

    reviewers = _get_users_with_role("reviewer")
    to_emails = [u["email"] for u in reviewers]

    link = f"{settings.FRONTEND_URL}/submissions/{submission_id}"
    body = _detail_table([
        ("Submission ID", human_id),
        ("Type", "Route Update" if getattr(payload, 'is_update', False) else "New Route"),
        ("Route", f"{payload.source_location_name} → {payload.destination_location_name}"),
        ("Network", payload.network_name),
        ("Mission File", payload.mission_filename),
        ("Submitted By", f"{submitter_name} ({submitter_role})"),
    ])
    html = _email_html("New Submission Received", body, link)
    subject = f"[RedWing] New Submission {human_id}: {payload.source_location_name} → {payload.destination_location_name}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        submission_id=submission_id,
    ))


def send_verification_complete(submission_id: str, payload, verifier_name: str, verifier_role: str):
    """Reviewer validated waypoints → notify SDE."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"

    sdes = _get_sdes()
    to_emails = [u["email"] for u in sdes]

    link = f"{settings.FRONTEND_URL}/submissions/{submission_id}?tab=resolution"
    body = _detail_table([
        ("Submission ID", human_id),
        ("Route", f"{payload.source_location_name} → {payload.destination_location_name}"),
        ("Validated By", f"{verifier_name} ({verifier_role})"),
        ("Next Step", "ID Resolution & DB update required"),
    ])
    html = _email_html("Waypoint Validation Complete ✓", body, link, "Review ID Resolution")
    subject = f"[RedWing] Waypoints Validated {human_id}: {payload.source_location_name} → {payload.destination_location_name}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        submission_id=submission_id,
    ))


def send_rejection(submission_id: str, payload, rejector_name: str, rejector_role: str, reason: str):
    """Reviewer rejected → notify operator (submitter), CC SDE."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"

    # TO: the submitting operator
    operators = _get_users_with_role("operator")
    to_emails = [u["email"] for u in operators]

    # BCC: SDE (admin emails are auto-added by _send_email)
    sdes = _get_sdes()
    bcc_emails = [u["email"] for u in sdes]

    link = f"{settings.FRONTEND_URL}/submissions/{submission_id}"
    body = f"""
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px;">
      <strong style="color:#dc2626;">Rejection Reason:</strong>
      <p style="margin:8px 0 0;color:#991b1b;">{reason}</p>
    </div>
    """ + _detail_table([
        ("Submission ID", human_id),
        ("Route", f"{payload.source_location_name} → {payload.destination_location_name}"),
        ("Rejected By", f"{rejector_name} ({rejector_role})"),
    ])
    html = _email_html("Submission Rejected", body, link, "View & Resubmit")
    subject = f"[RedWing] Rejected {human_id}: {payload.source_location_name} → {payload.destination_location_name}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        bcc=bcc_emails,
        submission_id=submission_id,
    ))


def send_approval(submission_id: str, payload, approver_name: str, approver_role: str, branch_name: str = ""):
    """SDE approved / DB updated → notify operator + reviewer."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"

    # TO: operators + reviewers
    operators = _get_users_with_role("operator")
    reviewers = _get_users_with_role("reviewer")
    to_emails = [u["email"] for u in operators] + [u["email"] for u in reviewers]

    link = f"{settings.FRONTEND_URL}/submissions/{submission_id}"
    rows = [
        ("Submission ID", human_id),
        ("Route", f"{payload.source_location_name} → {payload.destination_location_name}"),
        ("DB Updated By", f"{approver_name} ({approver_role})"),
        ("Status", "✅ Database updated — ready for aircraft push"),
    ]
    if branch_name:
        rows.append(("Git Branch", f"<code>{branch_name}</code>"))
    body = _detail_table(rows)
    html = _email_html("Database Updated ✓", body, link)
    subject = f"[RedWing] DB Updated {human_id}: {payload.source_location_name} → {payload.destination_location_name}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        submission_id=submission_id,
    ))


def send_pipeline_failure(submission_id: str, error_step: int, error_detail: str):
    """Pipeline failed → notify SDE."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"

    sdes = _get_sdes()
    to_emails = [u["email"] for u in sdes]

    link = f"{settings.FRONTEND_URL}/submissions/{submission_id}"
    body = f"""
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px;">
      <strong style="color:#dc2626;">Pipeline Failed at Step {error_step}</strong>
      <pre style="margin:8px 0 0;color:#991b1b;font-size:12px;white-space:pre-wrap;">{error_detail}</pre>
    </div>
    """ + _detail_table([
        ("Submission ID", human_id),
        ("Failed Step", str(error_step)),
        ("Action Required", "SDE investigation needed"),
    ])
    html = _email_html("⚠ Pipeline Failure", body, link, "View Submission")
    subject = f"[RedWing] Pipeline Failed {human_id}: Step {error_step}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        submission_id=submission_id,
    ))


def send_resubmission_notification(submission_id: str, payload, original_submission_id: str, submitter_name: str):
    """Route resubmitted → notify reviewers."""
    from config import get_settings
    from submission_store import SubmissionStore
    settings = get_settings()
    store = SubmissionStore(settings.SUBMISSIONS_DB_PATH)
    sub = store.get_submission(submission_id)
    human_id = sub.human_id if sub else f"#{submission_id[:8]}"
    
    orig_sub = store.get_submission(original_submission_id)
    orig_human_id = orig_sub.human_id if orig_sub else f"#{original_submission_id[:8]}"

    reviewers = _get_users_with_role("reviewer")
    to_emails = [u["email"] for u in reviewers]

    link_new = f"{settings.FRONTEND_URL}/submissions/{submission_id}"
    link_original = f"{settings.FRONTEND_URL}/submissions/{original_submission_id}"
    body = _detail_table([
        ("Submission ID", human_id),
        ("Original Submission", f'<a href="{link_original}">{orig_human_id}</a>'),
        ("Route", f"{payload.source_location_name} → {payload.destination_location_name}"),
        ("Resubmitted By", submitter_name),
    ])
    html = _email_html("Submission Resubmitted", body, link_new, "Review Resubmission")
    subject = f"[RedWing] Resubmission {human_id}: {payload.source_location_name} → {payload.destination_location_name}"

    _fire_and_forget(_send_email(
        to=to_emails,
        subject=subject,
        html=html,
        submission_id=submission_id,
    ))
