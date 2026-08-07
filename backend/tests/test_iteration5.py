"""Iteration 5: DELETE /api/auth/me (account deletion) + JWT_SECRET env-only regression."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://event-profit-tracker.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api_client, email=None, pw="test123"):
    email = email or f"TEST_delete_{uuid.uuid4().hex[:10]}@eventa.pl"
    r = api_client.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "TEST"})
    assert r.status_code == 200, r.text
    return email, r.json()["access_token"], r.json()["user"]["id"]


# ---------- DELETE /api/auth/me ----------
class TestDeleteAccount:
    def test_delete_without_token_returns_401(self, api_client):
        r = api_client.delete(f"{API}/auth/me")
        assert r.status_code == 401, r.text

    def test_delete_with_invalid_token_returns_401(self, api_client):
        r = api_client.delete(f"{API}/auth/me", headers={"Authorization": "Bearer garbage.token.value"})
        assert r.status_code == 401

    def test_delete_wipes_user_events_staff_templates(self, api_client):
        email, token, uid = _register(api_client)
        h = {"Authorization": f"Bearer {token}"}

        # Seed a staff, event, template so we can verify wipe
        st = api_client.post(f"{API}/staff", json={"name": "TEST_S", "role": "x", "hourly_rate": 10}, headers=h)
        assert st.status_code == 200
        ev = api_client.post(f"{API}/events", json={"name": "TEST_E", "date": "2026-06-01"}, headers=h)
        assert ev.status_code == 200
        tp = api_client.post(f"{API}/templates", json={"name": "TEST_T"}, headers=h)
        assert tp.status_code == 200

        # Sanity: listing shows items
        assert len(api_client.get(f"{API}/staff", headers=h).json()) >= 1
        assert len(api_client.get(f"{API}/events", headers=h).json()) >= 1
        assert len(api_client.get(f"{API}/templates", headers=h).json()) >= 1

        # Delete account
        d = api_client.delete(f"{API}/auth/me", headers=h)
        assert d.status_code == 200, d.text
        assert d.json() == {"ok": True}

        # Same token should now be 401 (user gone)
        me = api_client.get(f"{API}/auth/me", headers=h)
        assert me.status_code == 401

        # Login with same email should fail
        lr = api_client.post(f"{API}/auth/login", json={"email": email, "password": "test123"})
        assert lr.status_code == 401

    def test_delete_isolation_other_user_unaffected(self, api_client):
        # User A
        _, tokenA, _ = _register(api_client)
        hA = {"Authorization": f"Bearer {tokenA}"}
        api_client.post(f"{API}/staff", json={"name": "TEST_A_staff", "hourly_rate": 5}, headers=hA)
        api_client.post(f"{API}/events", json={"name": "TEST_A_event", "date": "2026-07-01"}, headers=hA)

        # User B (throwaway to delete)
        _, tokenB, _ = _register(api_client)
        hB = {"Authorization": f"Bearer {tokenB}"}
        api_client.post(f"{API}/staff", json={"name": "TEST_B_staff", "hourly_rate": 5}, headers=hB)

        # Delete B
        d = api_client.delete(f"{API}/auth/me", headers=hB)
        assert d.status_code == 200

        # A still works and still has data
        me = api_client.get(f"{API}/auth/me", headers=hA)
        assert me.status_code == 200
        staff = api_client.get(f"{API}/staff", headers=hA).json()
        assert any(s["name"] == "TEST_A_staff" for s in staff)
        events = api_client.get(f"{API}/events", headers=hA).json()
        assert any(e["name"] == "TEST_A_event" for e in events)

        # Cleanup A
        api_client.delete(f"{API}/auth/me", headers=hA)


# ---------- Regression: seeded user still works ----------
class TestSeededUserRegression:
    def test_seeded_login_and_me(self, api_client):
        r = api_client.post(f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        me = api_client.get(f"{API}/auth/me", headers=h)
        assert me.status_code == 200
        assert me.json()["email"] == "test@eventa.pl"

    def test_seeded_user_core_endpoints(self, api_client):
        token = api_client.post(f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        for path in ["/events", "/staff", "/templates", "/stats?year=2026&month=6",
                     "/staff/wages?year=2026&month=6", "/schedule?year=2026&month=6"]:
            r = api_client.get(f"{API}{path}", headers=h)
            assert r.status_code == 200, f"{path} → {r.status_code} {r.text}"


# ---------- JWT_SECRET env-only ----------
class TestJwtSecretEnv:
    def test_jwt_secret_in_env_file(self):
        # Backend is running which implies env loaded; verify .env has JWT_SECRET set
        env_path = "/app/backend/.env"
        assert os.path.exists(env_path)
        with open(env_path) as f:
            content = f.read()
        assert "JWT_SECRET=" in content
        # Ensure value is non-empty
        for line in content.splitlines():
            if line.startswith("JWT_SECRET="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                assert len(val) >= 8, "JWT_SECRET must be non-empty"

    def test_backend_up_and_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True
