import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from email_service import _send_email

logging.basicConfig(level=logging.INFO)

async def test_send():
    print("Attempting to send test email via Gmail SMTP (XOAUTH2)...")
    try:
        await _send_email(
            to=["chirag.mt@redwinglabs.in"],
            subject="[RedWing] Test Gmail SMTP Send",
            html="<h1>Success!</h1><p>This was sent via Gmail SMTP with XOAUTH2 using your GNOME Online Accounts token.</p>",
        )
        print("\n✅ Success! Email dispatched via Gmail SMTP.")
        print("Check your chirag.mt@redwinglabs.in inbox.")
    except Exception as e:
        print(f"\n❌ Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_send())
