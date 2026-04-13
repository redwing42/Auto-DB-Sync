"""Configuration for RedWing DB Automation — loaded from .env file."""

from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class Settings(BaseSettings):
    # ── Paths ────────────────────────────────────────────────────────────
    REDWING_REPO_PATH: str = "./RedWingGCS"
    EXCEL_FILENAME: str = "Flight_data_updated.xlsx"
    POPULATE_SCRIPT: str = "populate_data.py"
    GIT_BRANCH: str = "main"
    SUBMISSIONS_DB_PATH: str = "./submissions.db"

    # ── GNOME Online Accounts (for authenticated Google Drive access) ────
    GNOME_GOA_ACCOUNT_PATH: str = "/org/gnome/OnlineAccounts/Accounts/account_1773050616_0"
    GOA_EMAIL: str = "chirag.mt@redwinglabs.in"  # Actual Google account for SMTP XOAUTH2

    # ── Auth & Webhook ───────────────────────────────────────────────────
    WEBHOOK_SECRET: str = "changeme"

    # ── Email & SMTP ─────────────────────────────────────────────────────
    SMTP_HOST: str = "smtp.sendgrid.net"
    SMTP_PORT: int = 587
    SMTP_USER: str = "apikey"
    SMTP_PASSWORD: str = ""
    EMAIL_FROM_ADDRESS: str = "notifications@redwinglabs.in"
    EMAIL_FROM_NAME: str = "RedWing DB Automation"
    ADMIN_EMAILS: str = "management@redwinglabs.in"

    # ── Frontend URL (for email deep links) ──────────────────────────────
    FRONTEND_URL: str = "https://auto-db--updater.web.app"

    # ── Audit DB ─────────────────────────────────────────────────────────
    AUDIT_DB_PATH: str = "./audit.db"

    # ── Server ───────────────────────────────────────────────────────────
    NGROK_DOMAIN: str = ""

    # ── Frontend ─────────────────────────────────────────────────────────
    CESIUM_ION_TOKEN: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # ── Pipeline ─────────────────────────────────────────────────────────
    ENABLE_GIT_PUSH: bool = True

    model_config = ConfigDict(
        env_file=os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        ),
        env_file_encoding="utf-8",
    )

    # ── Derived Paths ────────────────────────────────────────────────────

    @property
    def repo_path(self) -> Path:
        return Path(self.REDWING_REPO_PATH).resolve()

    @property
    def excel_path(self) -> Path:
        return self.repo_path / self.EXCEL_FILENAME

    @property
    def missions_dir(self) -> Path:
        return self.repo_path / "missions"

    @property
    def images_dir(self) -> Path:
        return self.repo_path / "frontend" / "public" / "Elevation and flight routes"

    @property
    def instance_dir(self) -> Path:
        return self.repo_path / "instance"

    @property
    def admin_emails_list(self) -> list[str]:
        return [e.strip() for e in self.ADMIN_EMAILS.split(",") if e.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
