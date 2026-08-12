"""Iteration 15 — offer email (Gmail SMTP) endpoint tests.

Covers:
- POST /api/offers/send-email full & minimal payloads
- Validation (missing / invalid to_email)
- Audit log entry after successful send
- Regression: /api/events, /api/staff, /api/history still work

All test emails go to biesiadapodlasem@gmail.com (user's own inbox).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
if not BASE_URL:
    BASE_URL = "https://event-profit-tracker.preview.emergentagent.com"

TEST_EMAIL = "biesiadapodlasem@gmail.com"
LOGIN_EMAIL = "test@eventa.pl"
LOGIN_PASSWORD = "test123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- 1. Full payload ----------
def test_send_offer_full_payload(auth_headers):
    """POST /api/offers/send-email with all fields → 200, ok:true"""
    payload = {
        "to_email": TEST_EMAIL,
        "client_name": "TEST_Pytest Klient",
        "event_date": "2026-08-15",
        "people_count": 20,
        "package_set_id": "set2",
        "extras": [
            {"id": "napoje", "qty": 20},
            {"id": "salatka", "qty": 8},
            {"id": "ciasto", "amount": 200},
        ],
        "custom_note": "TEST_pytest — proszę o kontakt telefoniczny.",
    }
    r = requests.post(f"{BASE_URL}/api/offers/send-email", json=payload, headers=auth_headers, timeout=60)
    assert r.status_code == 200, f"unexpected status: {r.status_code} body={r.text}"
    data = r.json()
    assert data.get("ok") is True
    assert data.get("to") == TEST_EMAIL


# ---------- 2. Minimal payload ----------
def test_send_offer_minimal_payload(auth_headers):
    """POST with only to_email → 200"""
    r = requests.post(
        f"{BASE_URL}/api/offers/send-email",
        json={"to_email": TEST_EMAIL},
        headers=auth_headers,
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    d = r.json()
    assert d.get("ok") is True
    assert d.get("to") == TEST_EMAIL


# ---------- 3. Missing to_email ----------
def test_send_offer_missing_to_email(auth_headers):
    r = requests.post(f"{BASE_URL}/api/offers/send-email", json={}, headers=auth_headers, timeout=15)
    assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


# ---------- 4. Invalid email format ----------
def test_send_offer_invalid_email_format(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/offers/send-email",
        json={"to_email": "not-an-email"},
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


# ---------- 5. Audit-log entry appears ----------
def test_send_offer_creates_history_entry(auth_headers):
    """After a successful send, /api/history should include an entry
    with entity_type=offer_email and summary starting with 'Wysłano ofertę do'."""
    payload = {
        "to_email": TEST_EMAIL,
        "client_name": "TEST_History Check",
        "event_date": "2026-09-01",
        "people_count": 10,
        "package_set_id": "set1",
    }
    r = requests.post(f"{BASE_URL}/api/offers/send-email", json=payload, headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text

    h = requests.get(f"{BASE_URL}/api/history?limit=20", headers=auth_headers, timeout=15)
    assert h.status_code == 200
    items = h.json()
    offer_entries = [i for i in items if i.get("entity_type") == "offer_email"]
    assert len(offer_entries) > 0, "no offer_email audit entries found"
    top = offer_entries[0]
    assert "Wysłano ofertę do" in (top.get("summary") or "")
    assert TEST_EMAIL in top.get("summary", "")
    assert top.get("action") == "create"


# ---------- 6. Auth required ----------
def test_send_offer_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/offers/send-email",
        json={"to_email": TEST_EMAIL},
        timeout=15,
    )
    assert r.status_code == 401, f"expected 401, got {r.status_code}"


# ---------- 7. Regression: /api/events ----------
def test_regression_events_endpoint(auth_headers):
    r = requests.get(f"{BASE_URL}/api/events", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------- 8. Regression: /api/staff ----------
def test_regression_staff_endpoint(auth_headers):
    r = requests.get(f"{BASE_URL}/api/staff", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------- 9. Regression: /api/history ----------
def test_regression_history_endpoint(auth_headers):
    r = requests.get(f"{BASE_URL}/api/history?limit=5", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
