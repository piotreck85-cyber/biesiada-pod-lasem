"""Iteration 11 — WhatsApp import (expenses & revenue) endpoint tests."""
import os, uuid, pytest, requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')

def _reg():
    email = f"TEST_iter11_{uuid.uuid4().hex[:8]}@t.pl"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "test123", "name": email.split("@")[0]})
    assert r.status_code == 200, r.text
    d = r.json()
    return d["access_token"], d["user"]

def _h(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def user_ctx():
    tok, u = _reg()
    yield tok, u
    try: requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(tok))
    except: pass


# --- WhatsApp import: expenses ---
class TestWhatsAppExpenses:
    def test_import_expenses_basic(self, user_ctx):
        tok, u = user_ctx
        # Sample chat lines (PL WhatsApp export format)
        text = "\n".join([
            "05.03.2026, 12:10 - Jan: Wiadomości i połączenia są zaszyfrowane end-to-end",  # skip
            "05.03.2026, 12:11 - Jan utworzył grupę",                                          # skip
            "05.03.2026, 12:15 - Marek: Koszt 428zl mięso",                                    # exp 428
            "06.03.2026, 08:30 - Ania: Rata 59,99 sery",                                       # exp 59.99
            "07.03.2026, 14:00 - Marek: 300 zl warzywa",                                       # exp 300
            "07.03.2026, 14:05 - Marek: pominięto <załącznik>",                                # skip
            "07.03.2026, 14:06 - Marek: bez kwoty tylko tekst",                                # skip no amount
            "not a matching line at all",                                                       # skip regex
        ])
        r = requests.post(f"{BASE_URL}/api/import/whatsapp", headers=_h(tok),
                          json={"text": text, "kind": "expenses"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["parsed_lines"] == 6  # 6 lines matched date-time-author-text regex
        assert d["created"] == 3
        assert d["matched_existing_events"] == 0
        assert d["skipped"] == 3       # zaszyfrowane + pominięto + no-amount

        # Verify persisted in db.expenses via GET
        exp_list = requests.get(f"{BASE_URL}/api/expenses?year=2026&month=3", headers=_h(tok)).json()
        labels = [e["label"] for e in exp_list]
        amounts = sorted(e["amount"] for e in exp_list)
        assert any("mięso" in l for l in labels)
        assert 428.0 in amounts and 59.99 in amounts and 300.0 in amounts
        # created_by_name = author from chat line
        creators = {e.get("created_by_name") for e in exp_list}
        assert "Marek" in creators and "Ania" in creators

    def test_invalid_kind_rejected(self, user_ctx):
        tok, _ = user_ctx
        r = requests.post(f"{BASE_URL}/api/import/whatsapp", headers=_h(tok),
                          json={"text": "05.03.2026, 12:00 - X: Koszt 10 zl", "kind": "foo"})
        assert r.status_code == 400


# --- WhatsApp import: revenue ---
class TestWhatsAppRevenue:
    def test_revenue_matches_existing_and_creates_new(self, user_ctx):
        tok, _ = user_ctx
        # Create an existing event on 2026-04-10 with revenue 500
        ev = {"name": "TEST_Existing", "date": "2026-04-10", "revenue": 500.0}
        rc = requests.post(f"{BASE_URL}/api/events", headers=_h(tok), json=ev)
        assert rc.status_code == 200
        ev_id = rc.json()["id"]

        text = "\n".join([
            "10.04.2026, 15:00 - Piotr: Zysk 1200 zl impreza",     # should match existing → +1200
            "11.04.2026, 15:00 - Piotr: 800,50 wesele",             # no event → new event
            "12.04.2026, 12:00 - X: utworzył grupę",                # skip
            "12.04.2026, 12:00 - X: bez kwoty słowa",               # skip no amount
        ])
        r = requests.post(f"{BASE_URL}/api/import/whatsapp", headers=_h(tok),
                          json={"text": text, "kind": "revenue"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["parsed_lines"] == 4
        assert d["matched_existing_events"] == 1
        assert d["created"] == 1
        assert d["skipped"] == 2

        # Verify existing event got its revenue bumped 500 + 1200 = 1700
        upd = requests.get(f"{BASE_URL}/api/events/{ev_id}", headers=_h(tok)).json()
        assert upd["revenue"] == 1700.0

        # Verify the new event exists on 2026-04-11
        all_ev = requests.get(f"{BASE_URL}/api/events", headers=_h(tok)).json()
        new_ev = [e for e in all_ev if e["date"] == "2026-04-11" and e.get("imported_source") == "whatsapp"]
        assert len(new_ev) == 1
        assert new_ev[0]["revenue"] == 800.5

        # cleanup
        requests.delete(f"{BASE_URL}/api/events/{ev_id}", headers=_h(tok))
        requests.delete(f"{BASE_URL}/api/events/{new_ev[0]['id']}", headers=_h(tok))


class TestWhatsAppSkipping:
    def test_all_system_and_malformed_lines_skipped(self, user_ctx):
        tok, _ = user_ctx
        text = "\n".join([
            "Wiadomości i połączenia są zaszyfrowane",           # no regex match → not counted
            "05.05.2026, 09:00 - X: utworzył grupę",              # skip-keyword
            "05.05.2026, 09:01 - X: dodał kogoś",                 # skip-keyword
            "05.05.2026, 09:02 - X: zaszyfrowane end-to-end",     # skip-keyword
            "05.05.2026, 09:03 - X: pominięto załącznik",         # skip-keyword
            "05.05.2026, 09:04 - X: tylko tekst bez cyfr",        # no amount
        ])
        r = requests.post(f"{BASE_URL}/api/import/whatsapp", headers=_h(tok),
                          json={"text": text, "kind": "expenses"})
        assert r.status_code == 200
        d = r.json()
        assert d["created"] == 0
        assert d["matched_existing_events"] == 0
        assert d["parsed_lines"] == 5
        assert d["skipped"] == 5


# --- Regression: workspace still works ---
class TestRegression:
    def test_workspace_default(self):
        tok, u = _reg()
        try:
            r = requests.get(f"{BASE_URL}/api/workspace", headers=_h(tok))
            assert r.status_code == 200
            assert r.json()["workspace_id"] == u["id"]
        finally:
            requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(tok))

    def test_login_seeded(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "test@eventa.pl", "password": "test123"})
        assert r.status_code == 200
