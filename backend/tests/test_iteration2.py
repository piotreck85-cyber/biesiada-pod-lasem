"""Iteration 2 tests: templates CRUD, backup export/import (merge/replace),
iCal export, and event image_url roundtrip."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://event-profit-tracker.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()
    email = f"itest_{uuid.uuid4().hex[:8]}@eventa.pl"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test123", "name": "Iter2"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    return {"s": s, "h": h, "email": email}


# ---------- Templates CRUD ----------
class TestTemplates:
    def test_templates_requires_auth(self, ctx):
        r = ctx["s"].get(f"{API}/templates")
        assert r.status_code == 401

    def test_templates_empty(self, ctx):
        r = ctx["s"].get(f"{API}/templates", headers=ctx["h"])
        assert r.status_code == 200
        assert r.json() == []

    def test_create_and_list_template(self, ctx):
        body = {
            "name": "TEST_Wesele-tpl", "venue": "Sala Y", "notes": "n",
            "revenue": 8000.0,
            "costs": [{"label": "catering", "amount": 1500.0}],
            "shifts": [],
            "image_url": TINY_PNG,
        }
        r = ctx["s"].post(f"{API}/templates", json=body, headers=ctx["h"])
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["name"] == "TEST_Wesele-tpl"
        assert tpl["venue"] == "Sala Y"
        assert tpl["revenue"] == 8000.0
        assert tpl["image_url"] == TINY_PNG
        assert "id" in tpl
        assert "_id" not in tpl
        ctx["tpl_id"] = tpl["id"]

        # GET verifies persistence
        r = ctx["s"].get(f"{API}/templates", headers=ctx["h"])
        assert r.status_code == 200
        found = [t for t in r.json() if t["id"] == tpl["id"]]
        assert len(found) == 1
        assert found[0]["image_url"] == TINY_PNG

    def test_delete_template(self, ctx):
        tid = ctx["tpl_id"]
        r = ctx["s"].delete(f"{API}/templates/{tid}", headers=ctx["h"])
        assert r.status_code == 200
        r = ctx["s"].get(f"{API}/templates", headers=ctx["h"])
        assert not any(t["id"] == tid for t in r.json())


# ---------- Events image_url ----------
class TestEventImage:
    def test_event_accepts_image_url(self, ctx):
        body = {"name": "TEST_pic", "date": "2026-03-01", "revenue": 100, "image_url": TINY_PNG}
        r = ctx["s"].post(f"{API}/events", json=body, headers=ctx["h"])
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["image_url"] == TINY_PNG
        # verify by GET
        r = ctx["s"].get(f"{API}/events/{ev['id']}", headers=ctx["h"])
        assert r.status_code == 200
        assert r.json()["image_url"] == TINY_PNG
        ctx["ev_id"] = ev["id"]


# ---------- Backup Export/Import ----------
class TestBackup:
    def test_export_backup_shape(self, ctx):
        # create one staff/event/template first
        r = ctx["s"].post(f"{API}/staff", json={"name": "TEST_bkstaff", "hourly_rate": 20.0}, headers=ctx["h"])
        assert r.status_code == 200
        ctx["st_id"] = r.json()["id"]
        r = ctx["s"].post(f"{API}/templates", json={"name": "TEST_bktpl", "revenue": 500}, headers=ctx["h"])
        assert r.status_code == 200
        ctx["bktpl_id"] = r.json()["id"]

        r = ctx["s"].get(f"{API}/export/backup", headers=ctx["h"])
        assert r.status_code == 200
        data = r.json()
        for k in ["app", "version", "exported_at", "staff", "events", "templates"]:
            assert k in data, f"missing {k}"
        assert data["app"] == "eventa"
        assert data["version"] == 1
        assert isinstance(data["staff"], list) and isinstance(data["events"], list) and isinstance(data["templates"], list)
        assert any(s["id"] == ctx["st_id"] for s in data["staff"])
        assert any(t["id"] == ctx["bktpl_id"] for t in data["templates"])
        # owner_id should be stripped
        for arr in [data["staff"], data["events"], data["templates"]]:
            for item in arr:
                assert "owner_id" not in item
                assert "_id" not in item
        ctx["backup"] = data

    def test_import_merge_upserts(self, ctx):
        backup = ctx["backup"]
        # modify the staff name in backup and re-import merge — should upsert same id
        modified = dict(backup)
        modified["mode"] = "merge"
        # count before
        before = ctx["s"].get(f"{API}/staff", headers=ctx["h"]).json()
        before_ids = {x["id"] for x in before}

        r = ctx["s"].post(f"{API}/import/backup", json=modified, headers=ctx["h"])
        assert r.status_code == 200, r.text
        out = r.json()
        assert out.get("ok") is True
        assert out["imported"]["staff"] == len(backup["staff"])
        assert out["imported"]["events"] == len(backup["events"])
        assert out["imported"]["templates"] == len(backup["templates"])

        after = ctx["s"].get(f"{API}/staff", headers=ctx["h"]).json()
        after_ids = {x["id"] for x in after}
        # merge should not add duplicates for same ids
        assert before_ids == after_ids

    def test_import_replace_wipes_and_reinserts(self, ctx):
        # Add extra staff, then replace with backup → extra should be gone
        r = ctx["s"].post(f"{API}/staff", json={"name": "TEST_extra", "hourly_rate": 10}, headers=ctx["h"])
        extra_id = r.json()["id"]

        payload = dict(ctx["backup"])
        payload["mode"] = "replace"
        r = ctx["s"].post(f"{API}/import/backup", json=payload, headers=ctx["h"])
        assert r.status_code == 200

        after = ctx["s"].get(f"{API}/staff", headers=ctx["h"]).json()
        after_ids = {x["id"] for x in after}
        assert extra_id not in after_ids
        assert ctx["st_id"] in after_ids  # original restored


# ---------- iCal Export ----------
class TestICal:
    def test_ics_valid(self, ctx):
        r = ctx["s"].get(f"{API}/export/calendar.ics", headers=ctx["h"])
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/calendar" in ct
        text = r.text
        assert text.startswith("BEGIN:VCALENDAR")
        assert "END:VCALENDAR" in text
        assert "VERSION:2.0" in text
        assert "PRODID:" in text
        # At least one VEVENT (we created events above)
        assert text.count("BEGIN:VEVENT") >= 1
        assert text.count("BEGIN:VEVENT") == text.count("END:VEVENT")
        assert "SUMMARY:" in text
