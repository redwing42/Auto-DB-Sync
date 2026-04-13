"""Authentication utilities for RedWing DB Automation.

Provides shared access to system credentials, specifically GNOME Online Accounts
via D-Bus for OAuth2 token retrieval.
"""

from __future__ import annotations

import logging
import re
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)


def get_gnome_oauth_token(account_path: str) -> Optional[str]:
    """Get Google OAuth2 access token from GNOME Online Accounts via D-Bus.

    Args:
        account_path: D-Bus object path for the GNOME account,
            e.g. "/org/gnome/OnlineAccounts/Accounts/account_1773050616_0"

    Returns:
        The access token string, or None if unavailable.
    """
    try:
        # We use session bus because GNOME Online Accounts is a user session service
        result = subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.gnome.OnlineAccounts",
                "--object-path", account_path,
                "--method", "org.gnome.OnlineAccounts.OAuth2Based.GetAccessToken",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            logger.warning("gdbus token fetch failed: %s", result.stderr.strip())
            return None

        # Output format: ('ya29.xxx...', 1519)
        match = re.search(r"'([^']+)'", result.stdout)
        if match:
            token = match.group(1)
            logger.debug("Obtained GNOME OAuth token (length=%d)", len(token))
            return token

        logger.warning("Could not parse gdbus output: %s", result.stdout.strip())
        return None
    except Exception as e:
        logger.error("Error communicating with GNOME Online Accounts: %s", e)
        return None
