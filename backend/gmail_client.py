"""Gmail read-only integration.

Design:
- Uses the SAME Google Cloud OAuth client as Calendar (GOOGLE_CALENDAR_CLIENT_ID/SECRET),
  but with a DIFFERENT redirect URI (`/api/gmail/oauth/callback`) and DIFFERENT scope.
- Only requests `https://www.googleapis.com/auth/gmail.readonly` — no send/modify/delete.
- Refresh tokens are Fernet-encrypted with the SAME key (GOOGLE_TOKEN_ENCRYPTION_KEY).
- Data is stored in a separate collection `gmail_connections` — Calendar tokens untouched.
- Only ALLOWED_EMAIL may complete the OAuth flow. Any other e-mail is rejected.
- Tokens are NEVER logged (masked in any log statements).
"""

from __future__ import annotations

import base64
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("gmail")

CLIENT_ID = os.getenv("GOOGLE_CALENDAR_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("GOOGLE_CALENDAR_CLIENT_SECRET", "").strip()
REDIRECT_URI = os.getenv("GOOGLE_GMAIL_REDIRECT_URI", "").strip()  # may be empty; auto-derived
ENCRYPTION_KEY = os.getenv("GOOGLE_TOKEN_ENCRYPTION_KEY", "").strip()

# ONLY this Gmail account may connect.
ALLOWED_EMAIL = "biesiadapodlasem@gmail.com"

# READ-ONLY scope. Nothing else.
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1"

# Business keywords for inbox filter. Whole-thread inclusion happens by threadId.
KEYWORDS = [
    "oferta", "zapytanie", "cena", "koszt", "wycena",
    "wolny termin", "dostępność", "rezerwacja",
    "impreza", "przyjęcie", "urodziny", "chrzciny", "komunia",
    "ślub", "wesele", "wycieczka", "warsztaty",
    "impreza firmowa", "integracja",
]

_fernet: Optional[Fernet] = None


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        if not ENCRYPTION_KEY:
            raise RuntimeError("GOOGLE_TOKEN_ENCRYPTION_KEY not set")
        _fernet = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)
    return _fernet


def encrypt_token(t: str) -> str:
    return _f().encrypt(t.encode()).decode()


def decrypt_token(t: str) -> str:
    return _f().decrypt(t.encode()).decode()


def _mask(t: Optional[str]) -> str:
    if not t:
        return "<empty>"
    return t[:6] + "…" + t[-4:] if len(t) > 12 else "<short>"


# --------------- OAuth flow -----------------

def resolve_redirect_uri(request_host: Optional[str] = None) -> str:
    """Prefer explicit env var; fall back to the current request host."""
    if REDIRECT_URI:
        return REDIRECT_URI
    if request_host:
        # host already includes scheme
        return f"{request_host.rstrip('/')}/api/gmail/oauth/callback"
    raise RuntimeError("GOOGLE_GMAIL_REDIRECT_URI not set and no request host available")


def build_authorization_url(state: str, redirect_uri: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        # Include OIDC scopes so /userinfo works to verify email
        "scope": " ".join([SCOPE, "openid", "email", "profile"]),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "login_hint": ALLOWED_EMAIL,  # Hint the correct account
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(TOKEN_URL, data={
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    if r.is_error:
        log.warning(f"OAuth exchange failed: {r.status_code} {r.text[:300]}")
        raise RuntimeError(f"OAuth exchange failed: {r.status_code}")
    return r.json()


async def refresh_access_token(refresh_token: str) -> Optional[str]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(TOKEN_URL, data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    if r.is_error:
        log.warning(f"Gmail token refresh failed: {r.status_code}")
        return None
    return r.json().get("access_token")


async def fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if r.is_error:
        raise RuntimeError(f"userinfo failed: {r.status_code}")
    return r.json()


# --------------- Gmail API helpers -----------------

def _build_search_query() -> str:
    """Build a Gmail search query: INBOX + any of the keywords + threads."""
    # Wrap multi-word keywords in quotes so Gmail treats them as phrases
    parts = []
    for k in KEYWORDS:
        if " " in k:
            parts.append(f'"{k}"')
        else:
            parts.append(k)
    kw = " OR ".join(parts)
    # Newer than 6 months to keep the list reasonable
    return f"in:inbox -in:spam -in:trash newer_than:6m ({kw})"


async def list_messages(access_token: str, limit: int = 25) -> list[dict]:
    """List inbox messages matching business keywords (whole-thread expansion below)."""
    q = _build_search_query()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{GMAIL_API}/users/me/messages",
            params={"q": q, "maxResults": max(1, min(50, limit))},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.is_error:
        raise RuntimeError(f"list_messages failed: {r.status_code}")
    msgs = r.json().get("messages", []) or []
    return msgs


async def get_message_meta(access_token: str, msg_id: str) -> dict:
    """Fetch message headers + snippet only (fast)."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{GMAIL_API}/users/me/messages/{msg_id}",
            params={"format": "metadata", "metadataHeaders": ["From", "To", "Subject", "Date"]},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.is_error:
        raise RuntimeError(f"get_message_meta failed: {r.status_code}")
    return r.json()


async def get_message_full(access_token: str, msg_id: str) -> dict:
    """Fetch full message body + attachments metadata."""
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.get(
            f"{GMAIL_API}/users/me/messages/{msg_id}",
            params={"format": "full"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.is_error:
        raise RuntimeError(f"get_message_full failed: {r.status_code}")
    return r.json()


async def get_thread(access_token: str, thread_id: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{GMAIL_API}/users/me/threads/{thread_id}",
            params={"format": "metadata", "metadataHeaders": ["From", "To", "Subject", "Date"]},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.is_error:
        raise RuntimeError(f"get_thread failed: {r.status_code}")
    return r.json()


# --------------- Parsing helpers -----------------

def parse_headers(payload: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in (payload.get("headers") or []):
        name = (h.get("name") or "").lower()
        value = h.get("value") or ""
        if name in ("from", "to", "subject", "date", "cc", "bcc", "reply-to", "message-id"):
            out[name] = value
    return out


def parse_from(header_value: str) -> dict[str, str]:
    """Split 'Name <email@x.com>' into {name, email}."""
    if not header_value:
        return {"name": "", "email": ""}
    m = re.match(r'^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$', header_value)
    if m:
        return {"name": m.group(1).strip(), "email": m.group(2).strip().lower()}
    if "@" in header_value:
        return {"name": "", "email": header_value.strip().strip("<>").lower()}
    return {"name": header_value.strip(), "email": ""}


def _extract_body_parts(payload: dict) -> dict[str, str]:
    """Walk mime tree, return {text, html} decoded from base64url."""
    out = {"text": "", "html": ""}

    def decode_data(data: str) -> str:
        try:
            # Gmail uses URL-safe base64 (no padding)
            padded = data + "=" * ((4 - len(data) % 4) % 4)
            return base64.urlsafe_b64decode(padded.encode()).decode("utf-8", errors="replace")
        except Exception:
            return ""

    def walk(part: dict):
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        data = body.get("data")
        if data:
            decoded = decode_data(data)
            if mime == "text/plain" and not out["text"]:
                out["text"] = decoded
            elif mime == "text/html" and not out["html"]:
                out["html"] = decoded
        for p in (part.get("parts") or []):
            walk(p)

    walk(payload)
    return out


def compact_message(m: dict) -> dict:
    """Compact view of a Gmail message — safe to return to the app."""
    payload = m.get("payload") or {}
    hdrs = parse_headers(payload)
    frm = parse_from(hdrs.get("from", ""))
    to = parse_from(hdrs.get("to", ""))
    ts = m.get("internalDate")
    dt_iso = None
    if ts:
        try:
            dt = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc)
            dt_iso = dt.isoformat()
        except Exception:
            pass

    return {
        "id": m.get("id"),
        "thread_id": m.get("threadId"),
        "label_ids": m.get("labelIds") or [],
        "snippet": m.get("snippet", ""),
        "subject": hdrs.get("subject", ""),
        "from_name": frm["name"],
        "from_email": frm["email"],
        "to_email": to["email"],
        "date": hdrs.get("date", ""),
        "date_iso": dt_iso,
        "unread": "UNREAD" in (m.get("labelIds") or []),
    }


def full_message(m: dict) -> dict:
    """Full message: compact + text body."""
    base = compact_message(m)
    parts = _extract_body_parts(m.get("payload") or {})
    return {**base, "body_text": parts["text"], "body_html": parts["html"]}
