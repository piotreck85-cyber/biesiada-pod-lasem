"""Iteration 16 backend tests: weather multi-provider fallback, 2-day alerts scan,
alerts CRUD, auto-dismiss on status transition, public ICS calendar feed.

Run:
  pytest /app/backend/tests/test_iteration16.py -v --tb=short \
    --junitxml=/app/test_reports/pytest/iter16_results.xml
"""
import os
import uuid
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests

# ---- config ---------------------------------------------------------------
BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://event-profit-tracker.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

# Load mongo config from backend/.env manually (no dotenv dep needed)
def _load_mongo():
    env = {}
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return env.get("MONGO_URL"), env.get("DB_NAME")

MONGO_URL, DB_NAME = _load_mongo()


# ---- fixtures -------------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    """Login with the seeded test credentials."""
    r = s.post(f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
    if r.status_code != 200:
        # register if the user doesn't exist yet
        r = s.post(f"{API}/auth/register", json={"email": "test@eventa.pl", "password": "test123", "name": "Test"})
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["access_token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture(scope="module")
def mongo():
    """Direct (synchronous) mongo access for seeding created_at in the past."""
    from pymongo import MongoClient
    assert MONGO_URL and DB_NAME, "MONGO_URL / DB_NAME missing"
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


# ---- cleanup helper -------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup_test_events(mongo):
    """Remove any lingering TEST -- events + related alerts before and after."""
    def clean():
        events = list(mongo.events.find({"name": {"$regex": r"^TEST"}}, {"_id": 0, "id": 1}))
        ids = [e["id"] for e in events]
        if ids:
            mongo.alerts.delete_many({"event_id": {"$in": ids}})
        mongo.events.delete_many({"name": {"$regex": r"^TEST"}})
    clean()
    yield
    clean()


# ============================================================================
# 1) Weather multi-provider fallback
# ============================================================================
class TestWeather:
    def test_weather_future_within_8_days(self, s, auth):
        d = (datetime.now(timezone.utc).date() + timedelta(days=5)).strftime("%Y-%m-%d")
        r = s.get(f"{API}/weather", params={"date": d, "time_start": "14:00", "time_end": "20:00"},
                  headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("available") is True, f"Expected weather available for {d}, got {data}"
        assert "source" in data and data["source"] in ("open-meteo", "7timer", "wttr.in")
        assert data.get("temp_min") is not None
        assert data.get("temp_max") is not None
        assert "time_window" in data

    def test_weather_past_date(self, s, auth):
        d = (datetime.now(timezone.utc).date() - timedelta(days=3)).strftime("%Y-%m-%d")
        r = s.get(f"{API}/weather", params={"date": d}, headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data.get("available") is False
        # Polish past-date message
        msg = (data.get("message") or "").lower()
        assert "przeszło" in msg or "past" in msg, f"Unexpected message: {data.get('message')}"

    def test_weather_beyond_15_days(self, s, auth):
        d = (datetime.now(timezone.utc).date() + timedelta(days=25)).strftime("%Y-%m-%d")
        r = s.get(f"{API}/weather", params={"date": d}, headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data.get("available") is False
        msg = data.get("message") or ""
        assert "16" in msg or "dni" in msg.lower(), f"Unexpected message: {msg}"


# ============================================================================
# 2) Alerts scan + CRUD
# ============================================================================
class TestAlertsScanAndCrud:
    def _seed_stale_event(self, s, auth, mongo, status="rezerwacja", name_suffix=""):
        """Create event via API then rewind created_at to 3 days ago in DB."""
        future_date = (datetime.now(timezone.utc).date() + timedelta(days=14)).strftime("%Y-%m-%d")
        payload = {
            "name": f"TEST -- stara {status} {name_suffix}".strip(),
            "date": future_date,
            "status": status,
            "client_name": "TEST Klient",
            "client_phone": "+48 000 000 000",
            "guests": 50,
            "price_per_guest": 100,
        }
        r = s.post(f"{API}/events", json=payload, headers=auth["headers"])
        assert r.status_code == 200, r.text
        ev = r.json()
        old_iso = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        mongo.events.update_one(
            {"id": ev["id"]},
            {"$set": {"created_at": old_iso}, "$unset": {"alert_sent": ""}},
        )
        return ev

    def test_scan_creates_alert(self, s, auth, mongo):
        # Clear any pre-existing alerts to isolate
        s.post(f"{API}/alerts/dismiss-all", headers=auth["headers"])
        ev = self._seed_stale_event(s, auth, mongo, status="rezerwacja", name_suffix="A")

        r = s.post(f"{API}/alerts/scan", headers=auth["headers"])
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r = s.get(f"{API}/alerts", headers=auth["headers"])
        assert r.status_code == 200, r.text
        alerts = r.json()
        # Filter for the event we just seeded
        mine = [a for a in alerts if a.get("event_id") == ev["id"]]
        assert len(mine) == 1, f"Expected 1 alert for the seeded event, got: {alerts}"
        a = mine[0]
        for k in ("id", "event_id", "event_name", "event_date", "status", "client_name", "dismissed"):
            assert k in a, f"Missing key {k} in alert {a}"
        assert a["event_id"] == ev["id"]
        assert a["status"] == "rezerwacja"
        assert a["dismissed"] is False

    def test_dismiss_single_alert(self, s, auth, mongo):
        # Fresh seed
        s.post(f"{API}/alerts/dismiss-all", headers=auth["headers"])
        ev = self._seed_stale_event(s, auth, mongo, status="wstepne", name_suffix="B")
        s.post(f"{API}/alerts/scan", headers=auth["headers"])

        alerts = s.get(f"{API}/alerts", headers=auth["headers"]).json()
        target = next((a for a in alerts if a["event_id"] == ev["id"]), None)
        assert target is not None
        r = s.post(f"{API}/alerts/{target['id']}/dismiss", headers=auth["headers"])
        assert r.status_code == 200

        alerts_after = s.get(f"{API}/alerts", headers=auth["headers"]).json()
        assert all(a["id"] != target["id"] for a in alerts_after), "Dismissed alert should not be in list"

    def test_dismiss_all_alerts(self, s, auth, mongo):
        # Seed another to make sure there's at least one
        ev = self._seed_stale_event(s, auth, mongo, status="rezerwacja", name_suffix="C")
        s.post(f"{API}/alerts/scan", headers=auth["headers"])

        r = s.post(f"{API}/alerts/dismiss-all", headers=auth["headers"])
        assert r.status_code == 200
        alerts_after = s.get(f"{API}/alerts", headers=auth["headers"]).json()
        assert alerts_after == [], f"Expected empty, got: {alerts_after}"

    def test_auto_dismiss_on_status_transition(self, s, auth, mongo):
        s.post(f"{API}/alerts/dismiss-all", headers=auth["headers"])
        ev = self._seed_stale_event(s, auth, mongo, status="rezerwacja", name_suffix="D")
        s.post(f"{API}/alerts/scan", headers=auth["headers"])

        alerts_before = s.get(f"{API}/alerts", headers=auth["headers"]).json()
        assert any(a["event_id"] == ev["id"] for a in alerts_before)

        # PUT to change status → out of tracked set
        put_payload = {
            "name": ev["name"],
            "date": ev["date"],
            "status": "potwierdzona",
            "client_name": ev.get("client_name", ""),
            "client_phone": ev.get("client_phone", ""),
            "guests": ev.get("guests", 50),
            "price_per_guest": ev.get("price_per_guest", 100),
        }
        r = s.put(f"{API}/events/{ev['id']}", json=put_payload, headers=auth["headers"])
        assert r.status_code == 200, r.text

        alerts_after = s.get(f"{API}/alerts", headers=auth["headers"]).json()
        mine = [a for a in alerts_after if a["event_id"] == ev["id"]]
        assert mine == [], f"Alert for {ev['id']} should be auto-dismissed. Got: {mine}"


# ============================================================================
# 3) Google Calendar public ICS feed
# ============================================================================
class TestCalendarFeed:
    def test_feed_url_returns_token_and_path(self, s, auth):
        r = s.get(f"{API}/calendar/feed-url", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "path" in data
        token = data["token"]
        assert len(token) == 32
        assert all(c in "0123456789abcdef" for c in token), f"token not 32-hex: {token}"
        assert data["path"] == f"/api/calendar/feed/{token}.ics"

    def test_public_feed_no_auth(self, s, auth):
        info = s.get(f"{API}/calendar/feed-url", headers=auth["headers"]).json()
        token = info["token"]
        # Use a NEW session without any authorization
        anon = requests.Session()
        r = anon.get(f"{BASE_URL}{info['path']}")
        assert r.status_code == 200, r.text
        ct = r.headers.get("Content-Type", "")
        assert "text/calendar" in ct, f"Expected text/calendar, got {ct}"
        body = r.text
        assert body.startswith("BEGIN:VCALENDAR"), f"Body should start with BEGIN:VCALENDAR: {body[:100]}"
        assert "X-WR-CALNAME:Biesiada pod Lasem" in body

    def test_rotate_invalidates_old_token(self, s, auth):
        old = s.get(f"{API}/calendar/feed-url", headers=auth["headers"]).json()
        old_token = old["token"]
        r = s.post(f"{API}/calendar/feed-url/rotate", headers=auth["headers"])
        assert r.status_code == 200
        new = r.json()
        assert new["token"] != old_token
        # Old token should 404
        anon = requests.Session()
        rold = anon.get(f"{BASE_URL}/api/calendar/feed/{old_token}.ics")
        assert rold.status_code == 404, f"Old token should be invalid. Got {rold.status_code}: {rold.text[:200]}"
        # New token works
        rnew = anon.get(f"{BASE_URL}{new['path']}")
        assert rnew.status_code == 200

    def test_random_invalid_token_404(self, s):
        anon = requests.Session()
        r = anon.get(f"{BASE_URL}/api/calendar/feed/00000000000000000000000000000000.ics")
        assert r.status_code == 404
