"""Iteration 9 backend tests.

Coverage:
- EventIn round-trip: time_start, time_end, people fields
- StaffShift round-trip: time_start, time_end (optional, hours still stored)
- /api/expenses CRUD (owner-scoped, auth required, year/month filter)
- /api/stats returns company_expenses and profit = revenue - total_cost - company_expenses
- /api/stats yearly aggregates expenses across the year
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://event-profit-tracker.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SEED_EMAIL = "test@eventa.pl"
SEED_PW = "test123"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seed_token(api_client):
    r = api_client.post(f"{API}/auth/login", json={"email": SEED_EMAIL, "password": SEED_PW})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture()
def fresh_token(api_client):
    """Fresh isolated account, cleaned up at teardown."""
    email = f"TEST_iter9_{uuid.uuid4().hex[:10]}@eventa.pl"
    r = api_client.post(f"{API}/auth/register", json={"email": email, "password": "test123", "name": "TEST"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    yield tok
    # cleanup
    try:
        api_client.delete(f"{API}/auth/me", headers=_h(tok))
    except Exception:
        pass


# ---------- Event new fields round-trip ----------
class TestEventNewFields:
    def test_create_event_with_time_start_end_and_people(self, api_client, fresh_token):
        payload = {
            "name": "TEST_Party",
            "date": "2026-08-15",
            "time_start": "18:00",
            "time_end": "22:00",
            "people": 25,
            "category": "dzieci/urodzinki/standard",
            "revenue": 1650.0,
            "costs": [],
            "shifts": [],
        }
        r = api_client.post(f"{API}/events", headers=_h(fresh_token), json=payload)
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["time_start"] == "18:00"
        assert ev["time_end"] == "22:00"
        assert ev["people"] == 25
        assert ev["revenue"] == 1650.0

        # GET verifies persistence
        gr = api_client.get(f"{API}/events/{ev['id']}", headers=_h(fresh_token))
        assert gr.status_code == 200
        g = gr.json()
        assert g["time_start"] == "18:00"
        assert g["time_end"] == "22:00"
        assert g["people"] == 25

    def test_staff_shift_with_time_fields(self, api_client, fresh_token):
        # create staff
        sr = api_client.post(
            f"{API}/staff",
            headers=_h(fresh_token),
            json={"name": "TEST_Anna", "role": "Kelnerka", "hourly_rate": 40.0},
        )
        assert sr.status_code == 200
        sid = sr.json()["id"]

        payload = {
            "name": "TEST_Overnight",
            "date": "2026-08-20",
            "time_start": "22:00",
            "time_end": "02:00",
            "revenue": 0.0,
            "costs": [],
            "shifts": [
                {"staff_id": sid, "hours": 4.0, "time_start": "22:00", "time_end": "02:00"}
            ],
        }
        r = api_client.post(f"{API}/events", headers=_h(fresh_token), json=payload)
        assert r.status_code == 200, r.text
        ev = r.json()
        assert len(ev["shifts"]) == 1
        sh = ev["shifts"][0]
        assert sh["staff_id"] == sid
        assert sh["hours"] == 4.0
        assert sh["time_start"] == "22:00"
        assert sh["time_end"] == "02:00"
        # labor cost should be 4h * 40 = 160
        assert ev["labor_cost"] == 160.0

    def test_shift_time_fields_optional(self, api_client, fresh_token):
        """Shift without time_start/time_end should still work."""
        sr = api_client.post(
            f"{API}/staff", headers=_h(fresh_token),
            json={"name": "TEST_Bob", "role": "", "hourly_rate": 50.0},
        )
        sid = sr.json()["id"]
        r = api_client.post(
            f"{API}/events",
            headers=_h(fresh_token),
            json={
                "name": "TEST_Legacy", "date": "2026-08-21",
                "revenue": 0.0, "costs": [],
                "shifts": [{"staff_id": sid, "hours": 5.0}],
            },
        )
        assert r.status_code == 200, r.text
        ev = r.json()
        sh = ev["shifts"][0]
        # server defaults time_start/time_end to "" when omitted
        assert sh.get("time_start", "") == ""
        assert sh.get("time_end", "") == ""
        assert sh["hours"] == 5.0


# ---------- /api/expenses CRUD ----------
class TestExpensesCRUD:
    def test_requires_auth(self, api_client):
        r = api_client.get(f"{API}/expenses")
        assert r.status_code == 401

    def test_create_list_update_delete(self, api_client, fresh_token):
        # empty at start
        r = api_client.get(f"{API}/expenses?year=2026&month=8", headers=_h(fresh_token))
        assert r.status_code == 200
        assert r.json() == []

        # create
        cr = api_client.post(
            f"{API}/expenses",
            headers=_h(fresh_token),
            json={"label": "TEST_Najem", "amount": 500.0, "date": "2026-08-05", "notes": "sierpień"},
        )
        assert cr.status_code == 200, cr.text
        exp = cr.json()
        assert exp["label"] == "TEST_Najem"
        assert exp["amount"] == 500.0
        assert exp["date"] == "2026-08-05"
        assert "id" in exp
        eid = exp["id"]

        # list — should return 1
        lr = api_client.get(f"{API}/expenses?year=2026&month=8", headers=_h(fresh_token))
        assert lr.status_code == 200
        lst = lr.json()
        assert len(lst) == 1
        assert lst[0]["id"] == eid

        # month filter isolation — other month is empty
        lr2 = api_client.get(f"{API}/expenses?year=2026&month=9", headers=_h(fresh_token))
        assert lr2.json() == []

        # yearly filter contains it
        yr = api_client.get(f"{API}/expenses?year=2026", headers=_h(fresh_token))
        assert any(e["id"] == eid for e in yr.json())

        # update
        ur = api_client.put(
            f"{API}/expenses/{eid}",
            headers=_h(fresh_token),
            json={"label": "TEST_Najem", "amount": 750.0, "date": "2026-08-05", "notes": "korekta"},
        )
        assert ur.status_code == 200
        assert ur.json()["amount"] == 750.0
        assert ur.json()["notes"] == "korekta"

        # GET-after-update
        after = api_client.get(f"{API}/expenses?year=2026&month=8", headers=_h(fresh_token)).json()
        assert after[0]["amount"] == 750.0

        # delete
        dr = api_client.delete(f"{API}/expenses/{eid}", headers=_h(fresh_token))
        assert dr.status_code == 200
        assert dr.json()["ok"] is True

        # confirm gone
        final = api_client.get(f"{API}/expenses?year=2026&month=8", headers=_h(fresh_token))
        assert final.json() == []

    def test_update_nonexistent_returns_404(self, api_client, fresh_token):
        r = api_client.put(
            f"{API}/expenses/nonexistent-id",
            headers=_h(fresh_token),
            json={"label": "x", "amount": 1, "date": "2026-01-01"},
        )
        assert r.status_code == 404

    def test_owner_scoped(self, api_client, fresh_token):
        # create expense on fresh account
        cr = api_client.post(
            f"{API}/expenses", headers=_h(fresh_token),
            json={"label": "TEST_Private", "amount": 100.0, "date": "2026-08-10"},
        )
        assert cr.status_code == 200
        # register a second account and confirm it can't see it
        other_email = f"TEST_other_{uuid.uuid4().hex[:8]}@eventa.pl"
        r2 = api_client.post(f"{API}/auth/register", json={"email": other_email, "password": "test123"})
        tok2 = r2.json()["access_token"]
        try:
            lst = api_client.get(f"{API}/expenses?year=2026&month=8", headers=_h(tok2)).json()
            assert lst == []
        finally:
            api_client.delete(f"{API}/auth/me", headers=_h(tok2))


# ---------- Stats with company_expenses ----------
class TestStatsWithExpenses:
    def test_monthly_stats_includes_company_expenses_and_reduces_profit(self, api_client, fresh_token):
        # Seed: 1 event with 1000 revenue in Aug 2026
        er = api_client.post(
            f"{API}/events", headers=_h(fresh_token),
            json={"name": "TEST_Ev", "date": "2026-08-12", "revenue": 1000.0, "costs": [], "shifts": []},
        )
        assert er.status_code == 200

        # Add company expense 500 zł same month
        xr = api_client.post(
            f"{API}/expenses", headers=_h(fresh_token),
            json={"label": "TEST_Prąd", "amount": 500.0, "date": "2026-08-03"},
        )
        assert xr.status_code == 200

        # Add unrelated expense in different month — must NOT be counted
        api_client.post(
            f"{API}/expenses", headers=_h(fresh_token),
            json={"label": "TEST_Other", "amount": 999.0, "date": "2026-09-03"},
        )

        s = api_client.get(f"{API}/stats?year=2026&month=8", headers=_h(fresh_token))
        assert s.status_code == 200
        d = s.json()
        assert "company_expenses" in d
        assert d["company_expenses"] == 500.0
        assert d["revenue"] == 1000.0
        assert d["total_cost"] == 0.0
        # profit = 1000 - 0 - 500 = 500
        assert d["profit"] == 500.0

    def test_yearly_stats_aggregates_expenses(self, api_client, fresh_token):
        # Two events + 3 expenses across the year
        api_client.post(
            f"{API}/events", headers=_h(fresh_token),
            json={"name": "TEST_E1", "date": "2026-03-10", "revenue": 2000.0, "costs": [], "shifts": []},
        )
        api_client.post(
            f"{API}/events", headers=_h(fresh_token),
            json={"name": "TEST_E2", "date": "2026-11-10", "revenue": 3000.0, "costs": [], "shifts": []},
        )
        for d, a in [("2026-03-01", 200.0), ("2026-07-15", 300.0), ("2026-12-20", 100.0)]:
            api_client.post(
                f"{API}/expenses", headers=_h(fresh_token),
                json={"label": f"TEST_{d}", "amount": a, "date": d},
            )
        # + also one expense in different year should NOT be counted
        api_client.post(
            f"{API}/expenses", headers=_h(fresh_token),
            json={"label": "TEST_2025", "amount": 99999.0, "date": "2025-05-01"},
        )

        s = api_client.get(f"{API}/stats?year=2026", headers=_h(fresh_token))
        assert s.status_code == 200
        d = s.json()
        assert d["event_count"] == 2
        assert d["revenue"] == 5000.0
        assert d["company_expenses"] == 600.0
        # profit = 5000 - 0 - 600 = 4400
        assert d["profit"] == 4400.0

    def test_seed_account_yearly_stats_still_pass_without_expenses(self, api_client, seed_token):
        """Regression: seed account has no expenses → company_expenses=0 and old profit numbers preserved."""
        r = api_client.get(f"{API}/stats?year=2026", headers=_h(seed_token))
        assert r.status_code == 200
        d = r.json()
        assert "company_expenses" in d
        assert d["company_expenses"] == 0.0
        # These match the iter7 baseline
        assert d["event_count"] == 3
        assert d["revenue"] == 15000.0
        assert d["profit"] == 11750.0
