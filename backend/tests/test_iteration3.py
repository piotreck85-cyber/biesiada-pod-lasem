"""Iteration 3 tests: staff wages summary, schedule (grafik), category
roundtrip on events and templates."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://event-profit-tracker.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    email = f"i3test_{uuid.uuid4().hex[:8]}@eventa.pl"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test123", "name": "Iter3"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    # Two staff
    s1 = s.post(f"{API}/staff", json={"name": "TEST_Jan", "role": "animator", "hourly_rate": 50.0}, headers=h).json()
    s2 = s.post(f"{API}/staff", json={"name": "TEST_Ola", "role": "kelner",   "hourly_rate": 30.0}, headers=h).json()
    # Two events same month, one different
    e1 = s.post(f"{API}/events", json={
        "name": "TEST_Wesele", "date": "2026-05-15", "time": "16:00", "venue": "Sala X",
        "category": "dorosli/okolicznosciowe", "revenue": 8000.0,
        "shifts": [{"staff_id": s1["id"], "hours": 5}, {"staff_id": s2["id"], "hours": 4}],
    }, headers=h).json()
    e2 = s.post(f"{API}/events", json={
        "name": "TEST_Urodzinki", "date": "2026-05-20", "time": "12:00",
        "category": "dzieci/urodzinki/tematyczne", "revenue": 900.0,
        "shifts": [{"staff_id": s1["id"], "hours": 3}],
    }, headers=h).json()
    e3 = s.post(f"{API}/events", json={
        "name": "TEST_Firmowa", "date": "2026-06-01",
        "category": "dorosli/firmowe", "revenue": 5000.0,
        "shifts": [{"staff_id": s2["id"], "hours": 2}],
    }, headers=h).json()
    return {"s": s, "h": h, "s1": s1, "s2": s2, "e1": e1, "e2": e2, "e3": e3}


# ---------- Staff wages ----------
class TestStaffWages:
    def test_wages_requires_auth(self, ctx):
        r = ctx["s"].get(f"{API}/staff/wages")
        assert r.status_code == 401

    def test_wages_month_shape_and_math(self, ctx):
        r = ctx["s"].get(f"{API}/staff/wages?year=2026&month=5", headers=ctx["h"])
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["total_hours", "total_amount", "staff"]:
            assert k in data
        # Only May events count: Jan = 5+3=8h * 50 = 400, Ola = 4h * 30 = 120
        assert data["total_hours"] == 12.0
        assert data["total_amount"] == 520.0
        rows = {r["staff_id"]: r for r in data["staff"]}
        jan = rows[ctx["s1"]["id"]]
        assert jan["hours"] == 8.0
        assert jan["amount"] == 400.0
        assert jan["hourly_rate"] == 50.0
        assert jan["shifts"] == 2
        assert jan["name"] == "TEST_Jan"
        assert jan["role"] == "animator"
        ola = rows[ctx["s2"]["id"]]
        assert ola["hours"] == 4.0
        assert ola["amount"] == 120.0
        assert ola["shifts"] == 1
        # sorted by amount desc: Jan first
        assert data["staff"][0]["staff_id"] == ctx["s1"]["id"]

    def test_wages_all_time(self, ctx):
        r = ctx["s"].get(f"{API}/staff/wages", headers=ctx["h"])
        assert r.status_code == 200
        data = r.json()
        # Jan: 8h*50=400 ; Ola: 4*30 + 2*30 = 180 => total 580, hours 14
        assert data["total_hours"] == 14.0
        assert data["total_amount"] == 580.0

    def test_wages_empty_month(self, ctx):
        r = ctx["s"].get(f"{API}/staff/wages?year=2030&month=1", headers=ctx["h"])
        assert r.status_code == 200
        data = r.json()
        assert data["total_hours"] == 0
        assert data["total_amount"] == 0
        assert data["staff"] == []


# ---------- Schedule (grafik) ----------
class TestSchedule:
    def test_schedule_requires_auth(self, ctx):
        r = ctx["s"].get(f"{API}/schedule")
        assert r.status_code == 401

    def test_schedule_month_grouping(self, ctx):
        r = ctx["s"].get(f"{API}/schedule?year=2026&month=5", headers=ctx["h"])
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        dates = [d["date"] for d in data]
        assert dates == sorted(dates)
        assert "2026-05-15" in dates and "2026-05-20" in dates
        assert "2026-06-01" not in dates

        day = next(d for d in data if d["date"] == "2026-05-15")
        assert len(day["events"]) == 1
        ev = day["events"][0]
        assert ev["name"] == "TEST_Wesele"
        assert ev["category"] == "dorosli/okolicznosciowe"
        assert ev["time"] == "16:00"
        assert ev["venue"] == "Sala X"
        staff = {s["staff_id"]: s for s in ev["staff"]}
        jan = staff[ctx["s1"]["id"]]
        assert jan["name"] == "TEST_Jan"
        assert jan["role"] == "animator"
        assert jan["hours"] == 5.0
        assert jan["amount"] == 250.0  # 5 * 50
        ola = staff[ctx["s2"]["id"]]
        assert ola["hours"] == 4.0
        assert ola["amount"] == 120.0  # 4 * 30


# ---------- Category roundtrip ----------
class TestCategory:
    def test_event_category_roundtrip(self, ctx):
        cat = "dzieci/urodzinki/konie"
        r = ctx["s"].post(f"{API}/events", json={
            "name": "TEST_KoniePony", "date": "2026-07-10", "category": cat, "revenue": 700.0,
        }, headers=ctx["h"])
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["category"] == cat
        r2 = ctx["s"].get(f"{API}/events/{ev['id']}", headers=ctx["h"])
        assert r2.status_code == 200
        assert r2.json()["category"] == cat

        # update to different category
        r3 = ctx["s"].put(f"{API}/events/{ev['id']}", json={
            "name": "TEST_KoniePony", "date": "2026-07-10",
            "category": "dzieci/wycieczki", "revenue": 700.0,
        }, headers=ctx["h"])
        assert r3.status_code == 200
        assert r3.json()["category"] == "dzieci/wycieczki"

    def test_event_no_category(self, ctx):
        r = ctx["s"].post(f"{API}/events", json={
            "name": "TEST_Bezkat", "date": "2026-07-11", "revenue": 100.0,
        }, headers=ctx["h"])
        assert r.status_code == 200
        # category is optional -> either "" or missing is acceptable
        assert r.json().get("category", "") == ""

    def test_template_category_roundtrip(self, ctx):
        cat = "dorosli/firmowe"
        r = ctx["s"].post(f"{API}/templates", json={
            "name": "TEST_TplFirmowa", "category": cat, "revenue": 5000.0,
        }, headers=ctx["h"])
        assert r.status_code == 200, r.text
        assert r.json()["category"] == cat
        tid = r.json()["id"]
        r2 = ctx["s"].get(f"{API}/templates", headers=ctx["h"])
        tpl = next(t for t in r2.json() if t["id"] == tid)
        assert tpl["category"] == cat
