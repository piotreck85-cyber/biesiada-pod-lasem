"""Eventa backend API pytest suite. Covers auth, staff CRUD, events CRUD w/
computations, stats aggregation, and CSV export."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://event-profit-tracker.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def user_ctx(s):
    """Register a fresh user and return auth context."""
    email = f"test_{uuid.uuid4().hex[:8]}@eventa.pl"
    pw = "test123"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "Tester"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and "user" in data
    return {"email": email, "password": pw, "token": data["access_token"], "user": data["user"],
            "headers": {"Authorization": f"Bearer {data['access_token']}"}}


# ---------- Auth ----------
class TestAuth:
    def test_register_duplicate(self, s, user_ctx):
        r = s.post(f"{API}/auth/register", json={"email": user_ctx["email"], "password": "test123"})
        assert r.status_code == 409

    def test_register_short_password(self, s):
        r = s.post(f"{API}/auth/register", json={"email": f"x_{uuid.uuid4().hex[:6]}@a.pl", "password": "12"})
        assert r.status_code == 400

    def test_login_success(self, s, user_ctx):
        r = s.post(f"{API}/auth/login", json={"email": user_ctx["email"], "password": user_ctx["password"]})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password(self, s, user_ctx):
        r = s.post(f"{API}/auth/login", json={"email": user_ctx["email"], "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_requires_auth(self, s):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_returns_user(self, s, user_ctx):
        r = s.get(f"{API}/auth/me", headers=user_ctx["headers"])
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == user_ctx["email"]
        assert "password_hash" not in u
        assert "_id" not in u


# ---------- Staff ----------
class TestStaff:
    def test_staff_crud(self, s, user_ctx):
        h = user_ctx["headers"]
        # create
        r = s.post(f"{API}/staff", json={"name": "TEST_Ala", "role": "kelner", "hourly_rate": 40.0}, headers=h)
        assert r.status_code == 200, r.text
        staff = r.json()
        assert staff["name"] == "TEST_Ala" and staff["hourly_rate"] == 40.0 and "id" in staff
        sid = staff["id"]

        # list
        r = s.get(f"{API}/staff", headers=h)
        assert r.status_code == 200
        assert any(x["id"] == sid for x in r.json())

        # update
        r = s.put(f"{API}/staff/{sid}", json={"name": "TEST_Ala", "role": "manager", "hourly_rate": 55.0}, headers=h)
        assert r.status_code == 200
        assert r.json()["role"] == "manager" and r.json()["hourly_rate"] == 55.0

        # delete
        r = s.delete(f"{API}/staff/{sid}", headers=h)
        assert r.status_code == 200
        r = s.get(f"{API}/staff", headers=h)
        assert not any(x["id"] == sid for x in r.json())

    def test_staff_auth_required(self, s):
        r = s.get(f"{API}/staff")
        assert r.status_code == 401


# ---------- Events ----------
@pytest.fixture(scope="module")
def event_env(user_ctx):
    """Create 2 staff for shift computations."""
    s = requests.Session()
    h = user_ctx["headers"]
    r1 = s.post(f"{API}/staff", json={"name": "TEST_S1", "role": "r", "hourly_rate": 50.0}, headers=h)
    r2 = s.post(f"{API}/staff", json={"name": "TEST_S2", "role": "r", "hourly_rate": 30.0}, headers=h)
    ctx = {"s1": r1.json()["id"], "s2": r2.json()["id"], "h": h, "session": s, "created_events": []}
    yield ctx
    for eid in ctx["created_events"]:
        s.delete(f"{API}/events/{eid}", headers=h)
    s.delete(f"{API}/staff/{ctx['s1']}", headers=h)
    s.delete(f"{API}/staff/{ctx['s2']}", headers=h)


class TestEvents:
    def test_create_event_computes_profit(self, event_env):
        s = event_env["session"]; h = event_env["h"]
        body = {
            "name": "TEST_Wesele", "date": "2026-01-15", "time": "18:00", "venue": "Sala X",
            "revenue": 10000.0,
            "costs": [{"label": "catering", "amount": 2000.0}, {"label": "kwiaty", "amount": 500.0}],
            "shifts": [{"staff_id": event_env["s1"], "hours": 8}, {"staff_id": event_env["s2"], "hours": 5}],
        }
        r = s.post(f"{API}/events", json=body, headers=h)
        assert r.status_code == 200, r.text
        ev = r.json()
        event_env["created_events"].append(ev["id"])
        # labor = 8*50 + 5*30 = 550; material = 2500; total=3050; profit=6950
        assert ev["material_cost"] == 2500.0
        assert ev["labor_cost"] == 550.0
        assert ev["total_cost"] == 3050.0
        assert ev["profit"] == 6950.0

        # GET after create
        r = s.get(f"{API}/events/{ev['id']}", headers=h)
        assert r.status_code == 200
        assert r.json()["profit"] == 6950.0

    def test_list_events_filter_by_month(self, event_env):
        s = event_env["session"]; h = event_env["h"]
        r = s.get(f"{API}/events?year=2026&month=1", headers=h)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert all(x["date"].startswith("2026-01") for x in items)

        r2 = s.get(f"{API}/events?year=2027&month=12", headers=h)
        assert r2.status_code == 200
        assert r2.json() == []

    def test_update_event_recomputes(self, event_env):
        s = event_env["session"]; h = event_env["h"]
        eid = event_env["created_events"][0]
        body = {
            "name": "TEST_Wesele-updated", "date": "2026-01-15",
            "revenue": 20000.0, "costs": [], "shifts": [],
        }
        r = s.put(f"{API}/events/{eid}", json=body, headers=h)
        assert r.status_code == 200
        assert r.json()["profit"] == 20000.0
        assert r.json()["labor_cost"] == 0.0

    def test_delete_event(self, event_env):
        s = event_env["session"]; h = event_env["h"]
        r = s.post(f"{API}/events", json={"name": "TEST_todelete", "date": "2026-02-01", "revenue": 100},
                   headers=h)
        eid = r.json()["id"]
        r = s.delete(f"{API}/events/{eid}", headers=h)
        assert r.status_code == 200
        r = s.get(f"{API}/events/{eid}", headers=h)
        assert r.status_code == 404


# ---------- Stats ----------
class TestStats:
    def test_stats_month(self, s, user_ctx, event_env):
        r = s.get(f"{API}/stats?year=2026&month=1", headers=user_ctx["headers"])
        assert r.status_code == 200
        data = r.json()
        for k in ["event_count", "revenue", "material_cost", "labor_cost", "total_cost", "profit", "events"]:
            assert k in data
        assert data["event_count"] >= 1
        assert data["profit"] == data["revenue"] - data["total_cost"]


# ---------- CSV Export ----------
class TestExport:
    def test_csv_export(self, s, user_ctx):
        r = s.get(f"{API}/export/events", headers=user_ctx["headers"])
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        first_line = r.text.splitlines()[0]
        for col in ["Data", "Impreza", "Miejsce", "Przychód (PLN)", "Koszty materiałowe (PLN)",
                    "Koszty pracy (PLN)", "Zysk (PLN)"]:
            assert col in first_line, f"Missing column {col} in {first_line}"
