"""Iteration 7: yearly stats aggregation (GET /api/stats?year=YYYY without month).

Also regression-checks:
 - /api/stats?year=YYYY&month=M still returns month-scoped totals
 - /api/stats?year=YYYY with no events returns zeros
 - /api/staff/wages and /api/export/events still work (monthly)
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

SEED_EMAIL = "test@eventa.pl"
SEED_PW = "test123"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def seed_token(api_client):
    r = api_client.post(
        f"{API}/auth/login", json={"email": SEED_EMAIL, "password": SEED_PW}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# -------- Yearly stats (main feature) --------
class TestYearlyStats:
    def test_year_only_returns_full_year_aggregate(self, api_client, seed_token):
        r = api_client.get(f"{API}/stats?year=2026", headers=_h(seed_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["event_count"] == 3
        assert data["revenue"] == 15000.0
        assert data["total_cost"] == 3250.0
        assert data["profit"] == 11750.0
        # material + labor should sum to total_cost
        assert round(data["material_cost"] + data["labor_cost"], 2) == data["total_cost"]
        assert isinstance(data["events"], list)
        assert len(data["events"]) == 3
        # each per_event entry has expected keys
        for ev in data["events"]:
            assert set(["id", "name", "date", "revenue", "total_cost", "profit"]).issubset(ev.keys())
            assert ev["date"].startswith("2026-")

    def test_year_events_match_sum(self, api_client, seed_token):
        """Sanity: sum of per-event revenue/profit == totals."""
        r = api_client.get(f"{API}/stats?year=2026", headers=_h(seed_token))
        data = r.json()
        assert round(sum(e["revenue"] for e in data["events"]), 2) == data["revenue"]
        assert round(sum(e["profit"] for e in data["events"]), 2) == data["profit"]
        assert round(sum(e["total_cost"] for e in data["events"]), 2) == data["total_cost"]

    def test_year_with_no_events_returns_zeros(self, api_client, seed_token):
        r = api_client.get(f"{API}/stats?year=9999", headers=_h(seed_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["event_count"] == 0
        assert data["revenue"] == 0
        assert data["total_cost"] == 0
        assert data["profit"] == 0
        assert data["material_cost"] == 0
        assert data["labor_cost"] == 0
        assert data["events"] == []


# -------- Regression: monthly stats still work --------
class TestMonthlyStatsRegression:
    def test_may_2026_only(self, api_client, seed_token):
        r = api_client.get(f"{API}/stats?year=2026&month=5", headers=_h(seed_token))
        assert r.status_code == 200
        data = r.json()
        assert data["event_count"] == 1
        assert data["revenue"] == 10000.0
        assert data["material_cost"] == 3000.0
        assert data["labor_cost"] == 250.0
        assert data["total_cost"] == 3250.0
        assert data["profit"] == 6750.0
        assert len(data["events"]) == 1
        assert data["events"][0]["date"] == "2026-05-15"

    def test_june_2026_only(self, api_client, seed_token):
        r = api_client.get(f"{API}/stats?year=2026&month=6", headers=_h(seed_token))
        assert r.status_code == 200
        data = r.json()
        assert data["event_count"] == 2
        assert data["revenue"] == 5000.0
        assert data["total_cost"] == 0.0
        assert data["profit"] == 5000.0

    def test_may_plus_june_equals_year(self, api_client, seed_token):
        may = api_client.get(f"{API}/stats?year=2026&month=5", headers=_h(seed_token)).json()
        jun = api_client.get(f"{API}/stats?year=2026&month=6", headers=_h(seed_token)).json()
        yr = api_client.get(f"{API}/stats?year=2026", headers=_h(seed_token)).json()
        assert may["event_count"] + jun["event_count"] == yr["event_count"]
        assert round(may["revenue"] + jun["revenue"], 2) == yr["revenue"]
        assert round(may["profit"] + jun["profit"], 2) == yr["profit"]
        assert round(may["total_cost"] + jun["total_cost"], 2) == yr["total_cost"]


# -------- Regression: wages + CSV export still work --------
class TestSideEndpointsRegression:
    def test_wages_may_2026(self, api_client, seed_token):
        r = api_client.get(f"{API}/staff/wages?year=2026&month=5", headers=_h(seed_token))
        assert r.status_code == 200
        d = r.json()
        assert d["total_amount"] == 250.0
        assert d["total_hours"] == 5.0
        assert isinstance(d["staff"], list) and len(d["staff"]) >= 1

    def test_csv_export_may_2026(self, api_client, seed_token):
        r = api_client.get(
            f"{API}/export/events?year=2026&month=5", headers=_h(seed_token)
        )
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        rows = list(csv.reader(io.StringIO(r.text)))
        assert len(rows) >= 2  # header + at least 1 event
        assert rows[0][0] == "Data"

    def test_ics_export_ok(self, api_client, seed_token):
        r = api_client.get(f"{API}/export/calendar.ics", headers=_h(seed_token))
        assert r.status_code == 200
        assert "BEGIN:VCALENDAR" in r.text
        assert "END:VCALENDAR" in r.text


# -------- Isolation: fresh account, seeded events, yearly aggregation --------
class TestYearAggregationOnFreshAccount:
    def test_multi_year_isolation(self, api_client):
        email = f"TEST_iter7_{uuid.uuid4().hex[:10]}@eventa.pl"
        r = api_client.post(
            f"{API}/auth/register",
            json={"email": email, "password": "test123", "name": "TEST"},
        )
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        try:
            # create 2 events in 2024, 1 in 2025
            for date, rev in [("2024-03-10", 1000.0), ("2024-07-20", 2500.0), ("2025-11-05", 500.0)]:
                rr = api_client.post(
                    f"{API}/events",
                    headers=_h(tok),
                    json={"name": f"E-{date}", "date": date, "revenue": rev, "costs": [], "shifts": []},
                )
                assert rr.status_code == 200, rr.text

            y2024 = api_client.get(f"{API}/stats?year=2024", headers=_h(tok)).json()
            y2025 = api_client.get(f"{API}/stats?year=2025", headers=_h(tok)).json()
            y2026 = api_client.get(f"{API}/stats?year=2026", headers=_h(tok)).json()

            assert y2024["event_count"] == 2
            assert y2024["revenue"] == 3500.0
            assert y2024["profit"] == 3500.0
            assert y2025["event_count"] == 1
            assert y2025["revenue"] == 500.0
            assert y2026["event_count"] == 0
            assert y2026["revenue"] == 0
        finally:
            # cleanup
            api_client.delete(f"{API}/auth/me", headers=_h(tok))
