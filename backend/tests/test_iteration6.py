"""Iteration 6: N+1 optimization regression tests.

Verifies compute_event_summary + load_owner_staff_map refactor did not change results.
Targets: /api/events, /api/stats, /api/export/events, /api/staff/wages, /api/schedule.
"""
import csv
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://event-profit-tracker.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api_client, prefix="TEST_iter6"):
    email = f"{prefix}_{uuid.uuid4().hex[:10]}@eventa.pl"
    r = api_client.post(
        f"{API}/auth/register",
        json={"email": email, "password": "test123", "name": "TEST"},
    )
    assert r.status_code == 200, r.text
    return email, r.json()["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# Seeded user financial regression (Wesele May 2026 → 5h × 50 zł = 250)
# ============================================================
class TestSeededFinancials:
    def _login_seed(self, api_client):
        r = api_client.post(
            f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"}
        )
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    def test_events_endpoint_returns_labor_cost_for_seeded_wesele(self, api_client):
        token = self._login_seed(api_client)
        h = _headers(token)
        r = api_client.get(f"{API}/events", headers=h)
        assert r.status_code == 200
        events = r.json()
        # Find May 2026 Wesele-style event
        wesele = [e for e in events if str(e.get("date", "")).startswith("2026-05")]
        assert wesele, f"No May 2026 seeded events found. Dates present: {[e.get('date') for e in events][:10]}"

        # Every returned event must have the computed keys
        for e in events:
            for k in ("labor_cost", "material_cost", "total_cost", "profit"):
                assert k in e, f"event {e.get('id')} missing {k}"
            # profit = revenue - (material + labor)
            recomputed = round(
                float(e["revenue"]) - float(e["material_cost"]) - float(e["labor_cost"]), 2
            )
            assert recomputed == e["profit"], f"Profit mismatch in event {e['name']}: {e}"

        # At least one seeded event should have labor_cost > 0 (Jan Kowalski 5h × 50)
        with_labor = [e for e in wesele if e["labor_cost"] > 0]
        assert with_labor, f"Expected at least one May 2026 event with labor_cost > 0, got {wesele}"

    def test_stats_matches_events_aggregate(self, api_client):
        """/api/stats totals must equal the sum of /api/events per-item values."""
        token = self._login_seed(api_client)
        h = _headers(token)

        events = api_client.get(f"{API}/events", headers=h).json()
        stats = api_client.get(f"{API}/stats", headers=h).json()

        sum_revenue = round(sum(float(e["revenue"]) for e in events), 2)
        sum_material = round(sum(float(e["material_cost"]) for e in events), 2)
        sum_labor = round(sum(float(e["labor_cost"]) for e in events), 2)
        sum_total = round(sum_material + sum_labor, 2)
        sum_profit = round(sum_revenue - sum_total, 2)

        assert stats["event_count"] == len(events)
        assert stats["revenue"] == sum_revenue
        assert stats["material_cost"] == sum_material
        assert stats["labor_cost"] == sum_labor
        assert stats["total_cost"] == sum_total
        assert stats["profit"] == sum_profit

    def test_export_events_csv_matches_events(self, api_client):
        token = self._login_seed(api_client)
        h = _headers(token)
        events = api_client.get(f"{API}/events", headers=h).json()
        by_id = {e["date"] + "|" + e["name"]: e for e in events}

        csv_r = api_client.get(f"{API}/export/events", headers=h)
        assert csv_r.status_code == 200
        assert "text/csv" in csv_r.headers.get("content-type", "")

        reader = csv.reader(io.StringIO(csv_r.text))
        rows = list(reader)
        assert rows[0][0] == "Data"
        # Compare each CSV data row
        for row in rows[1:]:
            date, name, venue, revenue, material, labor, profit = row
            key = f"{date}|{name}"
            assert key in by_id, f"CSV row not found in events: {key}"
            e = by_id[key]
            assert float(revenue) == float(e["revenue"])
            assert float(material) == float(e["material_cost"])
            assert float(labor) == float(e["labor_cost"])
            assert float(profit) == float(e["profit"])

    def test_staff_wages_matches_events_labor(self, api_client):
        """Sum of /api/staff/wages amounts should equal sum of labor_cost in /api/events."""
        token = self._login_seed(api_client)
        h = _headers(token)
        events = api_client.get(f"{API}/events", headers=h).json()
        wages = api_client.get(f"{API}/staff/wages", headers=h).json()

        events_labor = round(sum(float(e["labor_cost"]) for e in events), 2)
        assert wages["total_amount"] == events_labor, (
            f"wages.total_amount={wages['total_amount']} != sum(events.labor_cost)={events_labor}"
        )

    def test_schedule_endpoint_ok(self, api_client):
        token = self._login_seed(api_client)
        h = _headers(token)
        r = api_client.get(f"{API}/schedule", headers=h)
        assert r.status_code == 200
        # Must be a list of {date, events:[...]}
        assert isinstance(r.json(), list)
        for day in r.json():
            assert "date" in day and "events" in day


# ============================================================
# Fresh account: full control over shifts & staff
# ============================================================
class TestMultiShiftLaborCost:
    def test_event_with_three_shifts_different_staff(self, api_client):
        """labor_cost must equal sum(hours × rate) across all 3 shifts."""
        _, token = _register(api_client)
        h = _headers(token)

        # Create 3 staff with distinct rates
        s1 = api_client.post(f"{API}/staff", json={"name": "TEST_S1", "hourly_rate": 40}, headers=h).json()
        s2 = api_client.post(f"{API}/staff", json={"name": "TEST_S2", "hourly_rate": 55.5}, headers=h).json()
        s3 = api_client.post(f"{API}/staff", json={"name": "TEST_S3", "hourly_rate": 100}, headers=h).json()

        payload = {
            "name": "TEST_multi_shift",
            "date": "2026-08-15",
            "revenue": 5000,
            "costs": [{"label": "Jedzenie", "amount": 800.5}, {"label": "Napoje", "amount": 199.5}],
            "shifts": [
                {"staff_id": s1["id"], "hours": 4},        # 4 * 40    = 160
                {"staff_id": s2["id"], "hours": 6},        # 6 * 55.5  = 333
                {"staff_id": s3["id"], "hours": 2.5},      # 2.5 * 100 = 250
            ],
        }
        expected_labor = 160 + 333 + 250  # 743
        expected_material = 800.5 + 199.5  # 1000
        expected_profit = 5000 - (expected_labor + expected_material)  # 3257

        cr = api_client.post(f"{API}/events", json=payload, headers=h)
        assert cr.status_code == 200, cr.text
        ev = cr.json()
        assert ev["labor_cost"] == round(expected_labor, 2)
        assert ev["material_cost"] == round(expected_material, 2)
        assert ev["total_cost"] == round(expected_labor + expected_material, 2)
        assert ev["profit"] == round(expected_profit, 2)

        # Same values via GET /events (list) — this is the code path that uses staff_map preload
        listed = api_client.get(f"{API}/events", headers=h).json()
        me_ev = next(e for e in listed if e["id"] == ev["id"])
        assert me_ev["labor_cost"] == round(expected_labor, 2)
        assert me_ev["material_cost"] == round(expected_material, 2)
        assert me_ev["profit"] == round(expected_profit, 2)

        # Same via GET /events/{id} (uses compute_event_summary without staff_map)
        single = api_client.get(f"{API}/events/{ev['id']}", headers=h).json()
        assert single["labor_cost"] == round(expected_labor, 2)
        assert single["profit"] == round(expected_profit, 2)

        # /stats agrees
        stats = api_client.get(f"{API}/stats", headers=h).json()
        assert stats["labor_cost"] == round(expected_labor, 2)
        assert stats["material_cost"] == round(expected_material, 2)
        assert stats["profit"] == round(expected_profit, 2)

        # /staff/wages agrees
        wages = api_client.get(f"{API}/staff/wages", headers=h).json()
        assert wages["total_amount"] == round(expected_labor, 2)
        assert wages["total_hours"] == round(4 + 6 + 2.5, 2)

        # Cleanup
        api_client.delete(f"{API}/auth/me", headers=h)

    def test_event_with_nonexistent_staff_id_labor_zero(self, api_client):
        """A shift referencing a non-existent staff_id must contribute 0 and not crash."""
        _, token = _register(api_client)
        h = _headers(token)

        real = api_client.post(f"{API}/staff", json={"name": "TEST_real", "hourly_rate": 30}, headers=h).json()
        fake_id = str(uuid.uuid4())  # Does not exist

        payload = {
            "name": "TEST_ghost_shift",
            "date": "2026-09-10",
            "revenue": 1000,
            "costs": [],
            "shifts": [
                {"staff_id": real["id"], "hours": 3},  # 3 * 30 = 90
                {"staff_id": fake_id, "hours": 10},    # contributes 0
            ],
        }
        cr = api_client.post(f"{API}/events", json=payload, headers=h)
        assert cr.status_code == 200, cr.text
        ev = cr.json()
        assert ev["labor_cost"] == 90.0, f"ghost shift leaked labor_cost: {ev}"
        assert ev["profit"] == 910.0

        # Via /events list (staff_map preloaded)
        listed = api_client.get(f"{API}/events", headers=h).json()
        me_ev = next(e for e in listed if e["id"] == ev["id"])
        assert me_ev["labor_cost"] == 90.0

        # Via /stats
        stats = api_client.get(f"{API}/stats", headers=h).json()
        assert stats["labor_cost"] == 90.0

        # Via /export/events — must succeed (no crash)
        csv_r = api_client.get(f"{API}/export/events", headers=h)
        assert csv_r.status_code == 200
        assert "TEST_ghost_shift" in csv_r.text

        # Via /staff/wages — only real staff appears
        wages = api_client.get(f"{API}/staff/wages", headers=h).json()
        assert wages["total_amount"] == 90.0
        assert wages["total_hours"] == 3.0
        assert len(wages["staff"]) == 1
        assert wages["staff"][0]["staff_id"] == real["id"]

        api_client.delete(f"{API}/auth/me", headers=h)

    def test_event_with_no_shifts_labor_zero(self, api_client):
        _, token = _register(api_client)
        h = _headers(token)

        payload = {
            "name": "TEST_no_shifts",
            "date": "2026-10-01",
            "revenue": 500,
            "costs": [{"label": "x", "amount": 100}],
            "shifts": [],
        }
        cr = api_client.post(f"{API}/events", json=payload, headers=h)
        assert cr.status_code == 200
        ev = cr.json()
        assert ev["labor_cost"] == 0
        assert ev["material_cost"] == 100
        assert ev["profit"] == 400

        api_client.delete(f"{API}/auth/me", headers=h)


# ============================================================
# Auth regression
# ============================================================
class TestAuthRegression:
    def test_register_login_delete(self, api_client):
        # Backend lowercases emails on register/login — keep test consistent
        email = f"test_iter6_auth_{uuid.uuid4().hex[:10]}@eventa.pl"
        # Register
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": email, "password": "test123", "name": "TEST"},
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]

        # /auth/me OK
        me = api_client.get(f"{API}/auth/me", headers=_headers(token))
        assert me.status_code == 200
        assert me.json()["email"] == email

        # Login
        li = api_client.post(f"{API}/auth/login", json={"email": email, "password": "test123"})
        assert li.status_code == 200

        # Wrong password
        bad = api_client.post(f"{API}/auth/login", json={"email": email, "password": "WRONG"})
        assert bad.status_code == 401

        # Delete account
        d = api_client.delete(f"{API}/auth/me", headers=_headers(token))
        assert d.status_code == 200
        assert d.json() == {"ok": True}

        # Token no longer valid
        me2 = api_client.get(f"{API}/auth/me", headers=_headers(token))
        assert me2.status_code == 401


# ============================================================
# METRO_CACHE_ROOT quoting sanity check (config file)
# ============================================================
class TestFrontendEnv:
    def test_metro_cache_root_is_quoted(self):
        env_path = "/app/frontend/.env"
        assert os.path.exists(env_path)
        with open(env_path) as f:
            content = f.read()
        found = False
        for line in content.splitlines():
            if line.startswith("METRO_CACHE_ROOT="):
                found = True
                val = line.split("=", 1)[1]
                assert val.startswith('"') and val.endswith('"'), (
                    f"METRO_CACHE_ROOT should be double-quoted, got: {val!r}"
                )
        assert found, "METRO_CACHE_ROOT not present in frontend/.env"
