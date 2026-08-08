"""Iteration 10 — Workspace sharing + package_set/revenue_net + created_by fields."""
import os, uuid, pytest, requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')

def _reg(email=None):
    email = email or f"TEST_iter10_{uuid.uuid4().hex[:8]}@t.pl"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "test123", "name": email.split("@")[0]})
    assert r.status_code == 200, r.text
    d = r.json()
    return d["access_token"], d["user"], email

def _h(tok): return {"Authorization": f"Bearer {tok}"}

@pytest.fixture(scope="module")
def two_users():
    a_tok, a_user, a_email = _reg()
    b_tok, b_user, b_email = _reg()
    yield (a_tok, a_user, b_tok, b_user)
    for tok in (a_tok, b_tok):
        try: requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(tok))
        except: pass

# ---- Workspace info default ----
class TestWorkspace:
    def test_workspace_default_own(self, two_users):
        a_tok, a_user, _, _ = two_users
        r = requests.get(f"{BASE_URL}/api/workspace", headers=_h(a_tok))
        assert r.status_code == 200
        d = r.json()
        assert d["workspace_id"] == a_user["id"]
        assert d["invite_code"] == a_user["id"]
        assert any(m["id"] == a_user["id"] for m in d["members"])

    def test_join_own_code_rejected(self, two_users):
        a_tok, a_user, _, _ = two_users
        r = requests.post(f"{BASE_URL}/api/workspace/join", headers=_h(a_tok), json={"code": a_user["id"]})
        assert r.status_code == 400

    def test_join_invalid_code(self, two_users):
        a_tok, *_ = two_users
        r = requests.post(f"{BASE_URL}/api/workspace/join", headers=_h(a_tok), json={"code": "nonexistent-xyz"})
        assert r.status_code == 404

    def test_full_share_flow(self, two_users):
        a_tok, a_user, b_tok, b_user = two_users
        # A creates event
        ev = {"name": "TEST_A_Event", "date": "2026-09-01", "category": "firmowe", "revenue": 1000.0, "revenue_net": 813.0}
        rA = requests.post(f"{BASE_URL}/api/events", headers=_h(a_tok), json=ev)
        assert rA.status_code == 200, rA.text
        a_event = rA.json()
        assert a_event["created_by_name"]
        assert a_event["revenue_net"] == 813.0

        # B does not see it yet
        rB = requests.get(f"{BASE_URL}/api/events", headers=_h(b_tok))
        assert not any(e["id"] == a_event["id"] for e in rB.json())

        # B joins A's workspace
        rj = requests.post(f"{BASE_URL}/api/workspace/join", headers=_h(b_tok), json={"code": a_user["id"]})
        assert rj.status_code == 200, rj.text
        assert rj.json()["workspace_id"] == a_user["id"]

        # B now sees A's event with A's creator name
        rB = requests.get(f"{BASE_URL}/api/events", headers=_h(b_tok))
        assert rB.status_code == 200
        found = [e for e in rB.json() if e["id"] == a_event["id"]]
        assert len(found) == 1
        assert found[0]["created_by_id"] == a_user["id"]
        assert found[0]["created_by_name"] == a_user.get("name")

        # B creates event with adult package_set
        evB = {"name": "TEST_B_Event", "date": "2026-09-02", "category": "dorosli/okolicznosciowe",
               "package_set": "set2", "people": 10, "revenue": 1800.0}
        rBc = requests.post(f"{BASE_URL}/api/events", headers=_h(b_tok), json=evB)
        assert rBc.status_code == 200, rBc.text
        b_event = rBc.json()
        assert b_event["package_set"] == "set2"

        # A sees B's event
        rA2 = requests.get(f"{BASE_URL}/api/events", headers=_h(a_tok))
        assert any(e["id"] == b_event["id"] and e["created_by_name"] == b_user.get("name") for e in rA2.json())

        # workspace members == 2
        rw = requests.get(f"{BASE_URL}/api/workspace", headers=_h(a_tok))
        assert len(rw.json()["members"]) == 2

        # B leaves
        rl = requests.post(f"{BASE_URL}/api/workspace/leave", headers=_h(b_tok))
        assert rl.status_code == 200
        assert rl.json()["workspace_id"] == b_user["id"]

        # B no longer sees A's event
        rB3 = requests.get(f"{BASE_URL}/api/events", headers=_h(b_tok))
        assert not any(e["id"] == a_event["id"] for e in rB3.json())
        # but still sees own (B's owner_id was A's ws when created — after leave, B is on own ws so may not see)
        # per spec: workspace scoping is current — expected that B loses access to own event too
        # A still sees both since they're all in A's workspace
        rA3 = requests.get(f"{BASE_URL}/api/events", headers=_h(a_tok))
        ids = {e["id"] for e in rA3.json()}
        assert a_event["id"] in ids and b_event["id"] in ids

        # cleanup
        requests.delete(f"{BASE_URL}/api/events/{a_event['id']}", headers=_h(a_tok))
        requests.delete(f"{BASE_URL}/api/events/{b_event['id']}", headers=_h(a_tok))

class TestEventFields:
    def test_package_set_and_revenue_net_roundtrip(self, two_users):
        a_tok, *_ = two_users
        ev = {"name": "TEST_pkg", "date": "2026-10-05", "category": "dorosli/okolicznosciowe",
              "package_set": "set3", "people": 20, "revenue": 4000.0, "revenue_net": 3252.0}
        r = requests.post(f"{BASE_URL}/api/events", headers=_h(a_tok), json=ev)
        assert r.status_code == 200
        d = r.json()
        assert d["package_set"] == "set3"
        assert d["revenue_net"] == 3252.0
        # GET verify
        g = requests.get(f"{BASE_URL}/api/events/{d['id']}", headers=_h(a_tok))
        assert g.status_code == 200
        assert g.json()["package_set"] == "set3"
        assert g.json()["revenue_net"] == 3252.0
        requests.delete(f"{BASE_URL}/api/events/{d['id']}", headers=_h(a_tok))

class TestRegression:
    def test_login_existing_user(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_seeded_events_still_visible(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        tok = r.json()["access_token"]
        ev = requests.get(f"{BASE_URL}/api/events", headers=_h(tok))
        assert ev.status_code == 200
        assert isinstance(ev.json(), list)

    def test_staff_scoped(self):
        tok, user, _ = _reg()
        try:
            # create staff
            r = requests.post(f"{BASE_URL}/api/staff", headers=_h(tok), json={"name": "TEST_S", "role": "kelner", "hourly_rate": 40})
            assert r.status_code == 200
            sid = r.json()["id"]
            assert r.json()["created_by_id"] == user["id"]
            # list
            lst = requests.get(f"{BASE_URL}/api/staff", headers=_h(tok)).json()
            assert any(s["id"] == sid for s in lst)
        finally:
            requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(tok))
