"""E2E test: staff event card, permissions, comments, service infos, client updates,
AI reply suggestions (simulated Gmail reply). Cleans up afterwards."""
import asyncio, os, sys, uuid
from datetime import datetime, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

BASE = "http://localhost:8001/api"
ok = fail = 0

def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name} {str(extra)[:300]}")

FORBIDDEN_STAFF_FIELDS = [
    "price_total", "revenue", "revenue_net", "costs", "cost_total", "profit",
    "deposit_amount", "deposit_paid", "deposit_date", "discount_pct",
    "price_after_discount", "margin_ratio", "dinner_revenue", "dinner_profit",
    "dinner_cost", "notes", "client_notes", "client_phone", "client_email", "finance",
]

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "eventa_db")]
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(f"{BASE}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        check("admin login", r.status_code == 200, r.text)
        admin_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        owner_id = r.json()["user"]["id"]

        # staff + login
        r = await c.post(f"{BASE}/staff", json={"name": "Zuzia Testowa", "role": "Kelnerka", "hourly_rate": 30}, headers=admin_h)
        staff_id = r.json()["id"]
        staff_email = f"zuzia-test-{uuid.uuid4().hex[:6]}@example.com"
        r = await c.post(f"{BASE}/staff/{staff_id}/login", json={"email": staff_email, "password": "haslo123"}, headers=admin_h)
        check("staff login created", r.status_code == 200, r.text)

        # event with org fields
        ev_body = {
            "name": "Urodzinki Test Karta", "date": "2026-09-15", "time_start": "16:00", "time_end": "20:00",
            "category": "dzieci/urodzinki/standard", "people": 30, "package_set": "standard",
            "status": "potwierdzona", "price_total": 2500, "revenue": 2500,
            "notes": "PRYWATNA notatka admina", "client_name": "Jan Klient", "client_email": "klient@example.com",
            "deposit_amount": 500, "deposit_paid": True,
            "org": {
                "tables_setup": "4 stoły po 8 osób", "grill": "Kiełbaski o 18:00",
                "drinks": "Cola, soki", "allergies": "1 os. bez glutenu",
                "early_arrival": True, "early_arrival_time": "15:30",
                "client_own_decorations": True, "kids_count": 12, "adults_count": 18,
            },
            "shifts": [{"staff_id": staff_id, "hours": 5, "time_start": "15:00", "time_end": "20:00"}],
            "costs": [{"label": "Produkty", "amount": 400}],
        }
        r = await c.post(f"{BASE}/events", json=ev_body, headers=admin_h)
        check("event created", r.status_code == 200, r.text)
        ev_id = r.json()["id"]

        try:
            # admin: service info (important + normal) + client update
            r = await c.post(f"{BASE}/events/{ev_id}/service-info", json={"text": "Klient przyjeżdża 30 min wcześniej z dekoracjami.", "important": True}, headers=admin_h)
            check("service info important", r.status_code == 200 and r.json()["important"] is True, r.text)
            info1 = r.json()["id"]
            r = await c.post(f"{BASE}/events/{ev_id}/service-info", json={"text": "Przygotować dwa stoły pod ścianą."}, headers=admin_h)
            check("service info normal", r.status_code == 200, r.text)
            r = await c.post(f"{BASE}/events/{ev_id}/client-update", json={"text": "Będzie nas 34 osoby. Tort + 2 ciasta."}, headers=admin_h)
            check("client update saved", r.status_code == 200 and r.json()["client_update_at"], r.text)

            # staff login
            r = await c.post(f"{BASE}/auth/login", json={"email": staff_email, "password": "haslo123"})
            check("staff login works", r.status_code == 200, r.text)
            staff_h = {"Authorization": f"Bearer {r.json()['access_token']}"}

            # staff event card
            r = await c.get(f"{BASE}/staff/my/events/{ev_id}", headers=staff_h)
            check("staff card 200", r.status_code == 200, r.text)
            card = r.json()
            check("staff sees people", card.get("people") == 30)
            check("staff sees org (tables/menu/grill/allergies)", card.get("org", {}).get("tables_setup") == "4 stoły po 8 osób" and card["org"].get("allergies"))
            check("staff sees kids/adults split", card["org"].get("kids_count") == 12 and card["org"].get("adults_count") == 18)
            check("staff sees early arrival 15:30", card["org"].get("early_arrival") and card["org"].get("early_arrival_time") == "15:30")
            check("staff sees client update", "34 osoby" in (card.get("client_update_text") or ""))
            check("staff sees service infos sorted (important first)", len(card.get("service_infos", [])) == 2 and card["service_infos"][0]["important"] is True)
            check("staff sees own shift", card.get("my_shift", {}).get("time_start") == "15:00")
            leaked = [f for f in FORBIDDEN_STAFF_FIELDS if f in card]
            check("staff card leaks NOTHING financial/private", not leaked, f"leaked: {leaked}")

            # staff GET /events/{id} hardened
            r = await c.get(f"{BASE}/events/{ev_id}", headers=staff_h)
            leaked2 = [f for f in FORBIDDEN_STAFF_FIELDS if f in (r.json() if r.status_code == 200 else {})]
            check("GET /events/{id} staff-safe", r.status_code == 200 and not leaked2, f"{r.status_code} leaked: {leaked2}")

            # staff GET /events list whitelisted
            r = await c.get(f"{BASE}/events?year=2026&month=9", headers=staff_h)
            rows = r.json()
            anyleak = any(f in row for row in rows for f in FORBIDDEN_STAFF_FIELDS)
            check("GET /events list staff-safe", r.status_code == 200 and not anyleak)

            # staff comment → owner sees + alert
            r = await c.post(f"{BASE}/staff/my/events/{ev_id}/comments", json={"text": "Klient poprosił o dodatkowy stół przy wiacie."}, headers=staff_h)
            check("staff comment created", r.status_code == 200, r.text)
            r = await c.get(f"{BASE}/staff/my/events/{ev_id}", headers=staff_h)
            check("staff sees own comment", any("dodatkowy stół" in x["text"] for x in r.json().get("my_comments", [])))
            r = await c.get(f"{BASE}/events/{ev_id}/comments", headers=admin_h)
            check("owner sees comment with author", r.status_code == 200 and r.json()[0]["author_name"] == "Zuzia Testowa", r.text)
            r = await c.get(f"{BASE}/alerts", headers=admin_h)
            al = [a for a in r.json() if a.get("kind") == "staff_comment" and a.get("event_id") == ev_id]
            check("owner alert 'Nowa informacja od pracownika'", len(al) == 1 and "Nowa informacja od pracownika" in al[0]["message"])

            # staff forbidden ops
            r = await c.get(f"{BASE}/events/{ev_id}/comments", headers=staff_h)
            check("staff cannot list team comments → 403", r.status_code == 403, r.text)
            r = await c.post(f"{BASE}/events/{ev_id}/service-info", json={"text": "hack"}, headers=staff_h)
            check("staff cannot add service info → 403", r.status_code == 403, r.text)
            r = await c.post(f"{BASE}/events/{ev_id}/client-update", json={"text": "hack"}, headers=staff_h)
            check("staff cannot set client update → 403", r.status_code == 403, r.text)

            # unassigned event → staff has no access
            r2 = await c.post(f"{BASE}/events", json={"name": "Inna impreza", "date": "2026-09-20", "price_total": 999}, headers=admin_h)
            other_id = r2.json()["id"]
            r = await c.get(f"{BASE}/events/{other_id}", headers=staff_h)
            check("staff blocked from unassigned event → 403", r.status_code == 403, r.text)
            r = await c.get(f"{BASE}/staff/my/events/{other_id}", headers=staff_h)
            check("staff card unassigned → 404", r.status_code == 404, r.text)

            # AI extraction (live LLM call)
            import client_replies as cr
            extracted = await cr.extract_reply_info(
                "Dzień dobry, będzie nas 34 osoby. Przywieziemy tort i dwa ciasta. Przyjedziemy około 15:30 udekorować stoły. Pozdrawiam"
            )
            check("AI extraction returned JSON", isinstance(extracted, dict), extracted)
            if isinstance(extracted, dict):
                check("AI: people_final=34", extracted.get("people_final") == 34, extracted)
                check("AI: own_decorations/early_arrival TAK", extracted.get("early_arrival") is True and extracted.get("early_arrival_time") == "15:30", extracted)
                check("AI: summary_lines non-empty", len(extracted.get("summary_lines") or []) > 0)
            # uncertain range must NOT set people_final
            extracted2 = await cr.extract_reply_info("Witam, będzie około 30-35 osób. Pozdrawiam")
            if isinstance(extracted2, dict):
                check("AI: range 30–35 NOT guessed as number", extracted2.get("people_final") in (None, 0), extracted2)
            else:
                check("AI: range extraction returned", False, extracted2)

            # suggestion flow (simulated Gmail reply)
            ev_doc = await db.events.find_one({"id": ev_id}, {"_id": 0})
            sug = await cr.create_suggestion(
                db, owner_id, ev_doc, gmail_message_id=f"sim-{uuid.uuid4().hex[:8]}",
                thread_id="t1", from_email="klient@example.com", from_name="Jan Klient",
                client_text="Będzie nas 34 osoby. Przywieziemy tort i dwa ciasta. Przyjedziemy około 15:30.",
                extracted=extracted,
            )
            r = await c.get(f"{BASE}/events/{ev_id}/client-reply-suggestions", headers=admin_h)
            check("admin sees pending suggestion", r.status_code == 200 and len(r.json()) == 1, r.text)
            r = await c.get(f"{BASE}/alerts", headers=admin_h)
            check("alert 'Nowa odpowiedź klienta'", any(a.get("kind") == "client_reply" and a.get("event_id") == ev_id for a in r.json()))
            # staff cannot see suggestions
            r = await c.get(f"{BASE}/events/{ev_id}/client-reply-suggestions", headers=staff_h)
            check("staff cannot see suggestions → 403", r.status_code == 403)
            # approve
            r = await c.post(f"{BASE}/client-reply-suggestions/{sug['id']}/approve", json={"text": None}, headers=admin_h)
            check("approve suggestion", r.status_code == 200, r.text)
            ev_after = await db.events.find_one({"id": ev_id}, {"_id": 0})
            check("event people updated to 34", ev_after.get("people") == 34, ev_after.get("people"))
            check("event client_update_text set", bool(ev_after.get("client_update_text")))
            check("org early_arrival_time merged", ev_after.get("org", {}).get("early_arrival_time") == "15:30")
            # staff sees approved info
            r = await c.get(f"{BASE}/staff/my/events/{ev_id}", headers=staff_h)
            check("staff sees approved client update", bool(r.json().get("client_update_text")) and r.json().get("client_update_at"))
            # double approve blocked
            r = await c.post(f"{BASE}/client-reply-suggestions/{sug['id']}/approve", json={}, headers=admin_h)
            check("re-approve → 404", r.status_code == 404)
            # reject flow
            sug2 = await cr.create_suggestion(db, owner_id, ev_doc, gmail_message_id=f"sim-{uuid.uuid4().hex[:8]}",
                                              thread_id="t2", from_email="k@e.com", from_name="K",
                                              client_text="Dziękuję za wiadomość!", extracted={"has_org_info": False, "summary_lines": []})
            r = await c.post(f"{BASE}/client-reply-suggestions/{sug2['id']}/reject", headers=admin_h)
            check("reject suggestion", r.status_code == 200)
            # audit log entries
            r = await c.get(f"{BASE}/history?limit=50", headers=admin_h)
            hist = r.json()
            check("audit: client reply received", any(h.get("entity_type") == "client_reply" and h.get("action") == "create" for h in hist))
            check("audit: approval logged", any("Zatwierdzono odpowiedź klienta" in (h.get("summary") or "") for h in hist))

            await c.delete(f"{BASE}/events/{other_id}", headers=admin_h)
        finally:
            # cleanup
            await c.delete(f"{BASE}/events/{ev_id}", headers=admin_h)
            await c.delete(f"{BASE}/staff/{staff_id}/login", headers=admin_h)
            await c.delete(f"{BASE}/staff/{staff_id}", headers=admin_h)
            await db.client_reply_suggestions.delete_many({"event_id": ev_id})
            await db.event_comments.delete_many({"event_id": ev_id})
            await db.alerts.delete_many({"event_id": ev_id})

    print(f"\nRESULT: {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

asyncio.run(main())
