"""Iteration 14 — Audit log / Historia zmian feature tests.

Covers:
  - log_change writes on event/staff/expense create/update/delete
  - GET /api/history sort desc + limit
  - DELETE /api/history clears only current workspace
  - Workspace isolation (unrelated user sees no entries)
  - Workspace sharing (joined user sees same entries)
  - Regression: create/update/delete endpoints still return 2xx
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# --------- Fixtures ---------
def _register(prefix: str = "hist"):
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@eventa.pl"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "test123", "name": prefix})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["user"], email


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_a():
    tok, u, email = _register("A")
    yield {"token": tok, "user": u, "email": email}
    # cleanup account
    try:
        requests.delete(f"{API}/auth/me", headers=_auth(tok))
    except Exception:
        pass


@pytest.fixture(scope="module")
def user_b():
    tok, u, email = _register("B")
    yield {"token": tok, "user": u, "email": email}
    try:
        requests.delete(f"{API}/auth/me", headers=_auth(tok))
    except Exception:
        pass


@pytest.fixture(scope="module")
def user_c():
    """Unrelated user for isolation test."""
    tok, u, email = _register("C")
    yield {"token": tok, "user": u, "email": email}
    try:
        requests.delete(f"{API}/auth/me", headers=_auth(tok))
    except Exception:
        pass


# --------- History endpoint basics ---------
class TestHistoryBasics:
    def test_empty_history_new_user(self, user_c):
        r = requests.get(f"{API}/history", headers=_auth(user_c["token"]))
        assert r.status_code == 200
        assert r.json() == []

    def test_history_endpoint_shape(self, user_a):
        r = requests.get(f"{API}/history", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------- Events audit logging ---------
class TestEventAudit:
    _event_id = None

    def test_event_create_logs(self, user_a):
        payload = {
            "name": "TEST_History Event",
            "date": "2026-06-01",
            "category": "dorosli",
            "people": 20,
            "revenue": 1000.0,
        }
        r = requests.post(f"{API}/events", json=payload, headers=_auth(user_a["token"]))
        assert r.status_code == 200, r.text
        TestEventAudit._event_id = r.json()["id"]

        # history
        h = requests.get(f"{API}/history", headers=_auth(user_a["token"]))
        assert h.status_code == 200
        entries = h.json()
        assert len(entries) >= 1
        top = entries[0]
        assert top["action"] == "create"
        assert top["entity_type"] == "event"
        assert top["entity_id"] == TestEventAudit._event_id
        assert "TEST_History Event" in top["summary"]
        assert "2026-06-01" in top["summary"]
        assert top["user_name"]  # non-empty
        assert top["at"]  # timestamp present

    def test_event_update_logs(self, user_a):
        assert TestEventAudit._event_id
        payload = {
            "name": "TEST_History Event Updated",
            "date": "2026-06-02",
            "category": "dorosli",
            "people": 25,
            "revenue": 1500.0,
        }
        r = requests.put(f"{API}/events/{TestEventAudit._event_id}", json=payload, headers=_auth(user_a["token"]))
        assert r.status_code == 200, r.text

        h = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        assert len(h) >= 2
        top = h[0]
        assert top["action"] == "update"
        assert top["entity_type"] == "event"
        assert "Updated" in top["summary"]

    def test_event_delete_logs(self, user_a):
        r = requests.delete(f"{API}/events/{TestEventAudit._event_id}", headers=_auth(user_a["token"]))
        assert r.status_code == 200

        h = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        assert len(h) >= 3
        top = h[0]
        assert top["action"] == "delete"
        assert top["entity_type"] == "event"

    def test_history_sorted_desc(self, user_a):
        h = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        ts = [e["at"] for e in h]
        assert ts == sorted(ts, reverse=True), "history is not sorted desc by 'at'"


# --------- Staff audit logging ---------
class TestStaffAudit:
    _sid = None

    def test_staff_create_logs(self, user_a):
        r = requests.post(f"{API}/staff", json={"name": "TEST_HistStaff", "role": "kelner", "hourly_rate": 30}, headers=_auth(user_a["token"]))
        assert r.status_code == 200, r.text
        TestStaffAudit._sid = r.json()["id"]
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "create"
        assert top["entity_type"] == "staff"
        assert "TEST_HistStaff" in top["summary"]

    def test_staff_update_logs(self, user_a):
        r = requests.put(f"{API}/staff/{TestStaffAudit._sid}", json={"name": "TEST_HistStaff2", "role": "barman", "hourly_rate": 40}, headers=_auth(user_a["token"]))
        assert r.status_code == 200
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "update"
        assert top["entity_type"] == "staff"
        assert "TEST_HistStaff2" in top["summary"]

    def test_staff_delete_logs(self, user_a):
        r = requests.delete(f"{API}/staff/{TestStaffAudit._sid}", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "delete"
        assert top["entity_type"] == "staff"


# --------- Expense audit logging ---------
class TestExpenseAudit:
    _eid = None

    def test_expense_create_logs(self, user_a):
        r = requests.post(f"{API}/expenses", json={"label": "TEST_HistExp", "amount": 250.5, "date": "2026-06-15"}, headers=_auth(user_a["token"]))
        assert r.status_code == 200, r.text
        TestExpenseAudit._eid = r.json()["id"]
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "create"
        assert top["entity_type"] == "expense"
        assert "TEST_HistExp" in top["summary"]

    def test_expense_update_logs(self, user_a):
        r = requests.put(f"{API}/expenses/{TestExpenseAudit._eid}", json={"label": "TEST_HistExp2", "amount": 300, "date": "2026-06-15"}, headers=_auth(user_a["token"]))
        assert r.status_code == 200
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "update"
        assert top["entity_type"] == "expense"
        assert "TEST_HistExp2" in top["summary"]

    def test_expense_delete_logs(self, user_a):
        r = requests.delete(f"{API}/expenses/{TestExpenseAudit._eid}", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        top = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()[0]
        assert top["action"] == "delete"
        assert top["entity_type"] == "expense"


# --------- Workspace isolation ---------
class TestWorkspaceIsolation:
    def test_unrelated_user_has_no_entries(self, user_c):
        # user_c never touched anything (only registered)
        h = requests.get(f"{API}/history", headers=_auth(user_c["token"]))
        assert h.status_code == 200
        assert h.json() == [], "unrelated user should not see other workspaces' history"

    def test_user_a_has_multiple_entries(self, user_a):
        h = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        # After event+staff+expense CRUD: at least 9 entries
        assert len(h) >= 9, f"expected >=9 entries, got {len(h)}"
        # entity_type variety
        types = {e["entity_type"] for e in h}
        assert {"event", "staff", "expense"}.issubset(types)


# --------- Workspace sharing ---------
class TestWorkspaceSharing:
    def test_b_joins_a_and_sees_same_history(self, user_a, user_b):
        # user_b joins user_a's workspace via user_a's id as invite code
        r = requests.post(
            f"{API}/workspace/join",
            json={"code": user_a["user"]["id"]},
            headers=_auth(user_b["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["workspace_id"] == user_a["user"]["id"]

        # b's history should now equal a's history
        ha = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        hb = requests.get(f"{API}/history", headers=_auth(user_b["token"])).json()
        assert len(ha) == len(hb) and len(ha) > 0
        # compare ids as set
        ids_a = {e["id"] for e in ha}
        ids_b = {e["id"] for e in hb}
        assert ids_a == ids_b

    def test_b_action_visible_to_a(self, user_a, user_b):
        # user_b creates a staff -> user_a should see it in history
        r = requests.post(f"{API}/staff", json={"name": "TEST_ByB", "role": "", "hourly_rate": 0}, headers=_auth(user_b["token"]))
        assert r.status_code == 200
        sid = r.json()["id"]
        ha = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        top = ha[0]
        assert top["action"] == "create"
        assert top["entity_type"] == "staff"
        assert "TEST_ByB" in top["summary"]
        # cleanup
        requests.delete(f"{API}/staff/{sid}", headers=_auth(user_b["token"]))

    def test_b_leaves_workspace(self, user_b):
        r = requests.post(f"{API}/workspace/leave", headers=_auth(user_b["token"]))
        assert r.status_code == 200
        # b's history should be empty again (own personal workspace)
        hb = requests.get(f"{API}/history", headers=_auth(user_b["token"])).json()
        assert hb == []


# --------- Clear history ---------
class TestClearHistory:
    def test_delete_history_only_current_workspace(self, user_a, user_c):
        # Snapshot user_a count before
        ha_before = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        assert len(ha_before) > 0

        # Ensure user_c has no history (unrelated ws)
        hc_before = requests.get(f"{API}/history", headers=_auth(user_c["token"])).json()

        # Add an event for user_c so their history is non-empty
        r = requests.post(f"{API}/events", json={"name": "TEST_C event", "date": "2026-07-01", "revenue": 0}, headers=_auth(user_c["token"]))
        assert r.status_code == 200
        c_eid = r.json()["id"]
        hc = requests.get(f"{API}/history", headers=_auth(user_c["token"])).json()
        assert len(hc) == len(hc_before) + 1

        # Clear only user_a's workspace
        r = requests.delete(f"{API}/history", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # user_a history now empty
        ha_after = requests.get(f"{API}/history", headers=_auth(user_a["token"])).json()
        assert ha_after == []

        # user_c history untouched
        hc_after = requests.get(f"{API}/history", headers=_auth(user_c["token"])).json()
        assert len(hc_after) == len(hc), "clearing A's history should not affect C"

        # cleanup c
        requests.delete(f"{API}/events/{c_eid}", headers=_auth(user_c["token"]))
        requests.delete(f"{API}/history", headers=_auth(user_c["token"]))


# --------- Regression: endpoints still work ---------
class TestRegression:
    def test_events_get_still_works(self, user_a):
        r = requests.get(f"{API}/events", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_staff_get_still_works(self, user_a):
        r = requests.get(f"{API}/staff", headers=_auth(user_a["token"]))
        assert r.status_code == 200

    def test_expenses_get_still_works(self, user_a):
        r = requests.get(f"{API}/expenses", headers=_auth(user_a["token"]))
        assert r.status_code == 200

    def test_history_limit_param(self, user_a):
        # create 3 quick entries
        ids = []
        for i in range(3):
            r = requests.post(f"{API}/staff", json={"name": f"TEST_L{i}", "role": "", "hourly_rate": 0}, headers=_auth(user_a["token"]))
            ids.append(r.json()["id"])
        h_full = requests.get(f"{API}/history?limit=200", headers=_auth(user_a["token"])).json()
        h_lim = requests.get(f"{API}/history?limit=2", headers=_auth(user_a["token"])).json()
        assert len(h_lim) <= 2
        assert len(h_full) >= 3
        # cleanup
        for sid in ids:
            requests.delete(f"{API}/staff/{sid}", headers=_auth(user_a["token"]))
