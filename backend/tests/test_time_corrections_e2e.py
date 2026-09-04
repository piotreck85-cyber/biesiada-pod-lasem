"""E2E tests — work time module with two-sided corrections (spec section 13).
Runs on the test workspace (test@eventa.pl); cleans up after itself."""
import asyncio, os, sys, uuid
from datetime import datetime, timedelta, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = "http://localhost:8001/api"
ok = fail = 0

def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name} {str(extra)[:250]}")

def iso(dt): return dt.isoformat()

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "eventa_db")]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{BASE}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        admin_h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # two staff members with logins
        sids, tokens = [], []
        for nm in ["Zuzia TC", "Patrycja TC"]:
            r = await c.post(f"{BASE}/staff", json={"name": nm, "role": "Kelnerka", "hourly_rate": 30}, headers=admin_h)
            sid = r.json()["id"]; sids.append(sid)
            em = f"tc-{uuid.uuid4().hex[:6]}@example.com"
            await c.post(f"{BASE}/staff/{sid}/login", json={"email": em, "password": "haslo123"}, headers=admin_h)
            r = await c.post(f"{BASE}/auth/login", json={"email": em, "password": "haslo123"})
            tokens.append({"Authorization": f"Bearer {r.json()['access_token']}"})
        s1, s2 = sids
        h1, h2 = tokens

        # (10) planned hours independent from event hours
        r = await c.post(f"{BASE}/events", json={
            "name": "TC Urodzinki", "date": today, "time_start": "11:00", "time_end": "14:00",
            "status": "potwierdzona",
            "shifts": [{"staff_id": s1, "hours": 6, "time_start": "09:00", "time_end": "15:00",
                        "role": "przygotowanie / obsługa", "note": "dekoracje od 9"}],
        }, headers=admin_h)
        ev_id = r.json()["id"]
        r = await c.get(f"{BASE}/staff/my/events/{ev_id}", headers=h1)
        card = r.json()
        check("10. plan 09:00–15:00 ≠ impreza 11:00–14:00",
              card["my_shift"]["time_start"] == "09:00" and card["my_shift"]["time_end"] == "15:00"
              and card["time_start"] == "11:00", card.get("my_shift"))
        check("10b. rola i notatka na zmianie", card["my_shift"].get("role") == "przygotowanie / obsługa" and card["my_shift"].get("note") == "dekoracje od 9")

        # (11) historic legacy entry still works
        legacy_id = str(uuid.uuid4())
        await db.time_entries.insert_one({
            "id": legacy_id, "owner_id": card and (await db.staff.find_one({"id": s1}))["owner_id"],
            "staff_id": s1, "user_id": "legacy", "event_id": None,
            "start_at": iso(now - timedelta(days=30)), "end_at": iso(now - timedelta(days=30) + timedelta(hours=4)),
            "manual": False, "hours": 4.0, "note": "", "paid": False,
        })
        r = await c.get(f"{BASE}/time-entries/my", headers=h1)
        check("11. stary wpis (bez nowych pól) widoczny", any(e["id"] == legacy_id for e in r.json()), r.text[:100])

        # (1) normal start/stop
        r = await c.post(f"{BASE}/time-entries/start", json={"event_id": ev_id}, headers=h1)
        e1 = r.json()
        check("1. START działa", r.status_code == 200 and e1.get("end_at") is None)
        r = await c.post(f"{BASE}/time-entries/stop", json={}, headers=h1)
        e1 = r.json()
        check("1b. STOP zamyka wpis z godzinami", e1.get("end_at") and e1.get("hours") >= 0)

        # (2) forgot START → employee correction, pending manager
        prop_start = iso(now - timedelta(hours=3))
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e1["id"], "corr_type": "edit", "proposed_start": prop_start,
            "reason": "Zapomniałam włączyć czas pracy"}, headers=h1)
        corr1 = r.json()
        check("2. wniosek pracownika → PENDING_MANAGER", r.status_code == 200 and corr1["status"] == "PENDING_MANAGER"
              and corr1["employee_approved"] and not corr1["manager_approved"], r.text)
        entry_db = await db.time_entries.find_one({"id": e1["id"]}, {"_id": 0})
        check("2b. wpis NIE zmieniony przed akceptacją", entry_db["start_at"] == e1["start_at"] and entry_db.get("pending_correction_id") == corr1["id"])
        # duplicate pending blocked
        r = await c.post(f"{BASE}/time-corrections", json={"entry_id": e1["id"], "corr_type": "edit",
                                                           "proposed_start": prop_start, "reason": "x"}, headers=h1)
        check("2c. druga korekta tego wpisu → 409", r.status_code == 409)

        # (6) staff cannot approve manager side (own request)
        r = await c.post(f"{BASE}/time-corrections/{corr1['id']}/approve", headers=h1)
        check("6. pracownik nie zatwierdzi za szefa → 403", r.status_code == 403, r.text)
        # (7) manager approves → applied
        r = await c.post(f"{BASE}/time-corrections/{corr1['id']}/approve", headers=admin_h)
        check("7. po 2 akceptacjach APPROVED", r.status_code == 200 and r.json()["status"] == "APPROVED", r.text)
        entry_db = await db.time_entries.find_one({"id": e1["id"]}, {"_id": 0})
        check("7b. wpis zaktualizowany + oryginał zachowany",
              entry_db["start_at"] == prop_start and entry_db.get("original_start_at") == e1["start_at"]
              and entry_db.get("corrected") is True and entry_db.get("pending_correction_id") is None)
        check("7c. historia audytu w korekcie", len((await db.time_corrections.find_one({"id": corr1["id"]}))["history"]) >= 2)

        # (3) forgot STOP — open entry, employee proposes end
        r = await c.post(f"{BASE}/time-entries/start", json={}, headers=h1)
        e2 = r.json()
        prop_end = iso(now + timedelta(minutes=5))
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e2["id"], "corr_type": "edit", "proposed_end": prop_end,
            "reason": "Zapomniałam wyłączyć czasu pracy"}, headers=h1)
        corr2 = r.json()
        check("3. korekta STOP → PENDING_MANAGER", r.status_code == 200 and corr2["status"] == "PENDING_MANAGER", r.text)
        r = await c.post(f"{BASE}/time-corrections/{corr2['id']}/approve", headers=admin_h)
        entry_db = await db.time_entries.find_one({"id": e2["id"]}, {"_id": 0})
        check("3b. po akceptacji wpis zamknięty proponowanym STOP", entry_db.get("end_at") == prop_end and entry_db.get("hours", 0) > 0)

        # (4) owner proposes change → PENDING_EMPLOYEE
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e1["id"], "corr_type": "edit",
            "proposed_start": iso(now - timedelta(hours=2, minutes=30)),
            "reason": "korekta po uzgodnieniu", "staff_id": s1}, headers=admin_h)
        corr3 = r.json()
        check("4. wniosek szefa → PENDING_EMPLOYEE", r.status_code == 200 and corr3["status"] == "PENDING_EMPLOYEE"
              and corr3["manager_approved"] and not corr3["employee_approved"], r.text)
        # (5) owner cannot approve for employee
        r = await c.post(f"{BASE}/time-corrections/{corr3['id']}/approve", headers=admin_h)
        check("5. szef nie zatwierdzi za pracownika → 403", r.status_code == 403, r.text)
        # other staff cannot approve someone else's correction
        r = await c.post(f"{BASE}/time-corrections/{corr3['id']}/approve", headers=h2)
        check("5b. inny pracownik nie zatwierdzi → 403", r.status_code == 403, r.text)
        # employee approves → applied
        r = await c.post(f"{BASE}/time-corrections/{corr3['id']}/approve", headers=h1)
        check("4b. pracownik zatwierdza → APPROVED", r.status_code == 200 and r.json()["status"] == "APPROVED", r.text)

        # (8) rejection keeps previous time
        entry_before = await db.time_entries.find_one({"id": e1["id"]}, {"_id": 0})
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e1["id"], "corr_type": "edit",
            "proposed_start": iso(now - timedelta(hours=8)), "reason": "test odrzucenia"}, headers=h1)
        corr4 = r.json()
        r = await c.post(f"{BASE}/time-corrections/{corr4['id']}/reject", headers=admin_h)
        entry_after = await db.time_entries.find_one({"id": e1["id"]}, {"_id": 0})
        check("8. odrzucenie → czas bez zmian + flaga wyczyszczona",
              r.status_code == 200 and entry_after["start_at"] == entry_before["start_at"]
              and entry_after.get("pending_correction_id") is None)

        # (9) isolation between staff
        r = await c.get(f"{BASE}/time-corrections", headers=h2)
        check("9. inny pracownik nie widzi cudzych korekt", all(x["staff_id"] == s2 for x in r.json()))
        r = await c.get(f"{BASE}/time-entries/my", headers=h2)
        check("9b. inny pracownik nie widzi cudzych wpisów", all(x["staff_id"] == s2 for x in r.json()))
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e1["id"], "corr_type": "edit", "proposed_start": iso(now), "reason": "hack", "staff_id": s1}, headers=h2)
        check("9c. pracownik nie skoryguje cudzego czasu → 403", r.status_code == 403, r.text)

        # unilateral changes blocked on backend
        r = await c.patch(f"{BASE}/time-entries/{e1['id']}", json={"start_at": iso(now)}, headers=admin_h)
        check("11a. PATCH godzin przez szefa → 409 (wymuszone na backendzie)", r.status_code == 409, r.text)
        r = await c.delete(f"{BASE}/time-entries/{e1['id']}", headers=admin_h)
        check("11b. DELETE zamkniętego wpisu → 409", r.status_code == 409, r.text)

        # add-type correction (manual whole entry) + payroll behavior
        r = await c.post(f"{BASE}/time-corrections", json={
            "corr_type": "add", "proposed_start": iso(now - timedelta(days=1, hours=6)),
            "proposed_end": iso(now - timedelta(days=1)), "reason": "zapomniany cały dzień"}, headers=h1)
        corr5 = r.json()
        check("add: wniosek o cały wpis → PENDING_MANAGER", r.status_code == 200 and corr5["status"] == "PENDING_MANAGER", r.text)
        r = await c.get(f"{BASE}/payroll/summary?unpaid_only=false", headers=admin_h)
        row = next((x for x in r.json()["staff"] if x["staff_id"] == s1), {})
        hours_before_add = row.get("hours", 0)
        check("12. oczekująca korekta NIE zmienia wypłaty + flaga pending", row.get("pending_corrections", 0) >= 1, row)
        await c.post(f"{BASE}/time-corrections/{corr5['id']}/approve", headers=admin_h)
        r = await c.get(f"{BASE}/payroll/summary?unpaid_only=false", headers=admin_h)
        row2 = next((x for x in r.json()["staff"] if x["staff_id"] == s1), {})
        check("12b. po akceptacji wypłata rośnie o 6h", abs(row2.get("hours", 0) - hours_before_add - 6.0) < 0.01, (hours_before_add, row2.get("hours")))

        # delete-type correction excludes entry from payroll
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": legacy_id, "corr_type": "delete", "reason": "wpis testowy do usunięcia"}, headers=h1)
        corr6 = r.json()
        await c.post(f"{BASE}/time-corrections/{corr6['id']}/approve", headers=admin_h)
        r = await c.get(f"{BASE}/payroll/summary?unpaid_only=false", headers=admin_h)
        row3 = next((x for x in r.json()["staff"] if x["staff_id"] == s1), {})
        check("delete: wpis wykluczony z wypłat (-4h)", abs(row3.get("hours", 0) - (row2.get("hours", 0) - 4.0)) < 0.01, (row2.get("hours"), row3.get("hours")))
        r = await c.get(f"{BASE}/time-entries/my", headers=h1)
        check("delete: wpis zniknął z historii (soft delete)", all(x["id"] != legacy_id for x in r.json()))

        # cancel by requester
        r = await c.post(f"{BASE}/time-corrections", json={
            "entry_id": e2["id"], "corr_type": "edit", "proposed_end": iso(now + timedelta(hours=1)), "reason": "do wycofania"}, headers=h1)
        corr7 = r.json()
        r = await c.post(f"{BASE}/time-corrections/{corr7['id']}/cancel", headers=h1)
        check("cancel: zgłaszający wycofuje wniosek", r.status_code == 200 and r.json()["status"] == "CANCELLED")

        # team view for admin
        r = await c.get(f"{BASE}/time/team?date={today}", headers=admin_h)
        team = r.json()
        trow = next((x for x in team["rows"] if x["staff_id"] == s1), None)
        check("9d. widok „Czas pracy zespołu” — plan+faktyczny+diff",
              bool(trow) and trow["planned"] and trow["planned"][0]["time_start"] == "09:00"
              and trow["actual_hours"] > 0, trow)
        r = await c.get(f"{BASE}/time/team", headers=h1)
        check("9e. pracownik nie ma dostępu do widoku zespołu → 403", r.status_code == 403)

        # cleanup
        await c.delete(f"{BASE}/events/{ev_id}", headers=admin_h)
        for sid in sids:
            await c.delete(f"{BASE}/staff/{sid}/login", headers=admin_h)
            await c.delete(f"{BASE}/staff/{sid}", headers=admin_h)
        await db.time_entries.delete_many({"staff_id": {"$in": sids}})
        await db.time_corrections.delete_many({"staff_id": {"$in": sids}})

    print(f"\nRESULT: {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

asyncio.run(main())
