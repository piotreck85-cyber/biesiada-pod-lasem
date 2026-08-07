"""Iteration 4 tests: ICS/iCal import (POST /api/import/ics) — parsing, UID
dedupe, years_back cutoff — and PRODID rename in /api/export/calendar.ics.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    email = f"i4test_{uuid.uuid4().hex[:8]}@eventa.pl"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test123", "name": "Iter4"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    return {"s": s, "h": h, "email": email}


def build_ics(events):
    """events: list of dict with uid, dtstart (YYYYMMDD or YYYYMMDDTHHMMSS), summary,
    optional location, description."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN"]
    for e in events:
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{e['uid']}")
        dt = e["dtstart"]
        if "T" in dt:
            lines.append(f"DTSTART:{dt}")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{dt}")
        lines.append(f"SUMMARY:{e.get('summary','Impreza')}")
        if e.get("location"):
            lines.append(f"LOCATION:{e['location']}")
        if e.get("description"):
            lines.append(f"DESCRIPTION:{e['description']}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


class TestIcsImport:
    def test_requires_auth(self, ctx):
        r = ctx["s"].post(f"{API}/import/ics", json={"ics": "BEGIN:VCALENDAR\r\nEND:VCALENDAR", "years_back": 5})
        assert r.status_code == 401

    def test_import_basic_two_events_one_old(self, ctx):
        # One event this year, one event 10 years ago (should be skipped by years_back=5)
        this_year = datetime.now(timezone.utc).year
        ics = build_ics([
            {"uid": f"uid-new-{uuid.uuid4().hex[:6]}@test", "dtstart": f"{this_year+1}0810T140000",
             "summary": "TEST_IcsFuture", "location": "Sala A", "description": "Notatka linia1\\nlinia2"},
            {"uid": f"uid-old-{uuid.uuid4().hex[:6]}@test", "dtstart": f"{this_year-10}0501",
             "summary": "TEST_IcsOld"},
        ])
        r = ctx["s"].post(f"{API}/import/ics", json={"ics": ics, "years_back": 5}, headers=ctx["h"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["total_parsed"] == 2
        assert data["imported"] == 1
        assert data["skipped_older_than_cutoff"] == 1

        # Verify the future event was persisted with correct fields
        evs = ctx["s"].get(f"{API}/events", headers=ctx["h"]).json()
        match = [e for e in evs if e["name"] == "TEST_IcsFuture"]
        assert len(match) == 1
        ev = match[0]
        assert ev["date"] == f"{this_year+1}-08-10"
        assert ev["time"] == "14:00"
        assert ev["venue"] == "Sala A"
        assert "linia1" in ev["notes"] and "linia2" in ev["notes"]

    def test_uid_dedupe(self, ctx):
        uid = f"uid-dup-{uuid.uuid4().hex[:8]}@test"
        this_year = datetime.now(timezone.utc).year
        ics = build_ics([
            {"uid": uid, "dtstart": f"{this_year+2}0601T100000", "summary": "TEST_IcsDup"},
        ])
        r1 = ctx["s"].post(f"{API}/import/ics", json={"ics": ics, "years_back": 5}, headers=ctx["h"])
        assert r1.json()["imported"] == 1
        # Re-import same ICS → should skip (dedupe by UID)
        r2 = ctx["s"].post(f"{API}/import/ics", json={"ics": ics, "years_back": 5}, headers=ctx["h"])
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["total_parsed"] == 1
        assert d2["imported"] == 0

        # Only one event named TEST_IcsDup should exist
        evs = ctx["s"].get(f"{API}/events", headers=ctx["h"]).json()
        dups = [e for e in evs if e["name"] == "TEST_IcsDup"]
        assert len(dups) == 1

    def test_invalid_content_does_not_crash(self, ctx):
        r = ctx["s"].post(f"{API}/import/ics",
                          json={"ics": "This is not an ICS file at all\r\nrandom garbage",
                                "years_back": 5}, headers=ctx["h"])
        assert r.status_code == 200
        d = r.json()
        assert d["imported"] == 0
        assert d["total_parsed"] == 0

    def test_empty_body_does_not_crash(self, ctx):
        r = ctx["s"].post(f"{API}/import/ics", json={"ics": "", "years_back": 5}, headers=ctx["h"])
        assert r.status_code == 200
        assert r.json()["imported"] == 0

    def test_years_back_respected(self, ctx):
        # years_back=1 → an event 2 years ago should be skipped
        two_years_ago = (datetime.now(timezone.utc) - timedelta(days=365 * 2)).strftime("%Y%m%d")
        ics = build_ics([
            {"uid": f"uid-2y-{uuid.uuid4().hex[:6]}@test", "dtstart": two_years_ago,
             "summary": "TEST_Ics2YearsAgo"},
        ])
        r = ctx["s"].post(f"{API}/import/ics", json={"ics": ics, "years_back": 1}, headers=ctx["h"])
        assert r.status_code == 200
        d = r.json()
        assert d["total_parsed"] == 1
        assert d["imported"] == 0
        assert d["skipped_older_than_cutoff"] == 1


class TestIcsExportProdId:
    def test_export_ics_prodid_renamed(self, ctx):
        r = ctx["s"].get(f"{API}/export/calendar.ics", headers=ctx["h"])
        assert r.status_code == 200
        assert "text/calendar" in r.headers.get("content-type", "")
        body = r.text
        assert "BEGIN:VCALENDAR" in body
        assert "Biesiada pod lasem" in body
        # Verify it's on the PRODID line
        prodid_line = [ln for ln in body.splitlines() if ln.startswith("PRODID")]
        assert len(prodid_line) == 1
        assert "Biesiada pod lasem" in prodid_line[0]


class TestRegressionCore:
    """Quick regression smoke on iter1/2/3 endpoints."""
    def test_login_seed_user(self, ctx):
        # The seed user
        r = ctx["s"].post(f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_stats_and_wages_and_schedule(self, ctx):
        r_stats = ctx["s"].get(f"{API}/stats", headers=ctx["h"])
        assert r_stats.status_code == 200
        assert "event_count" in r_stats.json()
        r_wages = ctx["s"].get(f"{API}/staff/wages", headers=ctx["h"])
        assert r_wages.status_code == 200
        r_sched = ctx["s"].get(f"{API}/schedule", headers=ctx["h"])
        assert r_sched.status_code == 200

    def test_events_crud_smoke(self, ctx):
        # create
        r = ctx["s"].post(f"{API}/events", json={
            "name": "TEST_i4Smoke", "date": "2026-09-01", "revenue": 100.0,
        }, headers=ctx["h"])
        assert r.status_code == 200
        eid = r.json()["id"]
        # get
        r2 = ctx["s"].get(f"{API}/events/{eid}", headers=ctx["h"])
        assert r2.status_code == 200
        # update
        r3 = ctx["s"].put(f"{API}/events/{eid}", json={
            "name": "TEST_i4Smoke2", "date": "2026-09-01", "revenue": 200.0,
        }, headers=ctx["h"])
        assert r3.status_code == 200 and r3.json()["name"] == "TEST_i4Smoke2"
        # delete
        r4 = ctx["s"].delete(f"{API}/events/{eid}", headers=ctx["h"])
        assert r4.status_code == 200
        # verify 404
        r5 = ctx["s"].get(f"{API}/events/{eid}", headers=ctx["h"])
        assert r5.status_code == 404
