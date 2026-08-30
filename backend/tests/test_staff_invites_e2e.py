"""E2E sanity test for the staff invitation system.

- Uses test@eventa.pl account (from /app/memory/test_credentials.md).
- Real SMTP send goes ONLY to the owner's own inbox (plus-addressing).
- Activation flow is tested with a DB-injected token (no email needed).
Cleans up all artifacts afterwards.
"""
import asyncio, os, sys, uuid
from datetime import datetime, timedelta, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
import staff_invites as inv_mod  # noqa: E402

BASE = "http://localhost:8001/api"
OWNER_INBOX_PLUS = "biesiadapodlasem+invite-test@gmail.com"

ok = 0
fail = 0

def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  ✅ {name}")
    else: fail += 1; print(f"  ❌ {name} {extra}")

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "eventa_db")]
    async with httpx.AsyncClient(timeout=60) as c:
        # login
        r = await c.post(f"{BASE}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
        check("login", r.status_code == 200, r.text)
        tok = r.json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}

        # create staff
        r = await c.post(f"{BASE}/staff", json={"name": "Test Zaproszenie", "role": "Kelner", "hourly_rate": 30}, headers=h)
        check("create staff", r.status_code == 200, r.text)
        staff_id = r.json()["id"]

        try:
            # 1. GET invite → none
            r = await c.get(f"{BASE}/staff/{staff_id}/invite", headers=h)
            check("GET invite (none)", r.status_code == 200 and r.json()["invitation"] is None, r.text)

            # 2. POST invite → sends real email to owner's own inbox
            r = await c.post(f"{BASE}/staff/{staff_id}/invite", json={"email": OWNER_INBOX_PLUS}, headers=h)
            check("POST invite (send email)", r.status_code == 200 and r.json()["invitation"]["status"] == "pending", r.text)

            # 3. duplicate invite blocked
            r = await c.post(f"{BASE}/staff/{staff_id}/invite", json={"email": OWNER_INBOX_PLUS}, headers=h)
            check("duplicate invite → 409", r.status_code == 409, r.text)

            # 4. resend regenerates token
            old = await db.staff_invitations.find_one({"staff_id": staff_id})
            r = await c.post(f"{BASE}/staff/{staff_id}/invite/resend", headers=h)
            new = await db.staff_invitations.find_one({"staff_id": staff_id})
            check("resend → new token", r.status_code == 200 and old["token_hash"] != new["token_hash"], r.text)

            # 5. cancel
            r = await c.delete(f"{BASE}/staff/{staff_id}/invite", headers=h)
            check("cancel → cancelled", r.status_code == 200 and r.json()["invitation"]["status"] == "cancelled", r.text)
            # cancelled token page = cancelled state? (we don't know raw token of real invite; skip page check here)

            # 6. Activation flow with DB-injected token
            raw = inv_mod.new_token()
            test_email = f"invite-e2e-{uuid.uuid4().hex[:6]}@example.com"
            now = datetime.now(timezone.utc)
            owner_id = (await db.users.find_one({"email": "test@eventa.pl"}))["id"]
            await db.staff_invitations.insert_one({
                "id": str(uuid.uuid4()), "staff_id": staff_id, "owner_id": owner_id,
                "email": test_email, "name": "Test Zaproszenie",
                "permissions": {"schedule": True, "attendance": True, "checklist": True, "shopping": False, "stock": False},
                "token_hash": inv_mod.hash_token(raw), "status": "pending",
                "invited_by": owner_id, "invited_at": now.isoformat(),
                "expires_at": (now + timedelta(days=7)).isoformat(),
            })
            r = await c.get(f"{BASE}/invitations/{raw}/activate")
            check("GET activation page (form)", r.status_code == 200 and "Ustaw swoje hasło" in r.text and test_email in r.text)

            r = await c.post(f"{BASE}/invitations/{raw}/activate", json={"password": "123"})
            check("activate short password → 400", r.status_code == 400, r.text)

            r = await c.post(f"{BASE}/invitations/{raw}/activate", json={"password": "haslo123"})
            check("activate → ok", r.status_code == 200 and r.json().get("email") == test_email, r.text)

            u = await db.users.find_one({"email": test_email})
            check("user created role=staff", bool(u) and u["role"] == "staff" and u["staff_id"] == staff_id and u["workspace_id"] == owner_id)
            check("permissions snapshot applied", bool(u) and u["permissions"].get("shopping") is False)
            st = await db.staff.find_one({"id": staff_id})
            check("staff linked login_email", st.get("login_email") == test_email)

            # 7. new user can log in with own password
            r = await c.post(f"{BASE}/auth/login", json={"email": test_email, "password": "haslo123"})
            check("invited user login works", r.status_code == 200 and r.json()["user"]["role"] == "staff", r.text)

            # 8. token single-use
            r = await c.post(f"{BASE}/invitations/{raw}/activate", json={"password": "haslo123"})
            check("token reuse → 409", r.status_code == 409, r.text)
            r = await c.get(f"{BASE}/invitations/{raw}/activate")
            check("used token page", r.status_code == 200 and "zostało już aktywowane" in r.text)

            # 9. expired token
            raw2 = inv_mod.new_token()
            await db.staff_invitations.insert_one({
                "id": str(uuid.uuid4()), "staff_id": staff_id, "owner_id": owner_id,
                "email": "expired@example.com", "name": "X", "permissions": {},
                "token_hash": inv_mod.hash_token(raw2), "status": "pending",
                "invited_by": owner_id, "invited_at": (now - timedelta(days=9)).isoformat(),
                "expires_at": (now - timedelta(days=2)).isoformat(),
            })
            r = await c.get(f"{BASE}/invitations/{raw2}/activate")
            check("expired token page", r.status_code == 200 and "wygasło" in r.text)
            r = await c.post(f"{BASE}/invitations/{raw2}/activate", json={"password": "haslo123"})
            check("expired activate → 410", r.status_code == 410, r.text)

            # 10. invalid token
            r = await c.get(f"{BASE}/invitations/not-a-real-token/activate")
            check("invalid token page", r.status_code == 200 and "nieważne" in r.text)

            # 11. invite blocked when staff already has account
            r = await c.post(f"{BASE}/staff/{staff_id}/invite", json={"email": "other@example.com"}, headers=h)
            check("invite with active account → 409", r.status_code == 409, r.text)

            # 12. staff user cannot invite (no admin)
            r2 = await c.post(f"{BASE}/auth/login", json={"email": test_email, "password": "haslo123"})
            staff_tok = r2.json()["access_token"]
            r = await c.post(f"{BASE}/staff/{staff_id}/invite", json={"email": "x@example.com"},
                             headers={"Authorization": f"Bearer {staff_tok}"})
            check("staff role invite → 403", r.status_code == 403, r.text)
        finally:
            # cleanup
            await db.staff_invitations.delete_many({"staff_id": staff_id})
            await db.users.delete_many({"email": {"$regex": "^invite-e2e-"}})
            await c.delete(f"{BASE}/staff/{staff_id}", headers=h)

    print(f"\nRESULT: {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

asyncio.run(main())
