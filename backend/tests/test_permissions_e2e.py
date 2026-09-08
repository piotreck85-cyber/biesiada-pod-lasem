"""E2E: individual staff permissions + field-level audit log.
Run: cd /app/backend && python tests/test_permissions_e2e.py
"""
import asyncio, os, sys, uuid
import httpx

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
ADMIN = {"email": "test@eventa.pl", "password": "test123"}
PASS = FAIL = 0

def check(name, cond, extra=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✅ {name}")
    else: FAIL += 1; print(f"  ❌ {name} {extra}")

async def main():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/auth/login", json=ADMIN)
        ah = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # staff + login
        r = await c.post(f"{BASE}/staff", json={"name": "Perm Tester", "hourly_rate": 30}, headers=ah)
        sid = r.json()["id"]
        em = f"perm.{uuid.uuid4().hex[:8]}@test.pl"
        await c.post(f"{BASE}/staff/{sid}/login", json={"email": em, "password": "perm123"}, headers=ah)
        r = await c.post(f"{BASE}/auth/login", json={"email": em, "password": "perm123"})
        eh = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # rich event
        r = await c.post(f"{BASE}/events", json={
            "name": "PERM test event", "date": "2026-12-05", "people": 20, "status": "rezerwacja",
            "price_total": 3000, "revenue": 3000, "deposit_paid": True, "deposit_amount": 500,
            "costs": [{"label": "Materiały", "amount": 400}], "notes": "PRYWATNE notatki",
            "org": {"tables_setup": "podkowa"},
        }, headers=ah)
        ev_id = r.json()["id"]

        async def relogin_emp():
            rr = await c.post(f"{BASE}/auth/login", json={"email": em, "password": "perm123"})
            return {"Authorization": f"Bearer {rr.json()['access_token']}"}

        print("\n== 1. Domyślnie: brak dostępu ==")
        r = await c.get(f"{BASE}/events", headers=eh)
        check("lista imprez pusta (brak shifts, brak calendar_view)", r.status_code == 200 and r.json() == [])
        r = await c.get(f"{BASE}/events/{ev_id}", headers=eh)
        check("nieprzypisana impreza → 403", r.status_code == 403)
        r = await c.put(f"{BASE}/events/{ev_id}", json={"name": "HACK", "date": "2026-12-05"}, headers=eh)
        check("edycja → 403", r.status_code == 403)
        r = await c.post(f"{BASE}/events", json={"name": "X", "date": "2026-12-06"}, headers=eh)
        check("tworzenie → 403", r.status_code == 403)
        r = await c.post(f"{BASE}/events/{ev_id}/resend-thanks", headers=eh)
        check("podziękowania → 403", r.status_code == 403)
        r = await c.post(f"{BASE}/discounts/manual", json={"client_name": "X", "client_email": "x@x.pl"}, headers=eh)
        check("rabat manualny → 403", r.status_code == 403)

        print("\n== 2. calendar_view: widzi kalendarz BEZ cen/finansów/notatek ==")
        r = await c.put(f"{BASE}/staff/{sid}/permissions", json={"permissions": {"calendar_view": True}}, headers=ah)
        check("nadanie uprawnienia OK", r.status_code == 200 and r.json()["permissions"]["calendar_view"] is True)
        eh = await relogin_emp()
        r = await c.get(f"{BASE}/events?year=2026&month=12", headers=eh)
        evs = r.json()
        target = next((e for e in evs if e["id"] == ev_id), None)
        check("widzi imprezę w kalendarzu", target is not None)
        check("BEZ price_total", target and "price_total" not in target)
        check("BEZ revenue/costs/deposit", target and all(k not in target for k in ("revenue", "costs", "deposit_amount")))
        check("BEZ prywatnych notatek", target and "notes" not in target)
        r = await c.get(f"{BASE}/events/{ev_id}", headers=eh)
        check("karta imprezy dostępna, bez cen", r.status_code == 200 and "price_total" not in r.json())

        print("\n== 3. event_status: zmienia TYLKO status ==")
        await c.put(f"{BASE}/staff/{sid}/permissions", json={"permissions": {"event_status": True}}, headers=ah)
        eh = await relogin_emp()
        r = await c.put(f"{BASE}/events/{ev_id}", json={"name": "HACKED NAME", "date": "2026-12-05", "status": "potwierdzona", "price_total": 1}, headers=eh)
        check("PUT ze statusem OK", r.status_code == 200, r.text[:150])
        r = await c.get(f"{BASE}/events/{ev_id}", headers=ah)
        ev = r.json()
        check("status zmieniony", ev.get("status") == "potwierdzona")
        check("nazwa NIE zmieniona", ev.get("name") == "PERM test event", ev.get("name"))
        check("cena NIE zmieniona", float(ev.get("price_total") or 0) == 3000, str(ev.get("price_total")))

        print("\n== 4. Audit log polowy ==")
        r = await c.get(f"{BASE}/events/{ev_id}/audit", headers=ah)
        rows = r.json()
        st_entry = next((x for x in rows if x.get("field") == "status"), None)
        check("wpis status w audycie", st_entry is not None)
        check("stara → nowa wartość", st_entry and st_entry["old"] == "rezerwacja" and st_entry["new"] == "potwierdzona")
        check("kto zmienił", st_entry and st_entry.get("user_name") == "Perm Tester", str(st_entry)[:120])
        # audit uprawnień
        # (perm.calendar_view / perm.event_status na encji staff)

        print("\n== 5. offer_prices: osobny moduł cen ==")
        r = await c.put(f"{BASE}/events/{ev_id}", json={"name": "PERM test event", "date": "2026-12-05", "status": "potwierdzona", "price_total": 3500}, headers=eh)
        rr = await c.get(f"{BASE}/events/{ev_id}", headers=ah)
        check("cena NIE zmieniona bez offer_prices", float(rr.json().get("price_total") or 0) == 3000)
        await c.put(f"{BASE}/staff/{sid}/permissions", json={"permissions": {"offer_prices": True}}, headers=ah)
        eh = await relogin_emp()
        r = await c.get(f"{BASE}/events/{ev_id}", headers=eh)
        check("teraz WIDZI price_total", float(r.json().get("price_total") or 0) == 3000)
        check("nadal BEZ finansów (costs/revenue)", all(k not in r.json() for k in ("costs", "revenue", "deposit_amount")))
        r = await c.put(f"{BASE}/events/{ev_id}", json={"name": "PERM test event", "date": "2026-12-05", "price_total": 3500, "status": "potwierdzona"}, headers=eh)
        check("zmiana ceny z offer_prices OK", r.status_code == 200)
        r = await c.get(f"{BASE}/events/{ev_id}/audit", headers=ah)
        pr = next((x for x in r.json() if x.get("field") == "price_total"), None)
        check("audyt: stara cena 3000 → 3500", pr and pr["old"] == "3000" and pr["new"] == "3500", str(pr)[:120])

        print("\n== 6. finances: osobne, nie wynika z innych ==")
        r = await c.put(f"{BASE}/events/{ev_id}", json={"name": "PERM test event", "date": "2026-12-05", "price_total": 3500, "revenue": 9999}, headers=eh)
        rr = await c.get(f"{BASE}/events/{ev_id}", headers=ah)
        check("przychód NIE zmieniony bez finances", float(rr.json().get("revenue") or 0) == 3000, str(rr.json().get("revenue")))
        await c.put(f"{BASE}/staff/{sid}/permissions", json={"permissions": {"finances": True}}, headers=ah)
        eh = await relogin_emp()
        r = await c.get(f"{BASE}/events/{ev_id}", headers=eh)
        check("z finances widzi koszty i zaliczkę", "costs" in r.json() and "deposit_amount" in r.json())

        print("\n== 7. event_create ==")
        await c.put(f"{BASE}/staff/{sid}/permissions", json={"permissions": {"event_create": True, "offer_prices": False, "finances": False}}, headers=ah)
        eh = await relogin_emp()
        r = await c.post(f"{BASE}/events", json={"name": "Nowa od pracownika", "date": "2026-12-10", "price_total": 5000, "notes": "tajne"}, headers=eh)
        check("tworzenie imprezy OK", r.status_code == 200, r.text[:150])
        new_id = r.json().get("id")
        r = await c.get(f"{BASE}/events/{new_id}", headers=ah)
        check("cena wyzerowana (brak offer_prices)", float(r.json().get("price_total") or 0) == 0)
        check("notatki prywatne wyczyszczone", not r.json().get("notes"))

        print("\n== 8. Audyt zmian uprawnień ==")
        # via history summary log
        # direct db check through admin audit on staff entity isn't exposed — check audit_log via events endpoint pattern skipped

        # cleanup
        print("\n== Cleanup ==")
        await c.delete(f"{BASE}/events/{ev_id}", headers=ah)
        if new_id: await c.delete(f"{BASE}/events/{new_id}", headers=ah)
        await c.delete(f"{BASE}/staff/{sid}", headers=ah)
        print("  cleaned")

    print(f"\n{'='*40}\nRESULT: {PASS} passed, {FAIL} failed\n{'='*40}")
    sys.exit(1 if FAIL else 0)

asyncio.run(main())
