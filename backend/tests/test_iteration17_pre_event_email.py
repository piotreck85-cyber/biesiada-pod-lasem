"""Iteration 17: pre-event email scheduling/regulation API regression (no SMTP send endpoints).

Scope:
- status/preview/regulation endpoints
- 48h scheduling + immediate late-confirmation scheduling
- status/date-time changes and cancellation behavior
- missing email handling + exact notice
- idempotency and persisted event fields
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests


def _load_frontend_env() -> None:
    if os.environ.get("EXPO_PUBLIC_BACKEND_URL"):
        return
    try:
        with open("/app/frontend/.env", "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


_load_frontend_env()
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session() -> requests.Session:
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is missing"
    return requests.Session()


@pytest.fixture(scope="module")
def auth_headers(session: requests.Session) -> dict:
    # Auth flow for this regression suite
    resp = session.post(
        f"{API}/auth/login",
        json={"email": "test@eventa.pl", "password": "test123"},
        timeout=30,
    )
    if resp.status_code != 200:
        pytest.skip(f"Auth login failed for test credentials: {resp.status_code} {resp.text[:200]}")
    token = resp.json().get("access_token")
    if not token:
        pytest.skip("Auth login did not return access_token")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def temp_events(session: requests.Session, auth_headers: dict):
    # Event lifecycle fixture for create/delete of TEST_ temporary events
    created_ids: list[str] = []

    def _create(**overrides):
        far_date = (datetime.now(timezone.utc).date() + timedelta(days=365 * 4)).strftime("%Y-%m-%d")
        payload = {
            "name": f"TEST_PRE_EMAIL_{uuid.uuid4().hex[:8]}",
            "date": far_date,
            "time_start": "18:00",
            "time_end": "22:00",
            "time": "18:00",
            "status": "potwierdzona",
            "category": "dzieci/urodzinki/standard",
            "client_name": "TEST Klient",
            "client_email": "test-pre-email@example.com",
            "client_phone": "+48 000 000 000",
            "notes": "TEST only",
            "venue": "TEST Venue",
            "revenue": 1000,
            "costs": [],
            "shifts": [],
        }
        payload.update(overrides)
        res = session.post(f"{API}/events", json=payload, headers=auth_headers, timeout=30)
        assert res.status_code == 200, res.text
        body = res.json()
        created_ids.append(body["id"])
        return body

    yield _create

    for eid in created_ids:
        session.delete(f"{API}/events/{eid}", headers=auth_headers, timeout=30)


class TestPreEventEmailRegression:
    # ----- category->regulation mapping + exact one PDF -----
    @pytest.mark.parametrize(
        "category,expected_type,expected_filename",
        [
            ("dorosli/okolicznosciowe", "adults", "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"),
            ("dorosli/firmowe", "adults", "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"),
            ("dzieci/urodzinki/standard", "children", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
            ("warsztaty/przyrodnicze", "children", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
            ("dzieci/wycieczki", "children", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
        ],
    )
    def test_mapping_and_single_regulation_pdf(
        self,
        session: requests.Session,
        auth_headers: dict,
        temp_events,
        category: str,
        expected_type: str,
        expected_filename: str,
    ):
        ev = temp_events(category=category)
        eid = ev["id"]

        status = session.get(
            f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30
        )
        assert status.status_code == 200, status.text
        payload = status.json()
        assert payload["regulation_type"] == expected_type

        reg = session.get(
            f"{API}/events/{eid}/pre-event-email/regulation", headers=auth_headers, timeout=30
        )
        assert reg.status_code == 200, reg.text
        assert "application/pdf" in reg.headers.get("content-type", "")
        cd = reg.headers.get("content-disposition", "")
        assert expected_filename in cd

    # ----- scheduling rules -----
    def test_non_confirmed_status_not_scheduled(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(status="rezerwacja")
        r = session.get(f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "not_scheduled"
        assert data["scheduled_at"] is None

    def test_48h_warsaw_schedule_for_confirmed(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(date="2031-06-15", time_start="18:00", time="18:00", status="potwierdzona")
        r = session.get(f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        # 2031-06-15 18:00 Europe/Warsaw == 16:00 UTC in June; minus 48h => 2031-06-13 16:00 UTC
        assert data["status"] == "scheduled"
        assert data["scheduled_at"] == "2031-06-13T16:00:00+00:00"

    def test_late_confirmation_schedules_immediately(self, session: requests.Session, auth_headers: dict, temp_events):
        soon_local = datetime.now(timezone.utc) + timedelta(hours=24)
        ev = temp_events(
            date=soon_local.strftime("%Y-%m-%d"),
            time_start=soon_local.strftime("%H:%M"),
            time=soon_local.strftime("%H:%M"),
            status="potwierdzona",
        )
        before = datetime.now(timezone.utc)
        r = session.get(f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30)
        after = datetime.now(timezone.utc)
        assert r.status_code == 200
        data = r.json()
        planned = datetime.fromisoformat(data["scheduled_at"])
        assert data["status"] == "scheduled"
        assert before - timedelta(seconds=5) <= planned <= after + timedelta(seconds=5)

    def test_date_time_change_reschedules(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(date="2031-09-10", time_start="18:00", time="18:00")
        eid = ev["id"]

        first = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30).json()
        original_time = first["scheduled_at"]

        update_payload = {
            **ev,
            "date": "2031-09-12",
            "time_start": "20:00",
            "time": "20:00",
        }
        u = session.put(f"{API}/events/{eid}", json=update_payload, headers=auth_headers, timeout=30)
        assert u.status_code == 200, u.text

        changed = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30).json()
        assert changed["scheduled_at"] != original_time

    def test_status_change_cancels_schedule(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(status="potwierdzona")
        eid = ev["id"]
        _ = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30)

        u = session.put(
            f"{API}/events/{eid}",
            json={**ev, "status": "anulowana"},
            headers=auth_headers,
            timeout=30,
        )
        assert u.status_code == 200, u.text

        cancelled = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30).json()
        assert cancelled["status"] == "cancelled"
        assert cancelled["scheduled_at"] is None

    # ----- missing email + exact notice -----
    def test_missing_email_sets_no_email_failure(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(client_email="", category="dorosli/firmowe")
        r = session.get(f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        expected = "Brak adresu e-mail klienta – wiadomość przed imprezą nie została wysłana."
        assert data["status"] == "failed"
        assert data["error_code"] == "no_email"
        assert data["notice"] == expected
        assert data["error"] == expected

    def test_missing_email_creates_owner_admin_alert_notice(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(client_email="", category="dorosli/okolicznosciowe")
        expected = "Brak adresu e-mail klienta – wiadomość przed imprezą nie została wysłana."

        # Trigger reconcile + alert sync
        status_resp = session.get(
            f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30
        )
        assert status_resp.status_code == 200

        alerts_resp = session.get(f"{API}/alerts", headers=auth_headers, timeout=30)
        assert alerts_resp.status_code == 200, alerts_resp.text
        alerts = alerts_resp.json()
        mine = [a for a in alerts if a.get("event_id") == ev["id"] and a.get("kind") == "pre_event_email_no_email"]
        assert mine, f"Expected owner/admin no-email alert for event {ev['id']}"
        assert mine[0].get("message") == expected

        # Cleanup this test alert from active list
        session.post(f"{API}/alerts/{mine[0]['id']}/dismiss", headers=auth_headers, timeout=30)

    # ----- idempotency + persistence -----
    def test_ordinary_edit_does_not_reschedule(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(date="2031-10-01", time_start="17:00", time="17:00")
        eid = ev["id"]
        first = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30).json()
        scheduled_first = first["scheduled_at"]

        changed_name = {**ev, "name": f"{ev['name']}_EDIT"}
        u = session.put(f"{API}/events/{eid}", json=changed_name, headers=auth_headers, timeout=30)
        assert u.status_code == 200

        second = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30).json()
        assert second["scheduled_at"] == scheduled_first

    def test_sent_event_not_auto_rescheduled(self, session: requests.Session, auth_headers: dict, temp_events):
        sent_at = datetime.now(timezone.utc).isoformat()
        ev = temp_events(
            pre_event_email_status="sent",
            pre_event_email_sent_at=sent_at,
            pre_event_email_message_id="<already@sent>",
        )
        r = session.get(f"{API}/events/{ev['id']}/pre-event-email/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "sent"
        assert data["sent_at"] == sent_at

    def test_status_call_persists_fields_on_event(self, session: requests.Session, auth_headers: dict, temp_events):
        ev = temp_events(category="dorosli/okolicznosciowe", status="potwierdzona")
        eid = ev["id"]

        s = session.get(f"{API}/events/{eid}/pre-event-email/status", headers=auth_headers, timeout=30)
        assert s.status_code == 200
        status_payload = s.json()

        get_ev = session.get(f"{API}/events/{eid}", headers=auth_headers, timeout=30)
        assert get_ev.status_code == 200, get_ev.text
        data = get_ev.json()
        assert data.get("pre_event_email_status") == status_payload["status"]
        assert data.get("pre_event_email_scheduled_at") == status_payload["scheduled_at"]
        assert data.get("pre_event_email_schedule_key")
        assert data.get("regulation_type") == "adults"
