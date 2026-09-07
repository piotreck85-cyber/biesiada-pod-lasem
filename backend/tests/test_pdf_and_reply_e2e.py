"""E2E tests: Etap 3 PDFs + Etap 2 AI draft replies (no real e-mails sent).
Run: cd /app/backend && python tests/test_pdf_and_reply_e2e.py
"""
import asyncio
import os
import sys
import uuid

import httpx

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
ADMIN = {"email": "test@eventa.pl", "password": "test123"}
PASS, FAIL = 0, 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  ✅ {name}")
    else:
        FAIL += 1; print(f"  ❌ {name} {extra}")


async def main():
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(f"{BASE}/auth/login", json=ADMIN)
        ah = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # staff for shifts
        r = await c.post(f"{BASE}/staff", json={"name": "Żaneta Kowalczyk-Łoś", "role": "Kelnerka", "hourly_rate": 30}, headers=ah)
        staff_id = r.json()["id"]

        # rich event (Polish diacritics everywhere)
        ev_body = {
            "name": "TEST PDF — Urodzinki Małgosi (śżźćńłóęą)",
            "date": "2026-11-14", "time_start": "16:00", "time_end": "20:00",
            "people": 24, "category": "dzieci/urodzinki/tematyczne",
            "status": "potwierdzona",
            "client_name": "Małgorzata Wiśniewska", "client_email": "klient@test.pl",
            "price_total": 1500, "deposit_paid": True, "deposit_amount": 300, "deposit_date": "2026-10-01",
            "dinner_items": {"z1": 24, "d3": 24, "dd6": 24},
            "shifts": [{"staff_id": staff_id, "hours": 4, "time_start": "15:00", "time_end": "20:30", "role": "obsługa sali", "note": "dekoracje od 14:00"}],
            "org": {"tables_setup": "4 stoły po 6 osób, podkowa", "allergies": "1 dziecko bez glutenu",
                    "attractions": "alpaki 17:00, dmuchaniec", "kids_count": 16, "adults_count": 8},
        }
        r = await c.post(f"{BASE}/events", json=ev_body, headers=ah)
        assert r.status_code == 200, r.text
        ev_id = r.json()["id"]

        print("\n== 1. PDF: potwierdzenie imprezy ==")
        r = await c.get(f"{BASE}/events/{ev_id}/pdf/confirmation", headers=ah)
        check("200 + PDF magic", r.status_code == 200 and r.content[:4] == b"%PDF", str(r.status_code))
        check("content-type pdf", "application/pdf" in r.headers.get("content-type", ""))
        check("size > 2KB", len(r.content) > 2000, str(len(r.content)))
        with open("/tmp/test_confirmation.pdf", "wb") as f:
            f.write(r.content)

        print("\n== 2. PDF: karta dla obsługi ==")
        r = await c.get(f"{BASE}/events/{ev_id}/pdf/staff-card", headers=ah)
        check("200 + PDF magic", r.status_code == 200 and r.content[:4] == b"%PDF", str(r.status_code))
        with open("/tmp/test_staffcard.pdf", "wb") as f:
            f.write(r.content)
        # extract text to verify content + NO financial data
        try:
            from pypdf import PdfReader
            txt = "".join(p.extract_text() or "" for p in PdfReader("/tmp/test_staffcard.pdf").pages)
            check("Polish name rendered", "Żaneta" in txt, txt[:200])
            check("role shown", "obsługa sali" in txt)
            check("org shown", "alpaki" in txt)
            check("NO price in staff card", "1500" not in txt and "1 500" not in txt)
            check("NO deposit in staff card", "300" not in txt.replace("14:00", "").replace("20:30", ""), "")
            check("NO client email in staff card", "klient@test.pl" not in txt)
            txt2 = "".join(p.extract_text() or "" for p in PdfReader("/tmp/test_confirmation.pdf").pages)
            check("confirmation: client name", "Małgorzata" in txt2)
            check("confirmation: price", "1 500" in txt2 or "1500" in txt2)
            check("confirmation: remaining 1200", "1 200" in txt2 or "1200" in txt2)
            check("confirmation: dinner item", "Rosół" in txt2)
        except ImportError:
            print("  (pypdf not installed — skipping text checks)")

        print("\n== 3. 404 for unknown event ==")
        r = await c.get(f"{BASE}/events/nonexistent/pdf/confirmation", headers=ah)
        check("404", r.status_code == 404)

        print("\n== 4. AI draft reply ==")
        # seed a fake pending suggestion directly in DB
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import dotenv_values
        cfg = dotenv_values("/app/backend/.env")
        db = AsyncIOMotorClient(cfg["MONGO_URL"])[cfg.get("DB_NAME", "test_database")]
        me = await db.users.find_one({"email": "test@eventa.pl"})
        owner = me.get("workspace_id") or me["id"]
        sug_id = str(uuid.uuid4())
        await db.client_reply_suggestions.insert_one({
            "id": sug_id, "owner_id": owner, "event_id": ev_id,
            "event_name": ev_body["name"], "event_date": ev_body["date"],
            "gmail_message_id": f"test-{sug_id}", "thread_id": "",
            "from_email": "klient@test.pl", "from_name": "Małgorzata Wiśniewska",
            "client_text": "Dzień dobry, będzie nas jednak 26 osób. Czy możemy przyjechać 30 minut wcześniej, żeby rozłożyć dekoracje? Pozdrawiam, Małgorzata",
            "extracted": {"summary_lines": ["Liczba osób: 26", "Prośba o wcześniejszy przyjazd (30 min) na dekoracje"]},
            "summary_lines": ["Liczba osób: 26", "Prośba o wcześniejszy przyjazd (30 min) na dekoracje"],
            "status": "pending", "created_at": "2026-09-07T10:00:00+00:00",
        })
        r = await c.post(f"{BASE}/client-reply-suggestions/{sug_id}/draft-reply", headers=ah)
        ok = r.status_code == 200 and len((r.json().get("draft") or "")) > 50
        check("draft generated (AI)", ok, r.text[:300])
        if ok:
            d = r.json()
            check("subject has Re:", (d.get("subject") or "").startswith("Re:"))
            check("to_email = client", d.get("to_email") == "klient@test.pl")
            check("draft has signature", "Biesiada pod Lasem" in d["draft"])
            print("  --- DRAFT ---")
            print("  " + d["draft"][:600].replace("\n", "\n  "))
            # draft persisted on suggestion
            sug = await db.client_reply_suggestions.find_one({"id": sug_id})
            check("draft persisted", bool(sug.get("reply_draft")))

        print("\n== 5. send-reply validation (NO real send) ==")
        r = await c.post(f"{BASE}/client-reply-suggestions/{sug_id}/send-reply", json={"text": ""}, headers=ah)
        check("empty text → 400", r.status_code == 400)
        # break the recipient to ensure validation, not SMTP
        await db.client_reply_suggestions.update_one({"id": sug_id}, {"$set": {"from_email": ""}})
        await db.events.update_one({"id": ev_id}, {"$set": {"client_email": ""}})
        r = await c.post(f"{BASE}/client-reply-suggestions/{sug_id}/send-reply", json={"text": "Test", "to_email": "niepoprawny"}, headers=ah)
        check("bad email → 400", r.status_code == 400)
        r = await c.post(f"{BASE}/client-reply-suggestions/bad-id/send-reply", json={"text": "Test"}, headers=ah)
        check("unknown suggestion → 404", r.status_code == 404)

        # cleanup
        print("\n== Cleanup ==")
        await db.client_reply_suggestions.delete_one({"id": sug_id})
        await c.delete(f"{BASE}/events/{ev_id}", headers=ah)
        await c.delete(f"{BASE}/staff/{staff_id}", headers=ah)
        print("  cleaned")

    print(f"\n{'='*40}\nRESULT: {PASS} passed, {FAIL} failed\n{'='*40}")
    sys.exit(1 if FAIL else 0)


asyncio.run(main())
