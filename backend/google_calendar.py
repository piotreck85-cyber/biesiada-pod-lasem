"""Google Calendar one-way sync (app → Google's dedicated calendar per user).

Design notes:
  • We use standard OAuth 2.0 Web Application flow. The backend owns the client secret.
  • For each user we store an encrypted refresh_token + the id of a dedicated Google
    Calendar called "Biesiada pod Lasem" that we auto-create on connect.
  • Each MongoDB event may hold a `google_event_id` (per user) so we can update/delete.
  • This module intentionally does NOT create routes or open DB connections directly:
    server.py wires up the routes and calls the sync helpers.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("gcal")

CLIENT_ID = os.getenv("GOOGLE_CALENDAR_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("GOOGLE_CALENDAR_CLIENT_SECRET", "").strip()
REDIRECT_URI = os.getenv("GOOGLE_CALENDAR_REDIRECT_URI", "").strip()
ENCRYPTION_KEY = os.getenv("GOOGLE_TOKEN_ENCRYPTION_KEY", "").strip()

# scope 'calendar' is required to CREATE new calendars (calendar.events alone can't).
SCOPES = " ".join([
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CAL_API = "https://www.googleapis.com/calendar/v3"

CAL_TITLE = "Biesiada pod Lasem"
CAL_DESCRIPTION = "Kalendarz imprez z aplikacji Biesiada pod Lasem (auto-sync)."
CAL_TIMEZONE = "Europe/Warsaw"

_fernet: Optional[Fernet] = None


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        if not ENCRYPTION_KEY:
            raise RuntimeError("GOOGLE_TOKEN_ENCRYPTION_KEY not configured")
        _fernet = Fernet(ENCRYPTION_KEY.encode())
    return _fernet


def is_configured() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET and REDIRECT_URI and ENCRYPTION_KEY)


def encrypt_token(t: str) -> str:
    return _f().encrypt(t.encode()).decode()


def decrypt_token(t: str) -> str:
    return _f().decrypt(t.encode()).decode()


# --------------- OAuth flow -----------------

def build_authorization_url(state: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_tokens(code: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(TOKEN_URL, data={
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
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
        # invalid_grant → user revoked / expired
        log.warning(f"Refresh failed: {r.status_code} {r.text[:300]}")
        return None
    return r.json().get("access_token")


# --------------- REST helpers ---------------

async def _api_request(access_token: str, method: str, path: str, *,
                       json_body: Any = None, params: Optional[dict] = None) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.request(
            method, f"{CAL_API}{path}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=json_body, params=params,
        )
    if r.status_code == 204:
        return None
    if r.status_code >= 400:
        # Return structured error for caller to interpret
        raise RuntimeError(f"Google API {method} {path} → {r.status_code}: {r.text[:400]}")
    try:
        return r.json()
    except Exception:
        return None


async def create_dedicated_calendar(access_token: str) -> dict:
    """POST /calendars — create a fresh dedicated calendar in the user's account."""
    body = {"summary": CAL_TITLE, "description": CAL_DESCRIPTION, "timeZone": CAL_TIMEZONE}
    return await _api_request(access_token, "POST", "/calendars", json_body=body) or {}


async def find_calendar_by_summary(access_token: str, summary: str) -> Optional[dict]:
    """List calendar list and return the one matching summary (case-insensitive)."""
    data = await _api_request(access_token, "GET", "/users/me/calendarList", params={"maxResults": 250})
    items = (data or {}).get("items") or []
    for c in items:
        if (c.get("summary") or "").strip().lower() == summary.strip().lower():
            return c
    return None


# --------------- Event body builder ---------------

def build_event_body(ev: dict) -> dict:
    """Translate a Mongo event doc into a Google Calendar event body."""
    name = ev.get("name") or "Impreza"
    status = (ev.get("status") or "").lower()
    status_label = {
        "wstepne": "Wstępne zapytanie",
        "rezerwacja": "Rezerwacja",
        "potwierdzona": "Potwierdzona",
        "zakonczona": "Zakończona",
        "anulowana": "Anulowana",
    }.get(status)
    summary = f"[{status_label}] {name}" if status_label else name

    date_s = str(ev.get("date") or "")  # YYYY-MM-DD
    t_start = (ev.get("time_start") or "").strip()
    t_end = (ev.get("time_end") or "").strip()

    def _to_dt(dstr: str, tstr: str) -> Optional[datetime]:
        try:
            y, m, d = [int(x) for x in dstr.split("-")]
            if tstr and ":" in tstr:
                hh, mm = [int(x) for x in tstr.split(":")[:2]]
            else:
                hh, mm = 12, 0
            return datetime(y, m, d, hh, mm)
        except Exception:
            return None

    start_dt = _to_dt(date_s, t_start)
    end_dt = _to_dt(date_s, t_end)
    if not start_dt:
        # Fallback: all-day event
        start_field = {"date": date_s}
        # Google requires end.date to be day after
        try:
            y, m, d = [int(x) for x in date_s.split("-")]
            end_field = {"date": (datetime(y, m, d) + timedelta(days=1)).strftime("%Y-%m-%d")}
        except Exception:
            end_field = start_field
    else:
        if not end_dt or end_dt <= start_dt:
            end_dt = start_dt + timedelta(hours=4)
        start_field = {"dateTime": start_dt.isoformat(), "timeZone": CAL_TIMEZONE}
        end_field = {"dateTime": end_dt.isoformat(), "timeZone": CAL_TIMEZONE}

    desc_parts: list[str] = []
    if ev.get("client_name"): desc_parts.append(f"Klient: {ev['client_name']}")
    if ev.get("client_phone"): desc_parts.append(f"Tel.: {ev['client_phone']}")
    if ev.get("client_email"): desc_parts.append(f"Email: {ev['client_email']}")
    if ev.get("people"): desc_parts.append(f"Osób: {ev['people']}")
    if ev.get("category"): desc_parts.append(f"Kategoria: {ev['category']}")
    if ev.get("price_total"): desc_parts.append(f"Wartość: {ev['price_total']} zł")
    if ev.get("notes"): desc_parts.append(f"Uwagi: {ev['notes']}")
    description = "\n".join(desc_parts)

    body = {
        "summary": summary,
        "description": description,
        "location": ev.get("venue") or "Kielce, ul. Zastawie 4",
        "start": start_field,
        "end": end_field,
    }
    # Map "anulowana" to Google's cancelled status so it grays out
    if status == "anulowana":
        body["status"] = "cancelled"
    return body


# --------------- CRUD wrappers ---------------

async def create_event(access_token: str, calendar_id: str, ev: dict) -> dict:
    return await _api_request(
        access_token, "POST",
        f"/calendars/{calendar_id}/events",
        json_body=build_event_body(ev),
        params={"sendUpdates": "none"},
    ) or {}


async def update_event(access_token: str, calendar_id: str, google_event_id: str, ev: dict) -> dict:
    return await _api_request(
        access_token, "PATCH",
        f"/calendars/{calendar_id}/events/{google_event_id}",
        json_body=build_event_body(ev),
        params={"sendUpdates": "none"},
    ) or {}


async def delete_event(access_token: str, calendar_id: str, google_event_id: str) -> None:
    try:
        await _api_request(
            access_token, "DELETE",
            f"/calendars/{calendar_id}/events/{google_event_id}",
            params={"sendUpdates": "none"},
        )
    except RuntimeError as e:
        # Treat 404/410 (already deleted) as success
        if "404" in str(e) or "410" in str(e):
            return
        raise


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_state() -> str:
    return secrets.token_urlsafe(32)
