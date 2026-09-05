"""E2E tests: Staff Availability (Dostępność pracowników).

Covers:
- staff declares availability (available / unavailable, all-day / hours)
- 'none' removes declaration
- validation (bad date, bad status, missing hours)
- admin team endpoints (/availability/team, /availability/for-date)
- BLOCKING: create_event / update_event with an unavailable staff → 400
- existing assignment survives a later 'unavailable' declaration (no block on unrelated update)
- date change on event re-checks ALL shifts
- partial-day: block only when windows overlap
Run: cd /app/backend && python tests/test_availability_e2e.py
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
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name} {extra}")


async def main():
    async with httpx.AsyncClient(timeout=30) as c:
        # ---- admin login ----
        r = await c.post(f"{BASE}/auth/login", json=ADMIN)
        assert r.status_code == 200, r.text
        admin_tok = r.json()["access_token"]
        ah = {"Authorization": f"Bearer {admin_tok}"}

        # ---- create test staff + login ----
        r = await c.post(f"{BASE}/staff", json={"name": "Avail Tester", "role": "Kelner", "hourly_rate": 30}, headers=ah)
        assert r.status_code == 200, r.text
        staff_id = r.json()["id"]
        staff_email = f"avail.{uuid.uuid4().hex[:8]}@test.pl"
        r = await c.post(f"{BASE}/staff/{staff_id}/login", json={"email": staff_email, "password": "avail123"}, headers=ah)
        assert r.status_code == 200, r.text
        r = await c.post(f"{BASE}/auth/login", json={"email": staff_email, "password": "avail123"})
        assert r.status_code == 200, r.text
        staff_tok = r.json()["access_token"]
        sh = {"Authorization": f"Bearer {staff_tok}"}

        D1 = "2026-10-10"  # all-day unavailable
        D2 = "2026-10-11"  # partial unavailable 16:00-22:00
        D3 = "2026-10-12"  # available

        print("\n== 1. Staff declares availability ==")
        r = await c.put(f"{BASE}/availability/my/{D1}", json={"status": "unavailable", "all_day": True, "note": "urlop"}, headers=sh)
        check("set unavailable all-day", r.status_code == 200 and r.json().get("status") == "unavailable", r.text)
        r = await c.put(f"{BASE}/availability/my/{D2}", json={"status": "unavailable", "all_day": False, "time_from": "16:00", "time_to": "22:00"}, headers=sh)
        check("set unavailable 16-22", r.status_code == 200 and r.json().get("time_from") == "16:00", r.text)
        r = await c.put(f"{BASE}/availability/my/{D3}", json={"status": "available", "all_day": True}, headers=sh)
        check("set available", r.status_code == 200 and r.json().get("status") == "available", r.text)

        r = await c.get(f"{BASE}/availability/my?date_from=2026-10-01&date_to=2026-10-31", headers=sh)
        check("GET my returns 3", r.status_code == 200 and len(r.json()) == 3, r.text)

        print("\n== 2. Validation ==")
        r = await c.put(f"{BASE}/availability/my/2026-13-99", json={"status": "available"}, headers=sh)
        check("bad date → 400", r.status_code == 400)
        r = await c.put(f"{BASE}/availability/my/{D1}", json={"status": "xxx"}, headers=sh)
        check("bad status → 400", r.status_code == 400)
        r = await c.put(f"{BASE}/availability/my/{D1}", json={"status": "unavailable", "all_day": False, "time_from": "zz", "time_to": ""}, headers=sh)
        check("missing hours → 400", r.status_code == 400)
        r = await c.put(f"{BASE}/availability/my/{D1}", json={"status": "available"}, headers=ah)
        check("admin (no staff profile) → 403", r.status_code == 403)

        print("\n== 3. Admin team endpoints ==")
        r = await c.get(f"{BASE}/availability/team?date_from=2026-10-01&date_to=2026-10-31", headers=ah)
        ok = r.status_code == 200 and any(x.get("staff_name") == "Avail Tester" for x in r.json())
        check("team list enriched with name", ok, r.text[:200])
        r = await c.get(f"{BASE}/availability/for-date?date={D1}", headers=ah)
        check("for-date map has staff", r.status_code == 200 and staff_id in r.json(), r.text[:200])
        r = await c.get(f"{BASE}/availability/team", headers=sh)
        check("staff blocked from team endpoint → 403", r.status_code == 403)

        print("\n== 4. BLOCKING: create event with unavailable staff ==")
        ev_body = {"name": "TEST avail block", "date": D1, "shifts": [{"staff_id": staff_id, "hours": 4}]}
        r = await c.post(f"{BASE}/events", json=ev_body, headers=ah)
        check("create on all-day unavailable → 400", r.status_code == 400 and "brak dostępności" in r.text, r.text[:200])

        # partial overlap: shift 18:00-23:00 vs unavailable 16:00-22:00
        ev_body = {"name": "TEST avail partial", "date": D2, "shifts": [{"staff_id": staff_id, "hours": 5, "time_start": "18:00", "time_end": "23:00"}]}
        r = await c.post(f"{BASE}/events", json=ev_body, headers=ah)
        check("create with overlapping partial → 400", r.status_code == 400, r.text[:200])

        # partial NO overlap: shift 08:00-14:00
        ev_body = {"name": "TEST avail morning", "date": D2, "time_start": "08:00", "time_end": "14:00",
                   "shifts": [{"staff_id": staff_id, "hours": 6, "time_start": "08:00", "time_end": "14:00"}]}
        r = await c.post(f"{BASE}/events", json=ev_body, headers=ah)
        check("create outside unavailable hours → OK", r.status_code == 200, r.text[:200])
        ev_morning = r.json()["id"] if r.status_code == 200 else None

        # available day → OK
        ev_body = {"name": "TEST avail ok", "date": D3, "shifts": [{"staff_id": staff_id, "hours": 4}]}
        r = await c.post(f"{BASE}/events", json=ev_body, headers=ah)
        check("create on available day → OK", r.status_code == 200, r.text[:200])
        ev_ok = r.json()["id"] if r.status_code == 200 else None

        print("\n== 5. Existing assignment survives later 'unavailable' ==")
        # staff flips D3 to unavailable AFTER being assigned
        r = await c.put(f"{BASE}/availability/my/{D3}", json={"status": "unavailable", "all_day": True}, headers=sh)
        check("staff can change declaration anytime", r.status_code == 200)
        # admin edits the event (same staff already assigned) → must NOT be blocked
        r = await c.get(f"{BASE}/events/{ev_ok}", headers=ah)
        ev = r.json()
        upd = {"name": ev["name"] + " (edytowana)", "date": ev["date"], "shifts": ev.get("shifts") or []}
        r = await c.put(f"{BASE}/events/{ev_ok}", json=upd, headers=ah)
        check("update with EXISTING assignment not blocked", r.status_code == 200, r.text[:200])

        print("\n== 6. Adding NEW staff on update is blocked ==")
        # second staff, unavailable same day
        r = await c.post(f"{BASE}/staff", json={"name": "Avail Tester 2", "hourly_rate": 25}, headers=ah)
        staff2 = r.json()["id"]
        s2_email = f"avail2.{uuid.uuid4().hex[:8]}@test.pl"
        await c.post(f"{BASE}/staff/{staff2}/login", json={"email": s2_email, "password": "avail123"}, headers=ah)
        r = await c.post(f"{BASE}/auth/login", json={"email": s2_email, "password": "avail123"})
        s2h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        await c.put(f"{BASE}/availability/my/{D3}", json={"status": "unavailable", "all_day": True}, headers=s2h)

        upd["shifts"] = (upd.get("shifts") or []) + [{"staff_id": staff2, "hours": 4}]
        r = await c.put(f"{BASE}/events/{ev_ok}", json=upd, headers=ah)
        check("adding NEW unavailable staff → 400", r.status_code == 400 and "Avail Tester 2" in r.text, r.text[:200])

        print("\n== 7. Date change re-checks all shifts ==")
        # move morning event (staff has partial 16-22 on D2) to D3 (staff now all-day unavailable there)
        r = await c.get(f"{BASE}/events/{ev_morning}", headers=ah)
        evm = r.json()
        upd2 = {"name": evm["name"], "date": D3, "shifts": evm.get("shifts") or []}
        r = await c.put(f"{BASE}/events/{ev_morning}", json=upd2, headers=ah)
        check("date change onto unavailable day → 400", r.status_code == 400, r.text[:200])

        print("\n== 8. 'none' removes declaration ==")
        r = await c.put(f"{BASE}/availability/my/{D3}", json={"status": "none"}, headers=sh)
        check("delete declaration", r.status_code == 200 and r.json().get("status") == "none")
        r = await c.get(f"{BASE}/availability/for-date?date={D3}", headers=ah)
        check("for-date no longer has staff1", staff_id not in r.json())
        # now the date change from step 7 should succeed
        r = await c.put(f"{BASE}/events/{ev_morning}", json=upd2, headers=ah)
        check("date change after removal → OK", r.status_code == 200, r.text[:200])

        # ---- cleanup ----
        print("\n== Cleanup ==")
        for eid in [ev_morning, ev_ok]:
            if eid:
                await c.delete(f"{BASE}/events/{eid}", headers=ah)
        await c.delete(f"{BASE}/staff/{staff_id}", headers=ah)
        await c.delete(f"{BASE}/staff/{staff2}", headers=ah)
        print("  cleaned events + staff")

    print(f"\n{'='*40}\nRESULT: {PASS} passed, {FAIL} failed\n{'='*40}")
    sys.exit(1 if FAIL else 0)


asyncio.run(main())
