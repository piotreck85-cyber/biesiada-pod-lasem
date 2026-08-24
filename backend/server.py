from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import PlainTextResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, uuid, io, csv, logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
ACCESS_MINUTES = 60 * 24 * 7  # 7 days for simplicity

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Eventa API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

# ---------- Temporary backup download (Preview only) ----------
import secrets as _secrets, json as _json
from fastapi.responses import FileResponse

_BACKUP_TOKENS_FILE = "/app/backend/backups/.download_tokens.json"

def _load_backup_tokens() -> dict:
    try:
        with open(_BACKUP_TOKENS_FILE) as f:
            return _json.load(f)
    except Exception:
        return {}

@app.get("/api/admin/backup-download/{token}/{filename}")
async def admin_backup_download_v2(token: str, filename: str):
    """Backup ZIP download via path params (avoids query-string mangling)."""
    tokens = _load_backup_tokens()
    stored = tokens.get(token)
    if not stored or stored != filename:
        raise HTTPException(404, "Invalid or expired backup token")
    import re
    if not re.match(r"^backup_\d{8}_\d{6}\.zip$", filename):
        raise HTTPException(404)
    path = f"/app/backend/backups/{filename}"
    if not os.path.exists(path):
        raise HTTPException(404, "Backup file missing")
    return FileResponse(path, filename=filename, media_type="application/zip")

@app.get("/api/admin/backup-download")
async def admin_backup_download(token: str, filename: str):
    """Legacy query-string variant (kept for compatibility)."""
    return await admin_backup_download_v2(token, filename)

# ---------- Google Calendar sync helpers ----------
import google_calendar as gcal
from fastapi.responses import HTMLResponse

# ---------- Static recipes / ingredient breakdown ----------
from recipes import RECIPES as DEFAULT_RECIPES, FIXED_PER_EVENT, merge_recipes, RECIPE_LABELS

# ---------- AI (OpenAI GPT via Emergent LLM Key) ----------
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
    _AI_AVAILABLE = True
except Exception as _ai_err:
    _AI_AVAILABLE = False
    logging.warning(f"emergentintegrations not available: {_ai_err}")


async def _get_gcal_conn(user_id: str) -> Optional[dict]:
    """Return the google connection doc for a user (or None)."""
    doc = await db.google_calendar_connections.find_one({"user_id": user_id}, {"_id": 0})
    if not doc or not doc.get("refresh_token_encrypted"):
        return None
    if doc.get("revoked_at"):
        return None
    return doc


async def _get_access_token(user_id: str) -> Optional[str]:
    """Return a fresh access token for the user or None if not connected/revoked."""
    conn = await _get_gcal_conn(user_id)
    if not conn:
        return None
    try:
        rt = gcal.decrypt_token(conn["refresh_token_encrypted"])
    except Exception as e:
        logging.getLogger("gcal").warning(f"decrypt failed for user {user_id}: {e}")
        return None
    at = await gcal.refresh_access_token(rt)
    if not at:
        # Mark revoked so we don't hammer
        await db.google_calendar_connections.update_one(
            {"user_id": user_id},
            {"$set": {"revoked_at": gcal.now_iso()}},
        )
        return None
    return at


async def _sync_event_to_google(user_id: str, event_id: str, operation: str) -> None:
    """Best-effort mirror of a Mongo event into the user's dedicated Google Calendar."""
    if not gcal.is_configured():
        return
    conn = await _get_gcal_conn(user_id)
    if not conn:
        return  # user not connected — silently skip
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    calendar_id = conn.get("calendar_id")
    if not calendar_id:
        return
    at = await _get_access_token(user_id)
    if not at:
        return

    google_event_id = (ev or {}).get("google_event_ids", {}).get(user_id) if ev else None

    log = logging.getLogger("gcal")
    try:
        if operation == "delete":
            if google_event_id:
                await gcal.delete_event(at, calendar_id, google_event_id)
            return
        if not ev:
            return
        if operation == "create" or (operation in ("update", "upsert") and not google_event_id):
            created = await gcal.create_event(at, calendar_id, ev)
            gid = created.get("id")
            if gid:
                await db.events.update_one(
                    {"id": event_id},
                    {"$set": {f"google_event_ids.{user_id}": gid,
                              f"google_last_sync.{user_id}": gcal.now_iso()}},
                )
            return
        if operation == "update":
            await gcal.update_event(at, calendar_id, google_event_id, ev)
            await db.events.update_one(
                {"id": event_id},
                {"$set": {f"google_last_sync.{user_id}": gcal.now_iso()}},
            )
            return
    except Exception as e:
        log.warning(f"sync {operation} event={event_id} user={user_id} failed: {e}")


async def _sync_event_for_workspace(owner_id: str, event_id: str, operation: str) -> None:
    """Mirror the operation for every user in the workspace that has connected Google."""
    if not gcal.is_configured():
        return
    # Find every user with a google connection in the workspace
    users_in_ws = await db.users.find(
        {"$or": [{"id": owner_id}, {"workspace_id": owner_id}]},
        {"_id": 0, "id": 1},
    ).to_list(50)
    for u in users_in_ws:
        uid = u.get("id")
        if not uid: continue
        try:
            await _sync_event_to_google(uid, event_id, operation)
        except Exception as e:
            logging.getLogger("gcal").info(f"sync skipped for {uid}: {e}")


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class TokenOut(BaseModel):
    access_token: str
    user: dict

class StaffIn(BaseModel):
    name: str
    role: Optional[str] = ""        # STANOWISKO (np. Kelner, Kucharz) — bez zmian
    hourly_rate: float = 0.0
    staff_type: Optional[str] = "employee"   # NOWE (Faza 4A): "employee" | "partner"

class StaffPatch(BaseModel):
    # Dla PUT/PATCH — wszystkie pola opcjonalne, żeby móc zmienić np. tylko staff_type
    name: Optional[str] = None
    role: Optional[str] = None
    hourly_rate: Optional[float] = None
    staff_type: Optional[str] = None

class CostItem(BaseModel):
    label: str
    amount: float

class StaffShift(BaseModel):
    staff_id: str
    hours: float = 0.0
    time_start: Optional[str] = ""  # HH:MM
    time_end: Optional[str] = ""    # HH:MM

class EventIn(BaseModel):
    model_config = {"extra": "allow"}  # accept optional custom fields (dinner_items, extras_qty, discount_pct, ...)
    name: str
    date: str  # ISO YYYY-MM-DD
    time: Optional[str] = ""
    time_start: Optional[str] = ""
    time_end: Optional[str] = ""
    venue: Optional[str] = ""
    notes: Optional[str] = ""
    category: Optional[str] = ""
    people: Optional[int] = 0
    package_set: Optional[str] = ""   # for adult events: set1|set2|set3
    extras_qty: Optional[Dict[str, float]] = None  # extra_id -> qty (or amount for 'kwota' unit)
    revenue: float = 0.0              # gross for firmowe
    revenue_net: Optional[float] = 0.0
    costs: List[CostItem] = []
    shifts: List[StaffShift] = []
    image_url: Optional[str] = ""
    # ---- Status ----
    status: Optional[str] = ""        # wstepne | rezerwacja | potwierdzona | zakonczona | anulowana
    valid_until: Optional[str] = ""   # YYYY-MM-DD — for "wstepne zapytanie"
    # ---- Client ----
    client_name: Optional[str] = ""
    client_phone: Optional[str] = ""
    client_email: Optional[str] = ""
    client_notes: Optional[str] = ""
    # ---- Payment ----
    price_total: Optional[float] = 0.0
    discount_pct: Optional[float] = 0.0
    price_after_discount: Optional[float] = 0.0
    deposit_paid: Optional[bool] = False
    deposit_amount: Optional[float] = 0.0
    deposit_date: Optional[str] = ""
    # ---- Dinner offer ----
    dinner_items: Optional[Dict[str, float]] = None   # dinner_item_id -> qty
    dinner_cost: Optional[float] = 0.0
    dinner_revenue: Optional[float] = 0.0
    dinner_profit: Optional[float] = 0.0
    dinner_margin_pct: Optional[float] = 0.0

class TemplateIn(BaseModel):
    name: str
    venue: Optional[str] = ""
    notes: Optional[str] = ""
    category: Optional[str] = ""
    people: Optional[int] = 0
    time_start: Optional[str] = ""
    time_end: Optional[str] = ""
    revenue: float = 0.0
    costs: List[CostItem] = []
    shifts: List[StaffShift] = []
    image_url: Optional[str] = ""

class ExpenseIn(BaseModel):
    label: str
    amount: float
    date: str  # YYYY-MM-DD
    category: Optional[str] = ""
    notes: Optional[str] = ""

class SendOfferIn(BaseModel):
    to_email: EmailStr
    client_name: Optional[str] = ""
    event_date: Optional[str] = ""       # YYYY-MM-DD
    people_count: Optional[int] = None
    package_set_id: Optional[str] = None # set1 | set2 | set3
    extras: Optional[List[dict]] = None  # [{id, qty?, amount?}]
    custom_note: Optional[str] = ""
    custom_greeting: Optional[str] = ""  # override default "Dzień dobry {who}"
    custom_subject: Optional[str] = ""   # override default subject
    event_id: Optional[str] = None       # optional link to event
    event_type: Optional[str] = None     # okolicznosciowe | firmowe | urodziny | warsztaty
    attachments_mode: Optional[str] = "both"  # For adult events: grill | dinner | both

# ---------- Helpers ----------
def now_utc():
    return datetime.now(timezone.utc)

def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": now_utc(),
        "exp": now_utc() + timedelta(minutes=ACCESS_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    if not cred:
        raise HTTPException(401, "Brak tokenu")
    token = cred.credentials

    # 1) Try JWT (existing email/password auth)
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if user:
            if not user.get("workspace_id"):
                user["workspace_id"] = user["id"]
            return user
    except jwt.PyJWTError:
        pass  # fall through to session_token check

    # 2) Try Emergent Google Auth session_token (opaque)
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if session:
        exp = session.get("expires_at")
        # MongoDB may return naive datetimes — make timezone-aware for safe comparison
        if isinstance(exp, datetime) and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp and exp > now_utc():
            user = await db.users.find_one({"id": session["user_id"]}, {"_id": 0, "password_hash": 0})
            if user:
                if not user.get("workspace_id"):
                    user["workspace_id"] = user["id"]
                return user

    raise HTTPException(401, "Nieprawidłowy token")

def ws(user: dict) -> str:
    """Workspace id used to scope all data queries."""
    return user.get("workspace_id") or user["id"]


def is_staff(user: dict) -> bool:
    """True if the logged-in user is a staff member (limited access)."""
    return (user or {}).get("role") == "staff"


def is_admin(user: dict) -> bool:
    """True if the logged-in user is admin/owner (default)."""
    return not is_staff(user)


def require_admin(user=Depends(current_user)):
    """Dependency: raises 403 if the caller is not an admin."""
    if is_staff(user):
        raise HTTPException(403, "Ta operacja jest dostępna tylko dla administratora")
    return user

async def log_change(user: dict, action: str, entity_type: str, entity_id: str, summary: str = ""):
    """Append an audit-log entry for the current workspace."""
    try:
        await db.audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "owner_id": ws(user),
            "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email", ""),
            "action": action,           # "create" | "update" | "delete"
            "entity_type": entity_type, # "event" | "staff" | "template" | "expense" | "shift" | "auth"
            "entity_id": entity_id,
            "summary": summary,
            "at": now_utc().isoformat(),
        })
    except Exception:
        pass

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

async def compute_event_summary(ev: dict, staff_map: Optional[dict] = None, cost_ratios: Optional[Dict[str, float]] = None) -> dict:
    """Enrich event with labor_cost, profit, estimated_cost & forecasted_profit.

    If ``cost_ratios`` (category → ratio) is provided, uses them to estimate cost
    for events that have no saved costs — otherwise the estimate falls back to 0.
    """
    labor_cost = 0.0
    if staff_map is None:
        staff_ids = [s["staff_id"] for s in ev.get("shifts", [])]
        staff_map = {}
        if staff_ids:
            cursor = db.staff.find({"id": {"$in": staff_ids}}, {"_id": 0})
            async for s in cursor:
                staff_map[s["id"]] = s
    for shift in ev.get("shifts", []):
        s = staff_map.get(shift["staff_id"])
        if s:
            labor_cost += float(shift.get("hours", 0)) * float(s.get("hourly_rate", 0))
    material_cost = sum(float(c.get("amount", 0)) for c in ev.get("costs", []))
    revenue = float(ev.get("revenue", 0))
    total_cost = material_cost + labor_cost
    ev["labor_cost"] = round(labor_cost, 2)
    ev["material_cost"] = round(material_cost, 2)
    ev["total_cost"] = round(total_cost, 2)
    ev["profit"] = round(revenue - total_cost, 2)
    # ---- Forecasted (net) cost & profit ----
    if total_cost > 0:
        ev["estimated_cost"] = ev["total_cost"]
        ev["forecasted_profit"] = ev["profit"]
        ev["cost_is_estimate"] = False
    elif cost_ratios is not None:
        ev["estimated_cost"] = _estimate_costs_for(ev, cost_ratios)
        ev["forecasted_profit"] = round(revenue - ev["estimated_cost"], 2)
        ev["cost_is_estimate"] = ev["estimated_cost"] > 0
    else:
        ev["estimated_cost"] = 0.0
        ev["forecasted_profit"] = ev["profit"]
        ev["cost_is_estimate"] = False
    return ev

async def load_owner_staff_map(owner_id: str) -> dict:
    """Load all staff for an owner once, returning {id: staff_doc}."""
    cursor = db.staff.find({"owner_id": owner_id}, {"_id": 0})
    return {s["id"]: s async for s in cursor}

# ---------- Auth ----------
@api.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterIn):
    email = body.email.lower().strip()
    if len(body.password) < 6:
        raise HTTPException(400, "Hasło musi mieć co najmniej 6 znaków")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(409, "Konto z tym adresem już istnieje")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name or email.split("@")[0],
        "password_hash": hash_pw(body.password),
        "created_at": now_utc().isoformat(),
    }
    user["workspace_id"] = user["id"]  # own workspace by default
    await db.users.insert_one(user)
    token = make_token(user["id"])
    return {"access_token": token, "user": {"id": user["id"], "email": email, "name": user["name"]}}

@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower().strip()
    u = await db.users.find_one({"email": email})
    if not u or not verify_pw(body.password, u["password_hash"]):
        raise HTTPException(401, "Nieprawidłowy email lub hasło")
    if u.get("active") is False:
        raise HTTPException(403, "Konto jest zablokowane. Skontaktuj się z administratorem.")
    token = make_token(u["id"])
    return {"access_token": token, "user": {
        "id": u["id"], "email": u["email"], "name": u.get("name", ""),
        "role": u.get("role", "admin"),
        "staff_id": u.get("staff_id"),
        "permissions": u.get("permissions") or {},
    }}

@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user

# ---------- Emergent Google Auth ----------
class SessionExchangeIn(BaseModel):
    session_id: str

@api.post("/auth/session")
async def auth_session(body: SessionExchangeIn):
    """Exchange a one-time Emergent session_id for a 7-day session_token.

    Also upserts the user in MongoDB (by email — reuses existing user_id when the
    email is already known so JWT/email auth accounts get linked automatically).
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
    except httpx.HTTPError:
        raise HTTPException(401, "Nie udało się połączyć z Google Auth")

    if resp.status_code != 200:
        raise HTTPException(401, "Nieprawidłowy lub wygasły session_id")

    data = resp.json()
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(401, "Brak e-maila w danych logowania")
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture") or ""
    session_token = data.get("session_token")
    if not session_token:
        raise HTTPException(500, "Brak session_token w odpowiedzi Emergent")

    # Upsert user by email — reuse existing user_id if present (link Google to existing account)
    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not user:
        user = {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": name,
            "picture": picture,
            "workspace_id": None,
            "auth_provider": "google",
            "created_at": now_utc().isoformat(),
        }
        user["workspace_id"] = user["id"]  # own workspace by default
        await db.users.insert_one(dict(user))
    else:
        # Refresh picture/name if changed and mark google as an available provider
        upd = {}
        if picture and user.get("picture") != picture:
            upd["picture"] = picture
        if name and not user.get("name"):
            upd["name"] = name
        if upd:
            await db.users.update_one({"id": user["id"]}, {"$set": upd})
            user.update(upd)
        if not user.get("workspace_id"):
            user["workspace_id"] = user["id"]

    # Store the session (7-day validity — matches Emergent)
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["id"],
        "expires_at": now_utc() + timedelta(days=7),
        "created_at": now_utc(),
    })

    # Never leak Mongo _id
    user.pop("_id", None)
    return {"session_token": session_token, "user": user}

@api.post("/auth/logout")
async def auth_logout(cred: HTTPAuthorizationCredentials = Depends(bearer)):
    """Best-effort revoke of a session_token (JWT tokens are stateless — client just drops them)."""
    if cred and cred.credentials:
        await db.user_sessions.delete_one({"session_token": cred.credentials})
    return {"ok": True}

class WorkspaceJoinIn(BaseModel):
    code: str

@api.get("/workspace")
async def workspace_info(user=Depends(current_user)):
    """Return current workspace and its members."""
    wsid = ws(user)
    members = await db.users.find(
        {"$or": [{"id": wsid}, {"workspace_id": wsid}]},
        {"_id": 0, "password_hash": 0}
    ).to_list(100)
    return {
        "workspace_id": wsid,
        "invite_code": wsid,
        "members": [{"id": m["id"], "name": m.get("name", ""), "email": m.get("email", "")} for m in members],
    }

@api.post("/workspace/join")
async def workspace_join(body: WorkspaceJoinIn, user=Depends(current_user)):
    """Join another user's workspace by their invite code (= their user id)."""
    code = (body.code or "").strip()
    if not code:
        raise HTTPException(400, "Podaj kod dostępu")
    if code == user["id"]:
        raise HTTPException(400, "To Twój własny kod")
    target = await db.users.find_one({"id": code}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "Nie znaleziono zespołu o tym kodzie")
    target_ws = target.get("workspace_id") or target["id"]
    await db.users.update_one({"id": user["id"]}, {"$set": {"workspace_id": target_ws}})
    return {"ok": True, "workspace_id": target_ws}

@api.post("/workspace/leave")
async def workspace_leave(user=Depends(current_user)):
    """Leave the current shared workspace and go back to a personal workspace."""
    await db.users.update_one({"id": user["id"]}, {"$set": {"workspace_id": user["id"]}})
    return {"ok": True, "workspace_id": user["id"]}

@api.get("/history")
async def history(user=Depends(current_user), limit: int = 200):
    """Return recent audit-log entries for the workspace, newest first."""
    items = await db.audit_log.find(
        {"owner_id": ws(user)}, {"_id": 0}
    ).sort("at", -1).to_list(max(1, min(limit, 500)))
    return items

@api.delete("/history")
async def clear_history(user=Depends(current_user)):
    """Clear the workspace audit log."""
    await db.audit_log.delete_many({"owner_id": ws(user)})
    return {"ok": True}

@api.delete("/auth/me")
async def delete_account(user=Depends(current_user)):
    """Delete user account and all associated data (events, staff, templates)."""
    uid = user["id"]
    await db.events.delete_many({"owner_id": uid})
    await db.staff.delete_many({"owner_id": uid})
    await db.templates.delete_many({"owner_id": uid})
    await db.users.delete_one({"id": uid})
    return {"ok": True}

# ---------- Offer email ----------
@api.post("/offers/send-email")
async def send_offer(body: SendOfferIn, user=Depends(current_user)):
    """Generate a personalized PDF offer and email it to the client via Gmail SMTP.

    Data source: mirrors /app/frontend/src/offers.ts. Only Adults/Occasion/Corporate
    packages (Zestaw 1/2/3) are supported at the moment.
    """
    import asyncio
    from offer_email import (
        build_offer_pdf, send_offer_email, _find_set, _fmt_pln, build_intro_text,
        EVENT_TYPE_LABELS, EVENT_TYPE_SUBJECTS, find_extra,
    )

    # Personalize subject line
    who = (body.client_name or "").strip()
    when = (body.event_date or "").strip()
    type_label = EVENT_TYPE_LABELS.get(body.event_type or "", "")

    # Per-type subject override (e.g. urodziny → "Oferta urodzinek")
    subject_base = EVENT_TYPE_SUBJECTS.get(body.event_type or "")
    if subject_base:
        subject = subject_base
        if when:
            subject = f"{subject}  ·  {when}"
        if who:
            subject = f"{subject}  ·  {who}"
    else:
        subj_bits = []
        if type_label:
            subj_bits.append(type_label.capitalize())
        if when:
            subj_bits.append(when)
        subj_suffix = " · ".join(subj_bits)
        subject = f"Oferta — Biesiada pod Lasem"
        if subj_suffix:
            subject = f"{subject}  ·  {subj_suffix}"
        if who:
            subject = f"{subject}  ·  {who}"

    chosen = _find_set(body.package_set_id) if body.event_type in (None, "okolicznosciowe", "firmowe") else None
    base = 0.0
    extras_total = 0.0
    if chosen and body.people_count:
        base = chosen["price"] * body.people_count
        for e in body.extras or []:
            eid = e.get("id")
            if eid == "ciasto":
                extras_total += float(e.get("amount") or 0)
            else:
                from offer_email import ADULT_EXTRAS
                src = next((x for x in ADULT_EXTRAS if x["id"] == eid), None)
                if src:
                    extras_total += float(e.get("qty") or 0) * float(src["price"])
    total_line = ""
    if chosen and body.people_count:
        total_line = f"\n\nSzacunkowy koszt propozycji: {_fmt_pln(base + extras_total)}"

    # ---- Email body (plaintext) using the type-specific intro
    intro = build_intro_text(body.event_type)
    if (body.custom_greeting or "").strip():
        greeting = body.custom_greeting.strip()
    else:
        greeting = f"Dzień dobry {who}," if who else "Dzień dobry,"
    # Also allow overriding subject
    if (body.custom_subject or "").strip():
        subject = body.custom_subject.strip()

    # Attachment strategy per event type
    is_workshops = body.event_type == "warsztaty"
    is_trips = body.event_type in ("wycieczki_szkolne", "wycieczki_rodzice")
    is_adult = body.event_type in ("okolicznosciowe", "firmowe")
    is_birthday = body.event_type == "urodziny"
    att_mode = (body.attachments_mode or "both").lower()
    if att_mode not in ("grill", "dinner", "both"):
        att_mode = "both"

    if is_birthday:
        attachments_txt = ""
        attachments_html = ""
    elif is_trips:
        # Text-only email; the whole offer is in the intro body
        attachments_txt = ""
        attachments_html = ""
    elif is_workshops:
        attachments_txt = (
            "\n\nW załączniku:\n"
            "  •  Jesienne Warsztaty Edukacyjne 2026 — oferta (PDF),\n"
            "  •  Jesienne Warsztaty Edukacyjne 2026 — oferta (DOCX).\n"
        )
        attachments_html = """
        <div style="background:#F8F5EE;border:1px solid #E5D9B5;border-radius:8px;padding:12px 14px;margin-top:14px;">
          <div style="color:#1F3A2E;font-weight:700;font-size:13px;margin-bottom:6px">W załączniku:</div>
          <ul style="margin:0;padding-left:18px;color:#4B5563;font-size:13px;line-height:1.6">
            <li>Jesienne Warsztaty Edukacyjne 2026 — oferta (PDF)</li>
            <li>Jesienne Warsztaty Edukacyjne 2026 — oferta (DOCX)</li>
          </ul>
        </div>
        """
    elif is_adult:
        parts_txt = []
        parts_html_li = []
        if att_mode in ("grill", "both"):
            parts_txt.append("  •  Menu Biesiada pod Lasem 2026 (DOCX — grill),")
            parts_html_li.append("<li>Menu Biesiada pod Lasem 2026 (DOCX — grill)</li>")
        if att_mode in ("dinner", "both"):
            parts_txt.append("  •  Oferta obiadowa 2026 (DOCX),")
            parts_html_li.append("<li>Oferta obiadowa 2026 (DOCX)</li>")
        if parts_txt:
            attachments_txt = "\n\nW załączniku:\n" + "\n".join(parts_txt) + "\n"
            attachments_html = f"""
        <div style="background:#F8F5EE;border:1px solid #E5D9B5;border-radius:8px;padding:12px 14px;margin-top:14px;">
          <div style="color:#1F3A2E;font-weight:700;font-size:13px;margin-bottom:6px">W załączniku:</div>
          <ul style="margin:0;padding-left:18px;color:#4B5563;font-size:13px;line-height:1.6">{''.join(parts_html_li)}</ul>
        </div>
        """
        else:
            attachments_txt = ""
            attachments_html = ""
    else:
        attachments_txt = (
            "\n\nW załączniku:\n"
            "  •  Oferta w PDF (podsumowanie),\n"
            "  •  Menu Biesiada pod Lasem 2026 (DOCX),\n"
            "  •  Oferta obiadowa 2026 (DOCX).\n"
        )
        attachments_html = """
        <div style="background:#F8F5EE;border:1px solid #E5D9B5;border-radius:8px;padding:12px 14px;margin-top:14px;">
          <div style="color:#1F3A2E;font-weight:700;font-size:13px;margin-bottom:6px">W załączniku:</div>
          <ul style="margin:0;padding-left:18px;color:#4B5563;font-size:13px;line-height:1.6">
            <li>Oferta w PDF (podsumowanie)</li>
            <li>Menu Biesiada pod Lasem 2026 (DOCX)</li>
            <li>Oferta obiadowa 2026 (DOCX)</li>
          </ul>
        </div>
        """

    # Custom sign-off per event type (e.g. warsztaty uses shorter version)
    from offer_email import EVENT_TYPE_SIGNOFFS
    custom_signoff = EVENT_TYPE_SIGNOFFS.get(body.event_type or "")
    default_signoff = (
        "Pozdrawiamy serdecznie,\n"
        "Zespół Biesiada pod Lasem\n"
        "www.dolinaprzygod.pl · biesiadapodlasem@gmail.com"
    )
    signoff_text = custom_signoff or default_signoff

    body_text = (
        f"{greeting}\n\n"
        f"{intro}\n"
        + (f"\nData wydarzenia: {when}" if when else "")
        + (f"\nLiczba osób: {body.people_count}" if body.people_count else "")
        + (f"\nSugerowany zestaw: {chosen['name']} ({_fmt_pln(chosen['price'])}/os.)" if chosen else "")
        + total_line
        + ((f"\n\nDodatkowe uwagi:\n{body.custom_note.strip()}") if (body.custom_note or "").strip() else "")
        + attachments_txt
        + f"\n{signoff_text}"
    )

    # ---- HTML variant (same intro rendered nicely)
    intro_html = intro.replace("\n\n", "</p><p style='margin:0 0 10px 0'>").replace("\n", "<br/>")
    who_html = f"<p>Dzień dobry <strong>{who}</strong>,</p>" if who else "<p>Dzień dobry,</p>"
    when_html = f"<li>Data wydarzenia: <strong>{when}</strong></li>" if when else ""
    people_html = f"<li>Liczba osób: <strong>{body.people_count}</strong></li>" if body.people_count else ""
    set_html = f"<li>Sugerowany zestaw: <strong>{chosen['name']}</strong> ({_fmt_pln(chosen['price'])}/os.)</li>" if chosen else ""
    facts_html = f"<ul style='line-height:1.6'>{when_html}{people_html}{set_html}</ul>" if (when_html or people_html or set_html) else ""
    total_html = f"<p style='color:#D4AF37;font-weight:700;font-size:16px'>Szacunkowy koszt propozycji: {_fmt_pln(base + extras_total)}</p>" if chosen and body.people_count else ""
    note_html = f"<p><em>{(body.custom_note or '').strip()}</em></p>" if (body.custom_note or '').strip() else ""

    signoff_html = signoff_text.replace("\n", "<br/>")
    body_html = f"""
    <div style="font-family: -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                background:#F8F5EE;padding:24px;color:#111827;">
      <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #E5D9B5;
                  border-radius:12px;padding:28px;">
        <h1 style="color:#1F3A2E;margin:0 0 4px 0;">Biesiada pod Lasem</h1>
        <div style="color:#D4AF37;letter-spacing:2px;font-size:11px;font-weight:700;margin-bottom:16px;">
          KIELCE · DOLINA PRZYGÓD
        </div>
        {who_html}
        <p style="margin:0 0 10px 0">{intro_html}</p>
        {facts_html}
        {total_html}
        {note_html}
        {attachments_html}
        <hr style="border:none;border-top:1px solid #E5D9B5;margin:20px 0"/>
        <p style="color:#4B5563;font-size:13px">{signoff_html}</p>
      </div>
    </div>
    """

    try:
        # Attachment strategy per event type:
        # - okolicznosciowe/firmowe: only 2 DOCX menus, no auto PDF
        # - warsztaty: only the hand-crafted workshops PDF, no menu DOCX, no auto PDF
        # - urodziny: NOTHING — pure text email
        # - default: auto PDF (catalog + calc) + 2 DOCX menus
        skip_auto_pdf = body.event_type in ("okolicznosciowe", "firmowe", "warsztaty", "wycieczki_szkolne", "wycieczki_rodzice", "urodziny")

        pdf_bytes = None
        if not skip_auto_pdf:
            pdf_bytes = build_offer_pdf(
                client_name=body.client_name or None,
                event_date=body.event_date or None,
                people_count=body.people_count,
                package_set_id=body.package_set_id,
                extras=body.extras,
                custom_note=body.custom_note or None,
                event_type=body.event_type or None,
            )
        # Pick a nice filename that reflects the event type
        fname_type_map = {
            "okolicznosciowe": "okolicznosciowa",
            "firmowe": "firmowa",
            "urodziny": "urodziny",
            "warsztaty": "warsztaty",
            "wycieczki_szkolne": "wycieczki-szkolne",
            "wycieczki_rodzice": "wycieczki-z-rodzicami",
        }
        fname_type = fname_type_map.get(body.event_type or "", "plenerowa")

        assets_dir = ROOT_DIR / "assets"
        grill_file = {"path": str(assets_dir / "Menu-Biesiada-pod-Lasem-2026.docx"),
                      "filename": "Menu-Biesiada-pod-Lasem-2026.docx"}
        dinner_file = {"path": str(assets_dir / "Oferta-obiadowa-2026.docx"),
                       "filename": "Oferta-obiadowa-2026.docx"}

        if body.event_type == "urodziny":
            extras_files = []
        elif body.event_type == "warsztaty":
            extras_files = [
                {"path": str(assets_dir / "Jesienne-Warsztaty-Edukacyjne-2026.pdf"),
                 "filename": "Jesienne-Warsztaty-Edukacyjne-2026.pdf"},
                {"path": str(assets_dir / "oferta_warsztaty_jesienne_2026.docx"),
                 "filename": "Jesienne-Warsztaty-Edukacyjne-2026.docx"},
            ]
        elif body.event_type in ("wycieczki_szkolne", "wycieczki_rodzice"):
            # Text-only email — full pricing/details in the intro body
            extras_files = []
        elif body.event_type in ("okolicznosciowe", "firmowe"):
            # User picks: grill only / dinner only / both
            extras_files = []
            if att_mode in ("grill", "both"):
                extras_files.append(grill_file)
            if att_mode in ("dinner", "both"):
                extras_files.append(dinner_file)
        else:
            extras_files = [grill_file, dinner_file]

        await asyncio.to_thread(
            send_offer_email,
            to_email=str(body.to_email),
            subject=subject,
            body_text=body_text,
            body_html=body_html,
            pdf_bytes=pdf_bytes,
            pdf_filename=f"Oferta-Biesiada-{fname_type}-{when or ''}".rstrip("-") + ".pdf",
            extra_attachments=extras_files,
            reply_to=os.getenv("SMTP_USER"),
        )
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Nie udało się wysłać maila: {e}")

    await log_change(
        user, "create", "offer_email",
        body.event_id or "manual",
        f"Wysłano ofertę do {body.to_email}"
          + (f" — {who}" if who else "")
          + (f" ({type_label})" if type_label else "")
          + (f" [{when}]" if when else ""),
    )
    return {"ok": True, "to": str(body.to_email)}


@api.post("/offers/preview-pdf")
async def preview_offer_pdf(body: SendOfferIn, user=Depends(current_user)):
    """Same PDF that would be sent — returned inline for preview. Does NOT send email."""
    from fastapi.responses import Response
    from offer_email import build_offer_pdf
    event_type = body.event_type or "okolicznosciowe"
    is_adult = event_type in ("okolicznosciowe", "firmowe")
    extras_norm = None
    if is_adult and body.extras:
        norm = []
        for e in body.extras or []:
            eid = e.get("id"); qty = e.get("qty") or 0; amount = e.get("amount") or 0
            if not eid: continue
            if eid == "ciasto": norm.append({"id": eid, "amount": float(amount)})
            elif eid: norm.append({"id": eid, "qty": float(qty)})
        extras_norm = norm
    try:
        pdf_bytes = build_offer_pdf(
            client_name=body.client_name or None,
            event_date=body.event_date or None,
            people_count=body.people_count,
            package_set_id=body.package_set_id if is_adult else None,
            extras=extras_norm,
            custom_note=body.custom_note or None,
            event_type=event_type,
        )
    except Exception as e:
        raise HTTPException(500, f"Nie udało się wygenerować PDF: {e}")
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="Oferta-podglad.pdf"'})


# ---------- Staff ----------
@api.get("/staff")
async def list_staff(user=Depends(current_user)):
    items = await db.staff.find({"owner_id": ws(user)}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api.post("/staff")
async def create_staff(body: StaffIn, user=Depends(require_admin)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "staff", doc["id"], f"Dodano pracownika: {doc.get('name','')}")
    return doc

@api.put("/staff/{staff_id}")
async def update_staff(staff_id: str, body: StaffPatch, user=Depends(require_admin)):
    # exclude_unset=True — nie nadpisuj pól które frontend świadomie pominął
    payload = body.dict(exclude_unset=True)
    # Jeżeli name został wysłany jako pusty string, nie nadpisuj (bezpiecznik)
    if "name" in payload and (payload["name"] is None or payload["name"] == ""):
        payload.pop("name")
    if not payload:
        raise HTTPException(400, "Brak zmian")
    res = await db.staff.update_one(
        {"id": staff_id, "owner_id": ws(user)},
        {"$set": payload},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Pracownik nie znaleziony")
    doc = await db.staff.find_one({"id": staff_id}, {"_id": 0})
    await log_change(user, "update", "staff", staff_id, f"Edytowano pracownika: {doc.get('name','')}")
    return doc

@api.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(current_user)):
    require_admin(user)
    doc = await db.staff.find_one({"id": staff_id, "owner_id": ws(user)}, {"_id": 0})
    await db.staff.delete_one({"id": staff_id, "owner_id": ws(user)})
    # remove linked staff login (User) if any
    await db.users.delete_many({"staff_id": staff_id, "workspace_id": ws(user)})
    if doc: await log_change(user, "delete", "staff", staff_id, f"Usunięto pracownika: {doc.get('name','')}")
    return {"ok": True}


# ---------- Staff login accounts (admin creates for their staff) ----------
DEFAULT_STAFF_PERMISSIONS = {
    "schedule":   True,   # Mój grafik
    "attendance": True,   # Lista obecności
    "checklist":  True,   # Checklisty imprezy
    "shopping":   True,   # Zakupy
    "stock":      True,   # Magazyn
}


class StaffLoginIn(BaseModel):
    email: EmailStr
    password: Optional[str] = None
    permissions: Optional[Dict[str, bool]] = None
    active: Optional[bool] = True


@api.post("/staff/{staff_id}/login")
async def create_staff_login(staff_id: str, body: StaffLoginIn, user=Depends(current_user)):
    """Admin creates or updates a login account for an existing staff member."""
    require_admin(user)
    owner = ws(user)
    st = await db.staff.find_one({"id": staff_id, "owner_id": owner}, {"_id": 0})
    if not st:
        raise HTTPException(404, "Nie znaleziono pracownika")
    email = body.email.lower().strip()
    # Prevent hijacking existing accounts
    existing = await db.users.find_one({"email": email})
    if existing and existing.get("staff_id") != staff_id:
        raise HTTPException(409, "Ten adres email jest już powiązany z innym kontem")

    perms = {**DEFAULT_STAFF_PERMISSIONS, **(body.permissions or {})}
    if existing:
        # Update: password (optional), permissions, active
        updates = {
            "role": "staff", "staff_id": staff_id,
            "workspace_id": owner,
            "permissions": perms,
            "name": st.get("name") or existing.get("name") or email,
            "active": bool(body.active) if body.active is not None else existing.get("active", True),
            "updated_at": now_utc().isoformat(),
        }
        if body.password:
            if len(body.password) < 6:
                raise HTTPException(400, "Hasło musi mieć min. 6 znaków")
            updates["password_hash"] = hash_pw(body.password)
        await db.users.update_one({"id": existing["id"]}, {"$set": updates})
        u_id = existing["id"]
    else:
        if not body.password or len(body.password) < 6:
            raise HTTPException(400, "Hasło musi mieć min. 6 znaków")
        u_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": u_id, "email": email, "name": st.get("name") or email,
            "role": "staff", "staff_id": staff_id, "workspace_id": owner,
            "password_hash": hash_pw(body.password), "permissions": perms,
            "active": bool(body.active) if body.active is not None else True,
            "created_at": now_utc().isoformat(),
        })
    # Also mark staff record with linked user_id (helpful for UI)
    await db.staff.update_one({"id": staff_id, "owner_id": owner},
                              {"$set": {"user_id": u_id, "login_email": email}})
    await log_change(user, "update", "staff", staff_id, f"Utworzono/aktualizowano login pracownika {email}")
    return {"ok": True, "user_id": u_id, "email": email, "permissions": perms, "active": True}


@api.delete("/staff/{staff_id}/login")
async def delete_staff_login(staff_id: str, user=Depends(current_user)):
    require_admin(user)
    owner = ws(user)
    r = await db.users.delete_many({"staff_id": staff_id, "workspace_id": owner, "role": "staff"})
    await db.staff.update_one({"id": staff_id, "owner_id": owner},
                              {"$unset": {"user_id": "", "login_email": ""}})
    await log_change(user, "delete", "staff", staff_id, "Usunięto login pracownika")
    return {"ok": True, "deleted": r.deleted_count}


# ---------- Time clock (Lista obecności) ----------
class TimeStartIn(BaseModel):
    model_config = {"extra": "allow"}
    event_id: Optional[str] = None
    note: Optional[str] = ""


@api.post("/time-entries/start")
async def time_start(body: TimeStartIn, user=Depends(current_user)):
    """Staff clocks in (starts a work session)."""
    if not is_staff(user):
        # allow admin to test clock too, but require staff_id linkage otherwise
        pass
    sid = user.get("staff_id")
    if not sid and is_staff(user):
        raise HTTPException(400, "Twoje konto nie jest powiązane z rekordem pracownika")
    owner = ws(user)
    # Prevent duplicate open sessions
    open_row = await db.time_entries.find_one({"owner_id": owner, "staff_id": sid, "end_at": None}, {"_id": 0})
    if open_row:
        return open_row
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": owner,
        "staff_id": sid,
        "user_id": user["id"],
        "event_id": body.event_id,
        "start_at": now_utc().isoformat(),
        "end_at": None,
        "manual": False,
        "hours": 0.0,
        "note": (body.note or "").strip(),
        "paid": False,
    }
    await db.time_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


class TimeStopIn(BaseModel):
    model_config = {"extra": "allow"}
    entry_id: Optional[str] = None
    note: Optional[str] = ""


@api.post("/time-entries/stop")
async def time_stop(body: TimeStopIn, user=Depends(current_user)):
    """Staff clocks out (ends open session)."""
    sid = user.get("staff_id")
    owner = ws(user)
    q: dict = {"owner_id": owner, "end_at": None}
    if body.entry_id:
        q["id"] = body.entry_id
    elif sid:
        q["staff_id"] = sid
    else:
        raise HTTPException(400, "Brak aktywnej sesji do zakończenia")
    row = await db.time_entries.find_one(q, {"_id": 0})
    if not row:
        raise HTTPException(404, "Nie znaleziono aktywnej sesji")
    end_dt = now_utc()
    start_dt = datetime.fromisoformat(row["start_at"])
    hours = round((end_dt - start_dt).total_seconds() / 3600.0, 3)
    await db.time_entries.update_one({"id": row["id"]},
                                     {"$set": {"end_at": end_dt.isoformat(),
                                               "hours": hours,
                                               "note": ((row.get("note") or "") + " " + (body.note or "")).strip()}})
    row["end_at"] = end_dt.isoformat(); row["hours"] = hours
    return row


@api.get("/time-entries/my")
async def time_my(user=Depends(current_user), limit: int = 60):
    sid = user.get("staff_id")
    if not sid and is_staff(user):
        return []
    q = {"owner_id": ws(user)}
    if sid: q["staff_id"] = sid
    else:   q["user_id"] = user["id"]
    rows = await db.time_entries.find(q, {"_id": 0}).sort("start_at", -1).to_list(int(limit))
    return rows


@api.get("/time-entries")
async def time_all(user=Depends(current_user), staff_id: str = "",
                   date_from: str = "", date_to: str = "", unpaid_only: bool = False):
    """Admin: list all time entries with optional filters."""
    require_admin(user)
    q: dict = {"owner_id": ws(user)}
    if staff_id: q["staff_id"] = staff_id
    if unpaid_only: q["paid"] = False
    if date_from or date_to:
        q["start_at"] = {}
        if date_from: q["start_at"]["$gte"] = date_from
        if date_to:   q["start_at"]["$lt"]  = date_to + "T23:59:59"
    rows = await db.time_entries.find(q, {"_id": 0}).sort("start_at", -1).to_list(2000)
    return rows


class TimeEntryPatch(BaseModel):
    model_config = {"extra": "allow"}
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    note: Optional[str] = None
    event_id: Optional[str] = None


@api.patch("/time-entries/{entry_id}")
async def time_patch(entry_id: str, body: TimeEntryPatch, user=Depends(current_user)):
    """Admin corrects a time entry (start/end/note)."""
    require_admin(user)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates: return {"ok": True}
    updates["manual"] = True
    if "start_at" in updates or "end_at" in updates:
        row = await db.time_entries.find_one({"id": entry_id, "owner_id": ws(user)}, {"_id": 0})
        if row:
            s = updates.get("start_at") or row.get("start_at")
            e = updates.get("end_at") or row.get("end_at")
            if s and e:
                try:
                    updates["hours"] = round((datetime.fromisoformat(e) - datetime.fromisoformat(s)).total_seconds() / 3600.0, 3)
                except Exception: pass
    await db.time_entries.update_one({"id": entry_id, "owner_id": ws(user)}, {"$set": updates})
    return {"ok": True}


@api.delete("/time-entries/{entry_id}")
async def time_delete(entry_id: str, user=Depends(current_user)):
    require_admin(user)
    await db.time_entries.delete_one({"id": entry_id, "owner_id": ws(user)})
    return {"ok": True}


# ---------- Payroll: weekly settlement ----------
@api.get("/payroll/summary")
async def payroll_summary(user=Depends(require_admin), date_from: str = "", date_to: str = "", unpaid_only: bool = True):
    """Return per-staff payroll summary for a given period.
    Sums CLOSED time entries; each staff's `hourly_rate` × total hours = amount to pay.
    """
    owner = ws(user)
    q: dict = {"owner_id": owner, "end_at": {"$ne": None}}
    if unpaid_only:
        q["paid"] = {"$ne": True}
    if date_from or date_to:
        q["start_at"] = {}
        if date_from: q["start_at"]["$gte"] = date_from
        if date_to:   q["start_at"]["$lt"]  = date_to + "T23:59:59"
    entries = await db.time_entries.find(q, {"_id": 0}).to_list(5000)
    staff_rows = await db.staff.find({"owner_id": owner}, {"_id": 0}).to_list(500)
    smap = {s["id"]: s for s in staff_rows}

    by_staff: dict = {}
    for e in entries:
        sid = e.get("staff_id")
        st = smap.get(sid) or {}
        row = by_staff.setdefault(sid or "?", {
            "staff_id": sid, "name": st.get("name") or "?", "role": st.get("role") or "",
            "hourly_rate": float(st.get("hourly_rate") or 0),
            "hours": 0.0, "entries": [], "amount": 0.0,
        })
        row["hours"] += float(e.get("hours") or 0)
        row["entries"].append(e.get("id"))
    rows = list(by_staff.values())
    for r in rows:
        r["hours"] = round(r["hours"], 3)
        r["amount"] = round(r["hours"] * r["hourly_rate"], 2)
    rows.sort(key=lambda r: r["name"])
    total = round(sum(r["amount"] for r in rows), 2)
    return {"date_from": date_from, "date_to": date_to, "total": total, "staff": rows}


class PayrollMarkPaidIn(BaseModel):
    model_config = {"extra": "allow"}
    date_from: str
    date_to: str
    staff_id: Optional[str] = None    # None = all staff in this period
    create_expense: bool = True       # also add to /expenses category "wyplaty_pracownikow"
    note: Optional[str] = ""


@api.post("/payroll/mark-paid")
async def payroll_mark_paid(body: PayrollMarkPaidIn, user=Depends(require_admin)):
    owner = ws(user)
    q: dict = {"owner_id": owner, "end_at": {"$ne": None}, "paid": {"$ne": True},
               "start_at": {"$gte": body.date_from, "$lt": body.date_to + "T23:59:59"}}
    if body.staff_id: q["staff_id"] = body.staff_id
    entries = await db.time_entries.find(q, {"_id": 0}).to_list(5000)
    if not entries:
        return {"ok": True, "affected": 0, "total": 0.0, "expenses_created": 0}
    # Group by staff for expense creation
    staff_rows = await db.staff.find({"owner_id": owner}, {"_id": 0}).to_list(500)
    smap = {s["id"]: s for s in staff_rows}
    paid_at = now_utc().isoformat()
    ids = [e["id"] for e in entries]
    await db.time_entries.update_many(
        {"id": {"$in": ids}, "owner_id": owner},
        {"$set": {"paid": True, "paid_at": paid_at}},
    )
    # totals per staff
    tot_by_staff: dict = {}
    for e in entries:
        sid = e.get("staff_id") or "?"
        tot_by_staff.setdefault(sid, 0.0)
        tot_by_staff[sid] += float(e.get("hours") or 0)
    total_amount = 0.0
    expenses_created = 0
    if body.create_expense:
        # Guardrail: use hourly_rate from staff record at the moment of settlement
        for sid, hours in tot_by_staff.items():
            st = smap.get(sid) or {}
            rate = float(st.get("hourly_rate") or 0)
            amount = round(hours * rate, 2)
            if amount <= 0: continue
            total_amount += amount
            exp_doc = {
                "id": str(uuid.uuid4()),
                "owner_id": owner,
                "date": paid_at[:10],
                "amount": amount,
                "name": f"Wypłata: {st.get('name') or 'Pracownik'} · {hours:.2f}h × {rate:.2f}zł",
                "category": "wyplaty_pracownikow",
                "staff_id": sid if sid != "?" else None,
                "notes": (body.note or "") + f"  ({body.date_from} — {body.date_to})",
                "created_at": paid_at,
                "payroll_settlement": True,
            }
            await db.expenses.insert_one(exp_doc)
            expenses_created += 1
    else:
        for sid, hours in tot_by_staff.items():
            st = smap.get(sid) or {}
            total_amount += round(hours * float(st.get("hourly_rate") or 0), 2)
    await log_change(user, "update", "payroll", f"{body.date_from}_{body.date_to}",
                     f"Oznaczono wypłatę: {len(ids)} wpisów, {round(total_amount,2)} PLN")
    return {"ok": True, "affected": len(ids), "total": round(total_amount, 2),
            "expenses_created": expenses_created, "paid_at": paid_at}


# ---------- Wyposażenie / Majątek (Assets) ----------
class AssetIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    qty: float = 1
    value: float = 0.0                        # aktualna wartość jednostkowa (PLN)
    photo_base64: Optional[str] = None        # data URL lub czysty base64
    notes: Optional[str] = ""


class AssetPatch(BaseModel):
    model_config = {"extra": "allow"}
    name: Optional[str] = None
    qty: Optional[float] = None
    value: Optional[float] = None
    photo_base64: Optional[str] = None
    notes: Optional[str] = None


@api.get("/assets")
async def list_assets(user=Depends(require_admin), q: str = ""):
    """List all assets for the workspace. `q` = case-insensitive substring on name."""
    query: dict = {"owner_id": ws(user)}
    if q:
        query["name"] = {"$regex": _re.escape(q), "$options": "i"}
    rows = await db.assets.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
    total_value = round(sum(float(a.get("qty") or 0) * float(a.get("value") or 0) for a in rows), 2)
    return {"count": len(rows), "total_value": total_value, "items": rows}


@api.post("/assets")
async def create_asset(body: AssetIn, user=Depends(require_admin)):
    doc = body.dict()
    if not (doc.get("name") or "").strip():
        raise HTTPException(400, "Brak nazwy")
    doc["name"] = doc["name"].strip()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user)
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = doc["created_at"]
    # Cap photo size (base64) at ~2 MB to protect Mongo document size
    if doc.get("photo_base64") and len(doc["photo_base64"]) > 3_000_000:
        raise HTTPException(413, "Zdjęcie jest za duże (max ~2 MB). Zmniejsz je i spróbuj ponownie.")
    await db.assets.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/assets/{asset_id}")
async def update_asset(asset_id: str, body: AssetPatch, user=Depends(require_admin)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    if updates.get("photo_base64") and len(updates["photo_base64"]) > 3_000_000:
        raise HTTPException(413, "Zdjęcie jest za duże (max ~2 MB). Zmniejsz je i spróbuj ponownie.")
    updates["updated_at"] = now_utc().isoformat()
    await db.assets.update_one({"id": asset_id, "owner_id": ws(user)}, {"$set": updates})
    return {"ok": True}


@api.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, user=Depends(require_admin)):
    await db.assets.delete_one({"id": asset_id, "owner_id": ws(user)})
    return {"ok": True}


# ---------- Staff-scoped views (own schedule / events) ----------
@api.get("/staff/my/schedule")
async def my_schedule(user=Depends(current_user), date_from: str = "", date_to: str = ""):
    """Return events where the logged-in staff member is assigned via shifts.
    Excludes any financial fields."""
    sid = user.get("staff_id")
    if not sid:
        # Admin without linked staff — return empty list
        return []
    q: dict = {"owner_id": ws(user), "shifts.staff_id": sid}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    rows = await db.events.find(q, {
        "_id": 0, "id": 1, "date": 1, "name": 1, "time_start": 1, "time_end": 1,
        "people": 1, "status": 1, "shifts": 1, "location": 1, "package_set": 1,
        "notes_public": 1,   # keep only public notes if present
    }).sort("date", 1).to_list(500)
    # keep only the current staff's shift line
    for e in rows:
        e["my_shift"] = next((sh for sh in (e.get("shifts") or []) if sh.get("staff_id") == sid), None)
        e.pop("shifts", None)
    return rows


# ---------- Events ----------
@api.get("/events")
async def list_events(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    # Staff sees only events they're assigned to (via shifts)
    if is_staff(user):
        sid = user.get("staff_id")
        if not sid:
            return []
        q["shifts.staff_id"] = sid
    items = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    staff_map = await load_owner_staff_map(user["id"])
    cost_ratios = await _cost_ratios_by_category(ws(user))
    enriched = []
    for ev in items:
        row = await compute_event_summary(ev, staff_map, cost_ratios)
        if is_staff(user):
            # Strip all financial fields for staff
            for k in ("price_total","discount_pct","deposit_amount","costs","total_cost",
                      "profit","profit_projected","predicted_settlement","revenue_projected",
                      "extras_qty","package_price","dinner_items_revenue","cost_breakdown"):
                row.pop(k, None)
        enriched.append(row)
    return enriched

@api.post("/events")
async def create_event(body: EventIn, user=Depends(require_admin)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "event", doc["id"], f"Utworzono imprezę: {doc.get('name','')} ({doc.get('date','')})")
    # In-app notification for the whole workspace (both bosses see it)
    try:
        await _create_activity_alert("event_created", ws(user), doc, user)
    except Exception:
        pass
    # Best-effort Google Calendar sync (non-blocking of API response)
    try:
        await _sync_event_for_workspace(ws(user), doc["id"], "create")
    except Exception:
        pass
    return await compute_event_summary(doc)

@api.get("/events/{event_id}")
async def get_event(event_id: str, user=Depends(current_user)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Impreza nie znaleziona")
    return await compute_event_summary(ev)

@api.put("/events/{event_id}")
async def update_event(event_id: str, body: EventIn, user=Depends(require_admin)):
    # Detect status transitions to clear/reset alerts appropriately
    prev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0, "status": 1})
    prev_status = (prev or {}).get("status") or ""
    new_status = (body.status or "")
    updates = body.dict()
    # If status moved OUT of tracked set, dismiss any existing alerts for this event
    if prev_status in _TRACKED_STATUSES and new_status not in _TRACKED_STATUSES:
        updates["alert_sent"] = False  # reset for future re-tracking if flipped back
        await db.alerts.update_many(
            {"event_id": event_id, "owner_id": ws(user), "dismissed": {"$ne": True}},
            {"$set": {"dismissed": True, "dismissed_at": now_utc().isoformat(), "auto_dismissed": True}}
        )
    # If status moved INTO tracked set from another, allow future alerts
    elif new_status in _TRACKED_STATUSES and prev_status not in _TRACKED_STATUSES:
        updates["alert_sent"] = False
    res = await db.events.update_one(
        {"id": event_id, "owner_id": ws(user)},
        {"$set": updates},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Impreza nie znaleziona")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    await log_change(user, "update", "event", event_id, f"Edytowano imprezę: {ev.get('name','')} ({ev.get('date','')})")
    try:
        await _sync_event_for_workspace(ws(user), event_id, "update")
    except Exception:
        pass
    return await compute_event_summary(ev)

@api.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(require_admin)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    # sync BEFORE delete so we still have google_event_ids
    try:
        if ev:
            await _sync_event_for_workspace(ws(user), event_id, "delete")
    except Exception:
        pass
    await db.events.delete_one({"id": event_id, "owner_id": ws(user)})
    if ev:
        await log_change(user, "delete", "event", event_id, f"Usunięto imprezę: {ev.get('name','')} ({ev.get('date','')})")
        try:
            await _create_activity_alert("event_deleted", ws(user), ev, user)
        except Exception:
            pass
    return {"ok": True}


# ---------- Catering email ----------
# Ceny z cateringu Yubari (z PDF Biesiada Pod Lasem) — zł/porcja
CATERING_PRICES = {
    "z1": ("Rosół z makaronem", 18.0),
    "z2": ("Zalewajka świętokrzyska", 22.0),
    "z3": ("Krem pomidorowo-paprykowy / mozzarella", 22.0),
    "z4": ("Krem z białych warzyw", 22.0),
    "d1": ("Polędwiczka WP / sos serowy z orzechami lub leśny", 28.0),
    "d2": ("Roladka drobiowa / sos serowy", 25.0),
    "d3": ("Kotlet schabowy", 18.0),
    "d4": ("Filet z kurczaka", 18.0),
    "d5": ("Filet zapiekany z pomidorami suszonymi, szpinakiem i mozzarellą", 24.0),
    "d6": ("Cordon Bleu", 24.0),
    "d7": ("Karczek pieczony / sos myśliwski", 26.0),
    "d8": ("Kotlet szydłowiecki (faszerowany)", 24.0),
    "dd1": ("Ziemniaki z wody", 8.0),
    "dd2": ("Ziemniaki opiekane", 9.0),
    "dd3": ("Kluski śląskie", 10.0),
    "dd4": ("Kopytka", 10.0),
    "dd5": ("Ryż z warzywami", 10.0),
    "dd6": ("Zestaw surówek", 8.0),
    "dd7": ("Surówka wiosenna", 8.0),
    "dd8": ("Kapusta zasmażana", 8.0),
}
CATERING_DISCOUNT_PCT = 20.0  # nasz stały rabat od Yubari

DEFAULT_DINNER_MENU = {k: v[0] for k, v in CATERING_PRICES.items()}


class CateringEmailIn(BaseModel):
    model_config = {"extra": "allow"}
    to_email: EmailStr = "yubari.restauracja@gmail.com"
    pickup_time: Optional[str] = None  # HH:MM (godzina odbioru)
    extra_notes: Optional[str] = ""
    greeting: Optional[str] = "Cześć Lorena, poniżej wysyłam zamówienie."


@api.post("/events/{event_id}/send-catering-email")
async def send_catering_email(event_id: str, body: CateringEmailIn, user=Depends(current_user)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")

    ms = await db.menu_settings.find_one({"owner_id": ws(user)}, {"_id": 0}) or {}
    custom_items = {c.get("id"): c for c in (ms.get("dinner_custom_items") or [])}
    dinner_items = ev.get("dinner_items") or {}

    def _label(dish_id: str) -> str:
        if dish_id in DEFAULT_DINNER_MENU:
            return DEFAULT_DINNER_MENU[dish_id]
        if dish_id in custom_items:
            return custom_items[dish_id].get("name", dish_id)
        return dish_id

    ordered = [(dish_id, qty) for dish_id, qty in dinner_items.items() if qty]
    if not ordered:
        raise HTTPException(400, "Ta impreza nie ma pozycji cateringu (dinner_items pusty).")

    # --- Kalkulacja cen (bazowa z cennika + rabat 20%) ---
    def _price(dish_id: str) -> float:
        if dish_id in CATERING_PRICES:
            return CATERING_PRICES[dish_id][1]
        # custom item — spróbuj wziąć base_price z menu_settings
        if dish_id in custom_items:
            try: return float(custom_items[dish_id].get("base_price") or 0)
            except Exception: return 0.0
        return 0.0

    def _line_str(dish_id: str, qty: float) -> str:
        p = _price(dish_id)
        if p > 0:
            return f"  • {_label(dish_id)} — {qty} porcji × {p:.2f} zł = {qty * p:.2f} zł"
        return f"  • {_label(dish_id)} — {qty} porcji"

    zupy    = [_line_str(k, v) for k, v in ordered if k.startswith("z")]
    dania   = [_line_str(k, v) for k, v in ordered if k.startswith("d") and not k.startswith("dd")]
    dodatki = [_line_str(k, v) for k, v in ordered if k.startswith("dd")]

    subtotal = sum(_price(k) * float(v) for k, v in ordered)
    discount = round(subtotal * CATERING_DISCOUNT_PCT / 100.0, 2)
    total_after = round(subtotal - discount, 2)

    ev_date = ev.get("date") or ""
    ev_name = ev.get("name") or "Impreza"
    people = int(ev.get("people") or 0)
    time_start = (ev.get("time_start") or ev.get("time") or "").strip()
    pickup = (body.pickup_time or "").strip()

    body_lines = [body.greeting or "", ""]
    body_lines.append(f"ZAMÓWIENIE CATERINGOWE — {ev_name}")
    body_lines.append(f"Termin imprezy: {ev_date}" + (f", godz. {time_start}" if time_start else ""))
    if pickup:
        body_lines.append(f"Godzina odbioru: {pickup}")
    if people:
        body_lines.append(f"Liczba osób: {people}")
    body_lines.append("")
    if zupy:
        body_lines.append("ZUPY:"); body_lines.extend(zupy); body_lines.append("")
    if dania:
        body_lines.append("DANIA GŁÓWNE:"); body_lines.extend(dania); body_lines.append("")
    if dodatki:
        body_lines.append("DODATKI:"); body_lines.extend(dodatki); body_lines.append("")
    if body.extra_notes:
        body_lines.append("UWAGI:"); body_lines.append(body.extra_notes); body_lines.append("")
    # Podsumowanie cen
    body_lines.append("─" * 40)
    body_lines.append(f"Suma cennika:           {subtotal:>10.2f} zł")
    body_lines.append(f"Rabat cateringu ({int(CATERING_DISCOUNT_PCT)}%):  -{discount:>10.2f} zł")
    body_lines.append(f"DO ZAPŁATY:             {total_after:>10.2f} zł")
    body_lines.append("─" * 40)
    body_lines.append("")
    body_lines.append("Pozdrawiam,")
    body_lines.append("Biesiada pod Lasem")
    body_text = "\n".join(body_lines)

    def _html_ul(rows):
        cleaned = [r.replace("  • ", "").strip() for r in rows]
        return "<ul style='margin:6px 0 12px 20px;padding:0'>" + "".join(f"<li style='margin:2px 0'>{r}</li>" for r in cleaned) + "</ul>"

    html_parts = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.5">']
    html_parts.append(f"<p>{(body.greeting or '').replace(chr(10), '<br>')}</p>")
    html_parts.append("<h2 style='color:#10B981;margin:6px 0'>Zamówienie cateringowe</h2>")
    html_parts.append("<table style='border-collapse:collapse'>")
    html_parts.append(f"<tr><td style='padding:2px 8px 2px 0;color:#6B7280'>Impreza:</td><td><b>{ev_name}</b></td></tr>")
    html_parts.append(f"<tr><td style='padding:2px 8px 2px 0;color:#6B7280'>Termin:</td><td><b>{ev_date}</b>" + (f", godz. {time_start}" if time_start else "") + "</td></tr>")
    if pickup:
        html_parts.append(f"<tr><td style='padding:2px 8px 2px 0;color:#6B7280'>Godzina odbioru:</td><td><b style='color:#DC2626'>{pickup}</b></td></tr>")
    if people:
        html_parts.append(f"<tr><td style='padding:2px 8px 2px 0;color:#6B7280'>Osób:</td><td><b>{people}</b></td></tr>")
    html_parts.append("</table>")
    if zupy:
        html_parts.append("<h3 style='margin:10px 0 4px'>Zupy</h3>"); html_parts.append(_html_ul(zupy))
    if dania:
        html_parts.append("<h3 style='margin:10px 0 4px'>Dania główne</h3>"); html_parts.append(_html_ul(dania))
    if dodatki:
        html_parts.append("<h3 style='margin:10px 0 4px'>Dodatki</h3>"); html_parts.append(_html_ul(dodatki))
    if body.extra_notes:
        html_parts.append(f"<p style='background:#FEF3C7;padding:8px;border-radius:6px'><b>Uwagi:</b> {body.extra_notes}</p>")
    # Podsumowanie cen
    html_parts.append("<div style='margin-top:14px;padding:12px;background:#F0FDF4;border:1px solid #10B98166;border-radius:8px'>")
    html_parts.append("<table style='width:100%;border-collapse:collapse;font-size:13px'>")
    html_parts.append(f"<tr><td style='padding:3px 0;color:#6B7280'>Suma cennika:</td><td style='text-align:right;font-variant-numeric:tabular-nums'>{subtotal:.2f} zł</td></tr>")
    html_parts.append(f"<tr><td style='padding:3px 0;color:#DC2626'>Rabat cateringu ({int(CATERING_DISCOUNT_PCT)}%):</td><td style='text-align:right;color:#DC2626;font-variant-numeric:tabular-nums'>-{discount:.2f} zł</td></tr>")
    html_parts.append(f"<tr><td style='padding:6px 0 0;border-top:1px solid #10B98188;font-weight:800;color:#065F46'>DO ZAPŁATY:</td><td style='padding:6px 0 0;border-top:1px solid #10B98188;text-align:right;font-weight:800;font-size:16px;color:#10B981;font-variant-numeric:tabular-nums'>{total_after:.2f} zł</td></tr>")
    html_parts.append("</table></div>")
    html_parts.append("<p style='margin-top:14px'>Pozdrawiam,<br>Biesiada pod Lasem</p>")
    html_parts.append("</div>")
    body_html = "".join(html_parts)

    from offer_email import send_offer_email as _send
    try:
        _send(
            to_email=body.to_email,
            subject=f"Zamówienie cateringowe — {ev_name} ({ev_date})",
            body_text=body_text,
            body_html=body_html,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Nie udało się wysłać maila: {e}")

    try:
        await log_change(user, "email", "event", event_id, f"Wysłano zamówienie cateringu do {body.to_email} · {ev_name}")
    except Exception:
        pass

    return {"ok": True, "to": body.to_email, "items_count": len(ordered),
            "subtotal": subtotal, "discount": discount, "total": total_after,
            "discount_pct": CATERING_DISCOUNT_PCT}


# ---------- Templates ----------
@api.get("/templates")
async def list_templates(user=Depends(current_user)):
    items = await db.templates.find({"owner_id": ws(user)}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api.post("/templates")
async def create_template(body: TemplateIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.delete("/templates/{tpl_id}")
async def delete_template(tpl_id: str, user=Depends(current_user)):
    await db.templates.delete_one({"id": tpl_id, "owner_id": ws(user)})
    return {"ok": True}

class ImportIcsIn(BaseModel):
    ics: str
    years_back: int = 5
    enrich_notes: bool = True  # If True, when a duplicate is found by UID/(date,name), update notes/location if empty

class ImportWhatsAppIn(BaseModel):
    text: str
    kind: str  # "expenses" | "revenue"

@api.post("/import/whatsapp")
async def import_whatsapp(body: ImportWhatsAppIn, user=Depends(current_user)):
    """Parse WhatsApp chat export and create expense/revenue entries.

    Line format: DD.MM.YYYY, HH:MM - Author: Message with amount (e.g. 428zl, 59,99, 300 zl)
    - kind='expenses' → creates entries in db.expenses (label + amount + date + created_by)
    - kind='revenue'  → tries to assign to an existing event on that date; otherwise creates
                        a new event with revenue set.
    """
    import re
    kind = (body.kind or "expenses").lower()
    if kind not in ("expenses", "revenue"):
        raise HTTPException(400, "kind musi być 'expenses' lub 'revenue'")

    line_re = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})\s*-\s*([^:]+):\s*(.+)$")
    amount_re = re.compile(r"([0-9]+(?:[.,][0-9]+)?)")
    skip_keywords = ("utworzył", "dodał", "zmienił", "zaszyfrowane", "Dodano", "usunął",
                     "Usunął", "Usunął", "<załącznik", "pominięto")

    parsed_count = 0
    created_count = 0
    matched_events = 0
    skipped = 0

    # Preload events for the workspace to try matching by date
    all_events = await db.events.find({"owner_id": ws(user)}, {"_id": 0, "id": 1, "date": 1, "revenue": 1}).to_list(5000)
    events_by_date: dict = {}
    for ev in all_events:
        events_by_date.setdefault(ev["date"], []).append(ev)

    for raw in body.text.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        m = line_re.match(line)
        if not m:
            continue
        parsed_count += 1
        d_, m_, y_, hh_, mm_, author, text = m.groups()
        date_iso = f"{int(y_):04d}-{int(m_):02d}-{int(d_):02d}"
        author = author.strip()
        text = text.strip()

        if any(k in text for k in skip_keywords) or not text:
            skipped += 1
            continue

        # Extract first amount
        am = amount_re.search(text)
        if not am:
            skipped += 1
            continue
        amount_str = am.group(1).replace(",", ".")
        try:
            amount = float(amount_str)
        except ValueError:
            skipped += 1
            continue
        if amount <= 0:
            skipped += 1
            continue

        # Label = text without leading verbs
        label = re.sub(r"^(?:Koszt|Zysk|Rata|Wypłata)\s*", "", text, flags=re.IGNORECASE).strip()
        if len(label) > 80:
            label = label[:80]

        if kind == "expenses":
            doc = {
                "id": str(uuid.uuid4()),
                "owner_id": ws(user),
                "created_by_id": user["id"],
                "created_by_name": author,
                "label": label or "Koszt",
                "amount": round(amount, 2),
                "date": date_iso,
                "category": "",
                "notes": f"Import z WhatsApp",
                "created_at": now_utc().isoformat(),
                "imported_source": "whatsapp",
            }
            await db.expenses.insert_one(doc)
            created_count += 1
        else:  # revenue
            evs = events_by_date.get(date_iso, [])
            if evs:
                # Add this revenue to the first event of that date
                ev = evs[0]
                new_rev = float(ev.get("revenue", 0)) + amount
                await db.events.update_one(
                    {"id": ev["id"], "owner_id": ws(user)},
                    {"$set": {"revenue": round(new_rev, 2)}},
                )
                ev["revenue"] = new_rev
                matched_events += 1
            else:
                # Create new event for that day with the revenue
                doc = {
                    "id": str(uuid.uuid4()),
                    "owner_id": ws(user),
                    "created_by_id": user["id"],
                    "created_by_name": author,
                    "name": label or "Impreza",
                    "date": date_iso,
                    "time": "",
                    "time_start": "",
                    "time_end": "",
                    "venue": "Biesiada pod lasem",
                    "notes": "Import z WhatsApp",
                    "category": "",
                    "people": 0,
                    "revenue": round(amount, 2),
                    "revenue_net": 0,
                    "costs": [],
                    "shifts": [],
                    "image_url": "",
                    "created_at": now_utc().isoformat(),
                    "imported_source": "whatsapp",
                }
                await db.events.insert_one(doc)
                events_by_date.setdefault(date_iso, []).append(doc)
                created_count += 1

    return {
        "ok": True,
        "parsed_lines": parsed_count,
        "created": created_count,
        "matched_existing_events": matched_events,
        "skipped": skipped,
    }

# ---------- Backup Export / Import ----------
class BackupIn(BaseModel):
    staff: List[dict] = []
    events: List[dict] = []
    templates: List[dict] = []
    mode: str = "merge"  # "merge" or "replace"

@api.get("/export/backup")
async def export_backup(user=Depends(require_admin)):
    staff = await db.staff.find({"owner_id": ws(user)}, {"_id": 0, "owner_id": 0}).to_list(5000)
    events = await db.events.find({"owner_id": ws(user)}, {"_id": 0, "owner_id": 0}).to_list(10000)
    templates = await db.templates.find({"owner_id": ws(user)}, {"_id": 0, "owner_id": 0}).to_list(5000)
    return {
        "app": "eventa",
        "version": 1,
        "exported_at": now_utc().isoformat(),
        "staff": staff,
        "events": events,
        "templates": templates,
    }

@api.post("/import/backup")
async def import_backup(body: BackupIn, user=Depends(current_user)):
    imported = {"staff": 0, "events": 0, "templates": 0}
    if body.mode == "replace":
        await db.staff.delete_many({"owner_id": ws(user)})
        await db.events.delete_many({"owner_id": ws(user)})
        await db.templates.delete_many({"owner_id": ws(user)})

    # Staff: keep original ids if provided (so shifts still match)
    for s in body.staff:
        doc = {k: v for k, v in s.items() if k != "_id"}
        doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.staff.update_one(
            {"id": doc["id"], "owner_id": ws(user)},
            {"$set": doc}, upsert=True,
        )
        imported["staff"] += 1
    for ev in body.events:
        doc = {k: v for k, v in ev.items() if k not in ("_id", "labor_cost", "material_cost", "total_cost", "profit")}
        doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.events.update_one(
            {"id": doc["id"], "owner_id": ws(user)},
            {"$set": doc}, upsert=True,
        )
        imported["events"] += 1
    for tpl in body.templates:
        doc = {k: v for k, v in tpl.items() if k != "_id"}
        doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.templates.update_one(
            {"id": doc["id"], "owner_id": ws(user)},
            {"$set": doc}, upsert=True,
        )
        imported["templates"] += 1
    return {"ok": True, "imported": imported}

@api.get("/export/calendar.ics")
async def export_ics(user=Depends(current_user)):
    return _build_ics_feed(await db.events.find({"owner_id": ws(user)}, {"_id": 0}).sort("date", 1).to_list(10000))


def _build_ics_feed(events: list) -> PlainTextResponse:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Biesiada pod lasem//PL//", "CALSCALE:GREGORIAN",
             "X-WR-CALNAME:Biesiada pod Lasem", "X-WR-TIMEZONE:Europe/Warsaw",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    for ev in events:
        date = str(ev.get("date", "")).replace("-", "")
        # Prefer new fields time_start/time_end, fall back to legacy `time`
        t_start = (ev.get("time_start") or ev.get("time") or "").strip()
        t_end = (ev.get("time_end") or "").strip()
        ts = t_start.replace(":", "")
        te = t_end.replace(":", "")
        if len(ts) >= 4 and len(date) == 8:
            try:
                hh = int(ts[:2]); mm = int(ts[2:4])
                start_dt = datetime(int(date[:4]), int(date[4:6]), int(date[6:8]), hh, mm)
                if len(te) >= 4:
                    hhe = int(te[:2]); mme = int(te[2:4])
                    end_dt = datetime(int(date[:4]), int(date[4:6]), int(date[6:8]), hhe, mme)
                    if end_dt <= start_dt:
                        end_dt = start_dt + timedelta(hours=4)
                else:
                    end_dt = start_dt + timedelta(hours=4)
                dtstart = start_dt.strftime("%Y%m%dT%H%M00")
                dtend = end_dt.strftime("%Y%m%dT%H%M00")
                dt_line = f"DTSTART;TZID=Europe/Warsaw:{dtstart}\r\nDTEND;TZID=Europe/Warsaw:{dtend}"
            except Exception:
                dt_line = f"DTSTART;VALUE=DATE:{date}"
        else:
            dt_line = f"DTSTART;VALUE=DATE:{date}"
        summary = str(ev.get("name", "Impreza")).replace("\n", " ")
        # Prefix status if set
        st_lbl = _status_label(ev.get("status") or "")
        if st_lbl and st_lbl != summary:
            summary = f"[{st_lbl}] {summary}"
        location = str(ev.get("venue", "")).replace("\n", " ")
        # Include client info in description if available
        desc_parts = []
        if ev.get("notes"): desc_parts.append(str(ev["notes"]))
        if ev.get("client_name"): desc_parts.append(f"Klient: {ev['client_name']}")
        if ev.get("client_phone"): desc_parts.append(f"Tel.: {ev['client_phone']}")
        if ev.get("people"): desc_parts.append(f"Osób: {ev.get('people')}")
        desc = " | ".join(desc_parts).replace("\n", "\\n").replace(",", "\\,")
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{ev.get('id')}@biesiada-pod-lasem")
        lines.append(dt_line)
        lines.append(f"SUMMARY:{summary}")
        if location: lines.append(f"LOCATION:{location}")
        if desc: lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines), media_type="text/calendar; charset=utf-8")


# ---- Public ICS feed URL (for Google Calendar / Apple Calendar subscription) ----
# Google Calendar polls the URL without auth headers, so we use a per-user secret token.

@api.get("/calendar/feed-url")
async def get_calendar_feed_url(user=Depends(current_user)):
    """Return the user's public ICS feed URL. Creates a token on first call."""
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "calendar_token": 1})
    token = (fresh or {}).get("calendar_token")
    if not token:
        token = uuid.uuid4().hex
        await db.users.update_one({"id": user["id"]}, {"$set": {"calendar_token": token}})
    return {"token": token, "path": f"/api/calendar/feed/{token}.ics"}


@api.post("/calendar/feed-url/rotate")
async def rotate_calendar_feed_url(user=Depends(current_user)):
    """Regenerate the token (invalidates any calendar subscriptions using the old URL)."""
    token = uuid.uuid4().hex
    await db.users.update_one({"id": user["id"]}, {"$set": {"calendar_token": token}})
    return {"token": token, "path": f"/api/calendar/feed/{token}.ics"}


@api.get("/calendar/feed/{token}.ics")
async def public_calendar_feed(token: str):
    """Public ICS feed, identified by per-user token in the URL. No auth headers."""
    if not token or len(token) < 16:
        raise HTTPException(404, "Not found")
    user = await db.users.find_one({"calendar_token": token}, {"_id": 0, "id": 1, "workspace_id": 1})
    if not user:
        raise HTTPException(404, "Not found")
    wsid = user.get("workspace_id") or user["id"]
    events = await db.events.find({"owner_id": wsid}, {"_id": 0}).sort("date", 1).to_list(10000)
    return _build_ics_feed(events)


# =====================================================================
# ---------- Google Calendar sync (OAuth + status/backfill) -----------
# =====================================================================

@api.get("/google-calendar/status")
async def gcal_status(user=Depends(current_user)):
    if not gcal.is_configured():
        return {"configured": False, "connected": False, "reason": "server_missing_credentials"}
    conn = await db.google_calendar_connections.find_one(
        {"user_id": user["id"]},
        {"_id": 0, "refresh_token_encrypted": 0}
    )
    return {
        "configured": True,
        "connected": bool(conn and not conn.get("revoked_at")),
        "connection": conn,
    }


@api.get("/google-calendar/oauth/start")
async def gcal_oauth_start(user=Depends(current_user)):
    if not gcal.is_configured():
        raise HTTPException(500, "Google Calendar nie jest skonfigurowany na serwerze")
    state = gcal.new_state()
    await db.oauth_states.insert_one({
        "state": state,
        "user_id": user["id"],
        "provider": "google_calendar",
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(minutes=10),
        "used": False,
    })
    return {"authorization_url": gcal.build_authorization_url(state)}


@api.get("/google-calendar/oauth/callback", include_in_schema=False)
async def gcal_oauth_callback(code: Optional[str] = None, state: Optional[str] = None,
                              error: Optional[str] = None):
    """Google redirects here after consent. We render a small HTML page that
    self-closes / deep-links back to the app."""
    def _html(status: str, msg: str) -> HTMLResponse:
        emoji = {"ok": "✅", "err": "❌", "denied": "⚠️"}.get(status, "ℹ️")
        return HTMLResponse(f"""
<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:#1F3A2E; color:#F8F5EE; min-height:100vh; margin:0;
        display:flex; align-items:center; justify-content:center; padding:24px; }}
.card {{ background:#294a3c; border:1px solid #3d6a55; border-radius:16px;
         padding:28px; max-width:420px; text-align:center; }}
.emoji {{ font-size:44px; margin-bottom:8px; }}
h1 {{ font-size:20px; margin:0 0 8px; }}
p {{ opacity:.9; line-height:1.5; margin:0 0 16px; }}
button {{ background:#D4AF37; color:#1F3A2E; border:0; padding:12px 20px;
          border-radius:999px; font-weight:700; font-size:14px; cursor:pointer; }}
</style></head><body><div class="card">
<div class="emoji">{emoji}</div><h1>Google Calendar</h1><p>{msg}</p>
<button onclick="window.close();history.back();">Wróć do aplikacji</button>
</div></body></html>
""")

    if error:
        return _html("denied", f"Anulowano lub odrzucono: {error}")
    if not code or not state:
        return _html("err", "Brak parametrów OAuth. Spróbuj ponownie z aplikacji.")

    row = await db.oauth_states.find_one_and_update(
        {"state": state, "used": False, "provider": "google_calendar"},
        {"$set": {"used": True, "used_at": now_utc()}},
    )
    if not row:
        return _html("err", "Nieprawidłowy lub użyty stan OAuth. Rozpocznij ponownie z aplikacji.")

    # Exchange code for tokens
    try:
        tokens = await gcal.exchange_code_for_tokens(code)
    except Exception as e:
        return _html("err", f"Wymiana kodu nie powiodła się: {e}")
    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    if not refresh_token:
        return _html("err", "Google nie zwrócił refresh_token. Wróć i spróbuj ponownie (z 'consent').")

    # Find or create dedicated calendar
    calendar_id: Optional[str] = None
    calendar_name: Optional[str] = None
    if access_token:
        try:
            existing = await gcal.find_calendar_by_summary(access_token, gcal.CAL_TITLE)
            if existing:
                calendar_id = existing.get("id")
                calendar_name = existing.get("summary")
            else:
                created = await gcal.create_dedicated_calendar(access_token)
                calendar_id = created.get("id")
                calendar_name = created.get("summary") or gcal.CAL_TITLE
        except Exception as e:
            return _html("err", f"Nie udało się utworzyć dedykowanego kalendarza: {e}")

    if not calendar_id:
        return _html("err", "Nie udało się przygotować dedykowanego kalendarza w Google.")

    await db.google_calendar_connections.update_one(
        {"user_id": row["user_id"]},
        {"$set": {
            "user_id": row["user_id"],
            "provider": "google",
            "refresh_token_encrypted": gcal.encrypt_token(refresh_token),
            "scope": tokens.get("scope", gcal.SCOPES),
            "calendar_id": calendar_id,
            "calendar_name": calendar_name,
            "connected_at": now_utc().isoformat(),
            "revoked_at": None,
        }}, upsert=True,
    )

    return _html("ok",
        f"Połączono z kalendarzem <strong>{calendar_name}</strong>.<br>"
        "Nowe imprezy będą się automatycznie zapisywać w Twoim Google Calendar.<br>"
        "Możesz zamknąć to okno i wrócić do aplikacji."
    )


@api.post("/google-calendar/disconnect")
async def gcal_disconnect(user=Depends(current_user)):
    await db.google_calendar_connections.update_one(
        {"user_id": user["id"]},
        {"$set": {"revoked_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@api.post("/google-calendar/backfill")
async def gcal_backfill(user=Depends(current_user)):
    """One-shot push of ALL of the workspace's events into the user's Google Calendar.
    Useful right after connect to bring the calendar up to date."""
    conn = await _get_gcal_conn(user["id"])
    if not conn:
        raise HTTPException(400, "Najpierw połącz Google Calendar")
    events = await db.events.find({"owner_id": ws(user)}, {"_id": 0}).sort("date", 1).to_list(5000)
    ok = 0; err = 0
    for ev in events:
        try:
            await _sync_event_to_google(user["id"], ev["id"], "upsert")
            ok += 1
        except Exception:
            err += 1
    return {"ok": True, "synced": ok, "failed": err, "total": len(events)}


@api.post("/import/ics")
async def import_ics(body: ImportIcsIn, user=Depends(current_user)):
    """Parse an iCal file and create events. Only events within the last N years are imported.

    Deduplication rules (all scoped to the current workspace):
      1. If VEVENT has a UID → dedup by ``imported_uid``.
      2. Otherwise (or if no UID match) fallback: skip when an event with the SAME
         (date, name) already exists — case-insensitive, name trimmed.
    """
    import re
    content = body.ics.replace("\r\n", "\n").replace("\r", "\n")
    # Unfold long lines (RFC 5545: lines starting with space/tab continue previous line)
    content = re.sub(r"\n[ \t]", "", content)
    lines = content.split("\n")

    events_raw = []
    current = None
    for raw in lines:
        line = raw.strip()
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            if current is not None:
                events_raw.append(current)
            current = None
        elif current is not None and ":" in line:
            key_part, value = line.split(":", 1)
            key = key_part.split(";")[0].upper()
            current[key] = value.strip()

    def parse_ics_date(v: str):
        v = v.strip()
        if len(v) >= 8 and v[:8].isdigit():
            y = int(v[:4]); m = int(v[4:6]); d = int(v[6:8])
            time_str = ""
            if "T" in v and len(v) >= 15:
                hh = v[9:11]; mm = v[11:13]
                if hh.isdigit() and mm.isdigit():
                    time_str = f"{hh}:{mm}"
            return f"{y:04d}-{m:02d}-{d:02d}", time_str
        return None, None

    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * max(1, body.years_back))).date()
    imported = 0
    enriched = 0
    skipped_old = 0
    skipped_dup_uid = 0
    skipped_dup_name = 0

    # Preload existing (date, name-lowercased) pairs for the workspace for O(1) fallback dedup
    existing_docs = await db.events.find(
        {"owner_id": ws(user)}, {"_id": 0, "id": 1, "date": 1, "name": 1, "imported_uid": 1, "notes": 1, "venue": 1}
    ).to_list(20000)
    # Build lookups
    uid_to_doc = {d.get("imported_uid"): d for d in existing_docs if d.get("imported_uid")}
    dn_to_doc = {(d.get("date", ""), (d.get("name") or "").strip().lower()): d for d in existing_docs}
    existing_uids = set(uid_to_doc.keys())
    existing_date_name = set(dn_to_doc.keys())

    async def _try_enrich(target_doc: dict, new_notes: str, new_venue: str):
        """If target's notes are empty and new_notes is non-empty, patch it. Same for venue."""
        updates = {}
        if new_notes and not (target_doc.get("notes") or "").strip():
            updates["notes"] = new_notes
        if new_venue and not (target_doc.get("venue") or "").strip():
            updates["venue"] = new_venue
        if updates:
            await db.events.update_one({"id": target_doc["id"], "owner_id": ws(user)}, {"$set": updates})
            return True
        return False

    for ev in events_raw:
        dtstart = ev.get("DTSTART", "")
        date_str, time_str = parse_ics_date(dtstart)
        if not date_str:
            continue
        try:
            ev_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except Exception:
            continue
        if ev_date < cutoff:
            skipped_old += 1
            continue

        dtend = ev.get("DTEND", "")
        _, time_end = parse_ics_date(dtend) if dtend else ("", "")

        name = (ev.get("SUMMARY") or "Impreza").strip()
        raw_notes = (ev.get("DESCRIPTION", "") or "").replace("\\n", "\n").replace("\\,", ",")
        raw_venue = (ev.get("LOCATION", "") or "")

        # Dedup 1: UID (if present)
        uid = ev.get("UID")
        if uid and uid in existing_uids:
            skipped_dup_uid += 1
            if body.enrich_notes:
                target = uid_to_doc.get(uid)
                if target and await _try_enrich(target, raw_notes, raw_venue):
                    enriched += 1
            continue

        # Dedup 2: same (date, name) already in DB
        dedup_key = (date_str, name.lower())
        if dedup_key in existing_date_name:
            skipped_dup_name += 1
            if body.enrich_notes:
                target = dn_to_doc.get(dedup_key)
                if target and await _try_enrich(target, raw_notes, raw_venue):
                    enriched += 1
            continue

        doc = {
            "id": str(uuid.uuid4()),
            "owner_id": ws(user),
            "created_by_id": user["id"],
            "created_by_name": user.get("name") or user.get("email", ""),
            "name": name,
            "date": date_str,
            "time": time_str,
            "time_start": time_str,
            "time_end": time_end or "",
            "venue": raw_venue,
            "notes": raw_notes,
            "category": "",
            "revenue": 0.0,
            "costs": [],
            "shifts": [],
            "image_url": "",
            "created_at": now_utc().isoformat(),
        }
        if uid:
            doc["imported_uid"] = uid
            existing_uids.add(uid)
        existing_date_name.add(dedup_key)

        await db.events.insert_one(doc)
        imported += 1

    return {
        "ok": True,
        "imported": imported,
        "enriched_notes": enriched,
        "skipped_older_than_cutoff": skipped_old,
        "skipped_duplicate_uid": skipped_dup_uid,
        "skipped_duplicate_name_date": skipped_dup_name,
        "total_parsed": len(events_raw),
    }

# ---------- Company Expenses ----------
@api.get("/expenses")
async def list_expenses(user=Depends(require_admin), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        q["date"] = {"$regex": f"^{year:04d}-{month:02d}"}
    elif year:
        q["date"] = {"$regex": f"^{year:04d}-"}
    items = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items

@api.post("/expenses")
async def create_expense(body: ExpenseIn, user=Depends(require_admin)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "expense", doc["id"], f"Dodano koszt: {doc.get('label','')} ({doc.get('amount',0)} zł)")
    return doc

@api.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseIn, user=Depends(require_admin)):
    res = await db.expenses.update_one(
        {"id": expense_id, "owner_id": ws(user)},
        {"$set": body.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Koszt nie znaleziony")
    doc = await db.expenses.find_one({"id": expense_id}, {"_id": 0})
    await log_change(user, "update", "expense", expense_id, f"Edytowano koszt: {doc.get('label','')} ({doc.get('amount',0)} zł)")
    return doc

@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(require_admin)):
    doc = await db.expenses.find_one({"id": expense_id, "owner_id": ws(user)}, {"_id": 0})
    await db.expenses.delete_one({"id": expense_id, "owner_id": ws(user)})
    if doc: await log_change(user, "delete", "expense", expense_id, f"Usunięto koszt: {doc.get('label','')} ({doc.get('amount',0)} zł)")
    return {"ok": True}

# ---------- Stats ----------
@api.get("/staff/wages")
async def staff_wages(user=Depends(require_admin), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    events = await db.events.find(q, {"_id": 0}).to_list(5000)
    staff_list = await db.staff.find({"owner_id": ws(user)}, {"_id": 0}).to_list(500)
    staff_map = {s["id"]: s for s in staff_list}

    totals: dict = {}
    for ev in events:
        for sh in ev.get("shifts", []):
            sid = sh.get("staff_id")
            s = staff_map.get(sid)
            if not s: continue
            hours = float(sh.get("hours", 0))
            amount = hours * float(s.get("hourly_rate", 0))
            row = totals.setdefault(sid, {
                "staff_id": sid, "name": s.get("name", ""), "role": s.get("role", ""),
                "hourly_rate": float(s.get("hourly_rate", 0)),
                "hours": 0.0, "amount": 0.0, "shifts": 0,
            })
            row["hours"] += hours
            row["amount"] += amount
            row["shifts"] += 1
    result = list(totals.values())
    for r in result:
        r["hours"] = round(r["hours"], 2)
        r["amount"] = round(r["amount"], 2)
    result.sort(key=lambda x: -x["amount"])
    return {
        "total_hours": round(sum(r["hours"] for r in result), 2),
        "total_amount": round(sum(r["amount"] for r in result), 2),
        "staff": result,
    }

@api.get("/schedule")
async def schedule(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    """Return per-date schedule with staff assignments (for grafik view)."""
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    events = await db.events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    staff_list = await db.staff.find({"owner_id": ws(user)}, {"_id": 0}).to_list(500)
    staff_map = {s["id"]: s for s in staff_list}
    by_date: dict = {}
    for ev in events:
        d = ev.get("date")
        entry = by_date.setdefault(d, {"date": d, "events": []})
        entry["events"].append({
            "id": ev["id"], "name": ev.get("name", ""), "time": ev.get("time", ""),
            "venue": ev.get("venue", ""), "category": ev.get("category", ""),
            "staff": [
                {
                    "staff_id": sh["staff_id"],
                    "name": staff_map.get(sh["staff_id"], {}).get("name", "?"),
                    "role": staff_map.get(sh["staff_id"], {}).get("role", ""),
                    "hours": float(sh.get("hours", 0)),
                    "amount": round(float(sh.get("hours", 0)) * float(staff_map.get(sh["staff_id"], {}).get("hourly_rate", 0)), 2),
                }
                for sh in ev.get("shifts", [])
            ],
        })
    return sorted(by_date.values(), key=lambda x: x["date"])


@api.get("/stats")
async def stats(user=Depends(require_admin), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    elif year:
        q["date"] = {"$regex": f"^{year:04d}-"}
    events = await db.events.find(q, {"_id": 0}).to_list(5000)
    staff_map = await load_owner_staff_map(user["id"])
    # Company-wide expenses in same period
    exp_q = {"owner_id": ws(user)}
    if year and month:
        exp_q["date"] = {"$regex": f"^{year:04d}-{month:02d}"}
    elif year:
        exp_q["date"] = {"$regex": f"^{year:04d}-"}
    expenses = await db.expenses.find(exp_q, {"_id": 0}).to_list(5000)
    company_expenses = round(sum(float(e.get("amount", 0)) for e in expenses), 2)

    total_revenue = 0.0
    total_material = 0.0
    total_labor = 0.0
    # Planned (future events with any price/revenue entered).
    # Rule: date >= today AND status != 'anulowana' AND (revenue > 0 OR price_total > 0)
    planned_revenue = 0.0
    planned_cost = 0.0
    cost_ratios = await _cost_ratios_by_category(ws(user))
    today_iso = datetime.now(timezone.utc).date().isoformat()
    per_event = []
    for ev in events:
        ev = await compute_event_summary(ev, staff_map, cost_ratios)
        st = (ev.get("status") or "").lower()
        is_cancelled = st == "anulowana"
        is_future = (ev.get("date") or "") >= today_iso
        rev = float(ev.get("revenue") or 0)
        price_total = float(ev.get("price_total") or 0)
        recorded_cost = float(ev.get("total_cost") or 0)
        if is_cancelled:
            pass
        elif is_future and (rev > 0 or price_total > 0):
            # Future event with any price → count as planned/forecast
            planned_revenue += rev or price_total
            planned_cost += recorded_cost if recorded_cost > 0 else float(ev.get("estimated_cost") or 0)
        else:
            # Past events (any status) → realized
            total_revenue += rev
            total_material += float(ev.get("material_cost") or 0)
            total_labor += float(ev.get("labor_cost") or 0)
        per_event.append({
            "id": ev["id"], "name": ev["name"], "date": ev["date"],
            "revenue": ev.get("revenue") or 0, "total_cost": ev.get("total_cost") or 0, "profit": ev.get("profit") or 0,
            "status": ev.get("status", ""),
        })
    total_cost = total_material + total_labor
    return {
        "event_count": len(events),
        "revenue": round(total_revenue, 2),
        "material_cost": round(total_material, 2),
        "labor_cost": round(total_labor, 2),
        "total_cost": round(total_cost, 2),
        "company_expenses": company_expenses,
        "profit": round(total_revenue - total_cost - company_expenses, 2),
        # ---- Forecast fields ----
        "planned_revenue": round(planned_revenue, 2),
        "planned_cost": round(planned_cost, 2),
        "planned_profit": round(planned_revenue - planned_cost, 2),
        "projected_total_revenue": round(total_revenue + planned_revenue, 2),
        "projected_total_cost": round(total_cost + company_expenses + planned_cost, 2),
        "projected_total_profit": round((total_revenue + planned_revenue) - (total_cost + company_expenses + planned_cost), 2),
        "events": per_event,
    }

# ---------- Export ----------
@api.get("/export/events")
async def export_events(user=Depends(require_admin), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    events = await db.events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    staff_map = await load_owner_staff_map(user["id"])
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Data", "Impreza", "Miejsce", "Przychód (PLN)", "Koszty materiałowe (PLN)", "Koszty pracy (PLN)", "Zysk (PLN)"])
    for ev in events:
        ev = await compute_event_summary(ev, staff_map)
        w.writerow([ev["date"], ev["name"], ev.get("venue", ""), ev["revenue"], ev["material_cost"], ev["labor_cost"], ev["profit"]])
    return PlainTextResponse(out.getvalue(), media_type="text/csv")


# ---------- Historical cost estimation (for forecasted net profit) ----------
async def _cost_ratios_by_category(owner_id: str) -> Dict[str, float]:
    """Return {category: avg_cost_ratio} based on past events with recorded costs.
    ratio = (material_cost + labor_cost) / revenue, for events with revenue > 0 and cost > 0.
    Fallback global ratio (mean of all sampled) is stored under key "__default__".
    """
    staff_map: Dict[str, dict] = {}
    async for s in db.staff.find({"owner_id": owner_id}, {"_id": 0}):
        staff_map[s["id"]] = s

    buckets: Dict[str, List[float]] = {}
    all_ratios: List[float] = []
    async for ev in db.events.find({"owner_id": owner_id}, {"_id": 0}):
        revenue = float(ev.get("revenue") or 0)
        if revenue <= 0:
            continue
        material = sum(float(c.get("amount", 0)) for c in (ev.get("costs") or []))
        labor = 0.0
        for sh in (ev.get("shifts") or []):
            s = staff_map.get(sh.get("staff_id"))
            if s:
                labor += float(sh.get("hours", 0)) * float(s.get("hourly_rate", 0))
        cost = material + labor
        if cost <= 0:
            continue
        ratio = min(cost / revenue, 1.0)
        cat = ev.get("category") or "__other__"
        buckets.setdefault(cat, []).append(ratio)
        all_ratios.append(ratio)

    out: Dict[str, float] = {}
    for cat, arr in buckets.items():
        arr_s = sorted(arr)
        if len(arr_s) >= 10:
            k = max(1, len(arr_s) // 10)
            arr_s = arr_s[k:-k]
        out[cat] = sum(arr_s) / len(arr_s) if arr_s else 0.35
    out["__default__"] = (sum(all_ratios) / len(all_ratios)) if all_ratios else 0.35
    return out


def _estimate_costs_for(ev: dict, ratios: Dict[str, float]) -> float:
    revenue = float(ev.get("revenue") or 0) or float(ev.get("price_total") or 0)
    if revenue <= 0:
        return 0.0
    cat = ev.get("category") or "__other__"
    r = ratios.get(cat, ratios.get("__default__", 0.35))
    return round(revenue * r, 2)


@api.get("/stats/cost-ratios")
async def get_cost_ratios(user=Depends(current_user)):
    """Return historical cost ratios per category (for UI transparency)."""
    ratios = await _cost_ratios_by_category(ws(user))
    return {k: round(v * 100, 1) for k, v in ratios.items()}


# ---------- XLSX export (full statistics) ----------
@api.get("/export/xlsx")
async def export_xlsx(user=Depends(require_admin), year: Optional[int] = None, month: Optional[int] = None):
    """Full Excel export: monthly summary, events (with forecasted net), expenses, staff shifts."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except Exception as e:
        raise HTTPException(500, f"openpyxl niedostępny: {e}")

    owner = ws(user)
    q_ev: dict = {"owner_id": owner}
    q_ex: dict = {"owner_id": owner}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q_ev["date"] = {"$regex": f"^{prefix}"}
        q_ex["date"] = {"$regex": f"^{prefix}"}

    events = await db.events.find(q_ev, {"_id": 0}).sort("date", 1).to_list(10000)
    expenses = await db.expenses.find(q_ex, {"_id": 0}).sort("date", 1).to_list(10000)
    staff_map = await load_owner_staff_map(user["id"])
    ratios = await _cost_ratios_by_category(owner)

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill("solid", fgColor="10B981")
    thin = Side(border_style="thin", color="D1D5DB")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    money_fmt = '#,##0.00" zł"'

    def _style_header(ws_, ncols: int):
        for col in range(1, ncols + 1):
            cell = ws_.cell(row=1, column=col)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border

    def _autosize(ws_):
        for col in ws_.columns:
            max_len = 0
            letter = col[0].column_letter
            for c in col:
                if c.value is None: continue
                l = len(str(c.value))
                if l > max_len: max_len = l
            ws_.column_dimensions[letter].width = min(max_len + 2, 50)

    # ---- Sheet 1: Podsumowanie miesięczne ----
    sm = wb.active
    sm.title = "Podsumowanie"
    sm.append(["Miesiąc", "Imprez", "Przychód (PLN)", "Koszty rzeczyw. (PLN)", "Zysk rzeczyw. (PLN)",
               "Koszty prognoz. (PLN)", "Zysk netto prognoz. (PLN)"])
    _style_header(sm, 7)
    from collections import defaultdict
    monthly = defaultdict(lambda: {"cnt": 0, "rev": 0.0, "cost_real": 0.0, "cost_est": 0.0})
    for ev in events:
        d = (ev.get("date") or "")[:7]
        if not d: continue
        rev = float(ev.get("revenue") or 0)
        material = sum(float(c.get("amount", 0)) for c in (ev.get("costs") or []))
        labor = 0.0
        for sh in (ev.get("shifts") or []):
            s = staff_map.get(sh.get("staff_id"))
            if s: labor += float(sh.get("hours", 0)) * float(s.get("hourly_rate", 0))
        real_cost = material + labor
        est_cost = real_cost if real_cost > 0 else _estimate_costs_for(ev, ratios)
        monthly[d]["cnt"] += 1
        monthly[d]["rev"] += rev
        monthly[d]["cost_real"] += real_cost
        monthly[d]["cost_est"] += est_cost
    for ex in expenses:
        d = (ex.get("date") or "")[:7]
        if not d: continue
        monthly[d]["cost_real"] += float(ex.get("amount") or 0)
        monthly[d]["cost_est"] += float(ex.get("amount") or 0)
    for mkey in sorted(monthly.keys()):
        b = monthly[mkey]
        sm.append([mkey, b["cnt"], b["rev"], b["cost_real"], b["rev"] - b["cost_real"], b["cost_est"], b["rev"] - b["cost_est"]])
    for col in (3, 4, 5, 6, 7):
        for r in range(2, sm.max_row + 1):
            sm.cell(row=r, column=col).number_format = money_fmt
    _autosize(sm)

    # ---- Sheet 2: Imprezy ----
    se = wb.create_sheet("Imprezy")
    se.append([
        "Data", "Nazwa", "Kategoria", "Pakiet", "Osób", "Status",
        "Klient", "Telefon", "Email",
        "Cena całkowita", "Rabat %", "Cena po rabacie", "Zaliczka",
        "Przychód", "Koszty materiał.", "Koszty pracy", "Zysk rzeczyw.",
        "Koszty prognoz.", "Zysk netto prognoz.", "Notatki",
    ])
    _style_header(se, 20)
    for ev in events:
        ev = await compute_event_summary(ev, staff_map)
        rev = float(ev.get("revenue") or 0)
        real_cost = float(ev.get("total_cost") or 0)
        est_cost = real_cost if real_cost > 0 else _estimate_costs_for(ev, ratios)
        se.append([
            ev.get("date", ""), ev.get("name", ""), ev.get("category", ""),
            ev.get("package_set", ""), ev.get("people", 0), ev.get("status", ""),
            ev.get("client_name", ""), ev.get("client_phone", ""), ev.get("client_email", ""),
            float(ev.get("price_total") or 0), float(ev.get("discount_pct") or 0),
            float(ev.get("price_after_discount") or ev.get("price_total") or 0),
            float(ev.get("deposit_amount") or 0),
            rev, float(ev.get("material_cost") or 0), float(ev.get("labor_cost") or 0),
            ev.get("profit", 0), est_cost, rev - est_cost,
            (ev.get("notes") or "")[:500],
        ])
    for col in (10, 12, 13, 14, 15, 16, 17, 18, 19):
        for r in range(2, se.max_row + 1):
            se.cell(row=r, column=col).number_format = money_fmt
    _autosize(se)

    # ---- Sheet 3: Wydatki ----
    sw = wb.create_sheet("Wydatki")
    sw.append(["Data", "Kategoria", "Nazwa", "Kwota (PLN)", "Notatki"])
    _style_header(sw, 5)
    for ex in expenses:
        sw.append([ex.get("date", ""), ex.get("category", ""), ex.get("label", ""),
                   float(ex.get("amount") or 0), ex.get("notes", "")])
    for r in range(2, sw.max_row + 1):
        sw.cell(row=r, column=4).number_format = money_fmt
    _autosize(sw)

    # ---- Sheet 4: Grafik pracowników ----
    sh_ws = wb.create_sheet("Grafik")
    sh_ws.append(["Data", "Impreza", "Pracownik", "Godziny", "Stawka/h", "Koszt (PLN)"])
    _style_header(sh_ws, 6)
    for ev in events:
        for sh in (ev.get("shifts") or []):
            s = staff_map.get(sh.get("staff_id"))
            rate = float((s or {}).get("hourly_rate", 0))
            hours = float(sh.get("hours", 0))
            sh_ws.append([ev.get("date", ""), ev.get("name", ""),
                          (s or {}).get("name", "?"), hours, rate, round(hours * rate, 2)])
    for col in (5, 6):
        for r in range(2, sh_ws.max_row + 1):
            sh_ws.cell(row=r, column=col).number_format = money_fmt
    _autosize(sh_ws)

    # ---- Sheet 5: Estymacja (referencyjna) ----
    sr = wb.create_sheet("Estymacja")
    sr.append(["Kategoria", "Średni % kosztów", "Uwagi"])
    _style_header(sr, 3)
    for cat, r in sorted(ratios.items()):
        if cat == "__default__":
            sr.append(["(średnia ogólna)", round(r * 100, 1), "Fallback dla imprez bez kategorii"])
        else:
            sr.append([cat, round(r * 100, 1), "Z historii imprez z zapisanymi kosztami"])
    _autosize(sr)

    buf = io.BytesIO()
    wb.save(buf)
    filename = f"eventa-stats-{year}-{month:02d}.xlsx" if year and month else "eventa-stats.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.get("/")
async def root():
    return {"app": "Eventa", "ok": True}


# ---------- Weather (multi-provider with fallbacks, no API key required) ----------
KIELCE_ZASTAWIE_LAT = 50.83
KIELCE_ZASTAWIE_LON = 20.68

# In-memory cache to avoid hitting provider rate limits.
# Key: (date, h_start, h_end); Value: (fetched_at_utc, payload_dict)
_WEATHER_CACHE: dict = {}
_WEATHER_TTL_SECONDS = 60 * 60  # 1 hour for successful results
_WEATHER_NEG_TTL_SECONDS = 5 * 60  # 5 minutes for "unavailable" results

_WMO = {
    0: ("sun", "Bezchmurnie", False),
    1: ("sun", "Głównie słonecznie", False),
    2: ("cloud-sun", "Częściowe zachmurzenie", False),
    3: ("cloud", "Zachmurzenie", False),
    45: ("cloud-drizzle", "Mgła", False),
    48: ("cloud-drizzle", "Osadzająca się szadź", False),
    51: ("cloud-drizzle", "Lekka mżawka", True),
    53: ("cloud-drizzle", "Mżawka", True),
    55: ("cloud-rain", "Gęsta mżawka", True),
    61: ("cloud-rain", "Lekki deszcz", True),
    63: ("cloud-rain", "Deszcz", True),
    65: ("cloud-rain", "Ulewny deszcz", True),
    71: ("cloud-snow", "Lekkie opady śniegu", True),
    73: ("cloud-snow", "Opady śniegu", True),
    75: ("cloud-snow", "Silne opady śniegu", True),
    80: ("cloud-rain", "Lekkie przelotne opady", True),
    81: ("cloud-rain", "Przelotne opady", True),
    82: ("cloud-rain", "Ulewne przelotne opady", True),
    85: ("cloud-snow", "Przelotne opady śniegu", True),
    86: ("cloud-snow", "Silne przelotne opady śniegu", True),
    95: ("cloud-lightning", "Burza", True),
    96: ("cloud-lightning", "Burza z gradem", True),
    99: ("cloud-lightning", "Silna burza z gradem", True),
}

# ---- Provider helpers ----
async def _wx_open_meteo(cli, date: str, h_start: int, h_end: int):
    """Primary provider: Open-Meteo (best quality, but daily rate-limited on shared IPs)."""
    params = {
        "latitude": KIELCE_ZASTAWIE_LAT,
        "longitude": KIELCE_ZASTAWIE_LON,
        "hourly": "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code",
        "timezone": "Europe/Warsaw",
        "start_date": date,
        "end_date": date,
    }
    resp = await cli.get("https://api.open-meteo.com/v1/forecast", params=params,
                         headers={"User-Agent": "BiesiadaPodLasem/1.0 (kontakt.biesiadapodlasem@gmail.com)"})
    if resp.status_code == 429:
        raise RuntimeError("open-meteo rate limited")
    resp.raise_for_status()
    data = resp.json()
    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    precs = hourly.get("precipitation_probability") or []
    winds = hourly.get("wind_speed_10m") or []
    codes = hourly.get("weather_code") or []
    idx = [i for i, t in enumerate(times) if h_start <= int(t.split("T")[1].split(":")[0]) <= h_end]
    if not idx: idx = list(range(len(times)))
    def _pick(arr): return [arr[i] for i in idx if i < len(arr) and arr[i] is not None]
    tmin = min(_pick(temps)) if _pick(temps) else None
    tmax = max(_pick(temps)) if _pick(temps) else None
    pmax = max(_pick(precs)) if _pick(precs) else 0
    wmax = max(_pick(winds)) if _pick(winds) else 0
    code_slice = [codes[i] for i in idx if i < len(codes)]
    dominant = max(set(code_slice), key=code_slice.count) if code_slice else 0
    return {"temp_min": tmin, "temp_max": tmax, "precipitation_prob": pmax,
            "wind_kmh": wmax, "code": dominant, "source": "open-meteo"}


# WMO code mapping for 7timer weather strings
_SEVENTIMER_MAP = {
    "clearday": 0, "clearnight": 0,
    "pcloudyday": 1, "pcloudynight": 1,
    "mcloudyday": 2, "mcloudynight": 2,
    "cloudyday": 3, "cloudynight": 3,
    "humidday": 3, "humidnight": 3,
    "lightrainday": 61, "lightrainnight": 61,
    "oshowerday": 80, "oshowernight": 80,
    "ishowerday": 81, "ishowernight": 81,
    "lightsnowday": 71, "lightsnownight": 71,
    "rainday": 63, "rainnight": 63,
    "snowday": 73, "snownight": 73,
    "rainsnowday": 68, "rainsnownight": 68,
    "tsday": 95, "tsnight": 95,
    "tsrainday": 95, "tsrainnight": 95,
    "fogday": 45, "fognight": 45,
}

async def _wx_7timer(cli, date: str, h_start: int, h_end: int):
    """Fallback: 7Timer! (civil forecast, 8 days ahead, 3h resolution)."""
    url = f"https://www.7timer.info/bin/civil.php?lon={KIELCE_ZASTAWIE_LON}&lat={KIELCE_ZASTAWIE_LAT}&ac=0&unit=metric&output=json&tzshift=0"
    resp = await cli.get(url, follow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    init_s = str(data.get("init") or "")
    # init format: YYYYMMDDHH (UTC)
    if len(init_s) != 10:
        raise RuntimeError("bad 7timer init")
    init_dt = datetime.strptime(init_s, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    ds = data.get("dataseries") or []
    target = datetime.strptime(date, "%Y-%m-%d").date()
    # Warsaw = UTC+2 in summer; use naive local match against timepoint hour
    temps, precs, winds, codes = [], [], [], []
    for entry in ds:
        tp = int(entry.get("timepoint") or 0)
        fdt_utc = init_dt + timedelta(hours=tp)
        # Convert to Warsaw local (approx +2h summer, +1h winter — use +2 as safe bet)
        fdt_local = fdt_utc + timedelta(hours=2)
        if fdt_local.date() != target: continue
        hh = fdt_local.hour
        if hh < h_start or hh > h_end: continue
        temps.append(entry.get("temp2m"))
        # 7timer uses cloudcover 1-9 scale and prec_type
        prec_type = entry.get("prec_type") or "none"
        prec_amount = entry.get("prec_amount") or 0
        prob = 0
        if prec_type != "none":
            # rough: prec_amount 1..9 → 20..90%
            try: prob = min(90, 20 + int(prec_amount) * 10)
            except: prob = 40
        precs.append(prob)
        w = (entry.get("wind10m") or {})
        try: winds.append(int(w.get("speed") or 0) * 3)  # 7timer speed 1-8 scale → rough km/h
        except: winds.append(0)
        codes.append(_SEVENTIMER_MAP.get(entry.get("weather") or "", 3))
    if not temps:
        raise RuntimeError("7timer: no matching hours")
    temps_f = [t for t in temps if t is not None]
    return {
        "temp_min": min(temps_f) if temps_f else None,
        "temp_max": max(temps_f) if temps_f else None,
        "precipitation_prob": max(precs) if precs else 0,
        "wind_kmh": max(winds) if winds else 0,
        "code": max(set(codes), key=codes.count) if codes else 3,
        "source": "7timer",
    }


async def _wx_wttr(cli, date: str, h_start: int, h_end: int):
    """Fallback #2: wttr.in (0-3 days ahead)."""
    url = f"https://wttr.in/{KIELCE_ZASTAWIE_LAT},{KIELCE_ZASTAWIE_LON}?format=j1"
    resp = await cli.get(url, headers={"Accept": "application/json"})
    resp.raise_for_status()
    data = resp.json()
    days = data.get("weather") or []
    day = next((d for d in days if d.get("date") == date), None)
    if not day:
        raise RuntimeError("wttr.in: no matching date")
    hourly = day.get("hourly") or []
    temps, precs, winds, codes = [], [], [], []
    for h in hourly:
        try: hr = int(h.get("time") or "0") // 100
        except: hr = 0
        if hr < h_start or hr > h_end: continue
        try: temps.append(float(h.get("tempC")))
        except: pass
        try: precs.append(float(h.get("chanceofrain") or 0))
        except: pass
        try: winds.append(float(h.get("windspeedKmph") or 0))
        except: pass
        # wttr weatherCode → WMO approximate mapping
        try:
            wc = int(h.get("weatherCode") or 113)
            if wc == 113: codes.append(0)
            elif wc in (116,): codes.append(2)
            elif wc in (119, 122): codes.append(3)
            elif wc in (143, 248, 260): codes.append(45)
            elif wc in (176, 263, 266, 293, 296, 353): codes.append(61)
            elif wc in (302, 308, 356, 359): codes.append(65)
            elif wc in (179, 227, 230, 320, 323, 326, 329, 332, 335, 338, 368, 371): codes.append(73)
            elif wc in (200, 386, 389, 392, 395): codes.append(95)
            else: codes.append(3)
        except: codes.append(3)
    if not temps:
        raise RuntimeError("wttr.in: no matching hours")
    return {
        "temp_min": min(temps),
        "temp_max": max(temps),
        "precipitation_prob": max(precs) if precs else 0,
        "wind_kmh": max(winds) if winds else 0,
        "code": max(set(codes), key=codes.count) if codes else 3,
        "source": "wttr.in",
    }


@api.get("/weather")
async def weather_forecast(date: str, time_start: str = "", time_end: str = ""):
    import httpx
    try:
        target = datetime.strptime(date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Nieprawidłowa data (YYYY-MM-DD)")
    today = datetime.now(timezone.utc).date()
    days_ahead = (target - today).days
    if days_ahead < 0:
        return {"available": False, "message": "Prognoza dla wydarzeń z przeszłości nie jest dostępna."}
    if days_ahead > 15:
        return {"available": False, "message": "Prognoza będzie dostępna bliżej terminu imprezy (do 16 dni)."}

    def h(t: str):
        try: return int(t.split(":")[0])
        except: return None
    h_start = h(time_start) if time_start else 12
    h_end = h(time_end) if time_end else (h_start or 12) + 4
    if h_start is None or h_end is None or h_end < h_start:
        h_start = 12; h_end = 20
    h_end = min(h_end, 23)

    # Cache check (both positive and negative)
    cache_key = (date, h_start, h_end)
    cached = _WEATHER_CACHE.get(cache_key)
    if cached:
        fetched_at, payload = cached
        age = (now_utc() - fetched_at).total_seconds()
        ttl = _WEATHER_TTL_SECONDS if payload.get("available") else _WEATHER_NEG_TTL_SECONDS
        if age < ttl:
            return payload

    # Try providers in order until one succeeds
    providers = [_wx_open_meteo, _wx_7timer]
    if days_ahead <= 3:
        providers.append(_wx_wttr)
    result = None
    last_err = None
    async with httpx.AsyncClient(timeout=8.0) as cli:
        for fn in providers:
            try:
                result = await fn(cli, date, h_start, h_end)
                if result: break
            except Exception as e:
                last_err = e
                logging.getLogger("weather").info(f"Provider {fn.__name__} failed: {e}")
                continue

    if not result:
        # Different message based on how far ahead
        if days_ahead > 8:
            msg = "Prognoza dokładna dostępna do 8 dni przed imprezą. Sprawdź ponownie za kilka dni."
        else:
            msg = "Prognoza chwilowo niedostępna — spróbuj ponownie za chwilę."
        payload = {"available": False, "message": msg}
        _WEATHER_CACHE[cache_key] = (now_utc(), payload)
        return payload

    dominant = result["code"] or 0
    icon, desc, is_rainy = _WMO.get(dominant, ("cloud", "Nieznane", False))
    prec_max = result.get("precipitation_prob") or 0
    wind_max = result.get("wind_kmh") or 0
    warning = None
    if is_rainy and prec_max >= 30:
        warning = f"⚠ Możliwy deszcz podczas imprezy ({int(prec_max)}% szans)."
    elif wind_max >= 40:
        warning = f"⚠ Silny wiatr do {int(wind_max)} km/h."
    payload = {
        "available": True,
        "location": "Kielce, ul. Zastawie 4",
        "date": date,
        "time_window": f"{h_start:02d}:00–{h_end:02d}:00",
        "temp_min": round(result["temp_min"], 1) if result.get("temp_min") is not None else None,
        "temp_max": round(result["temp_max"], 1) if result.get("temp_max") is not None else None,
        "precipitation_prob": int(prec_max),
        "wind_kmh": int(wind_max),
        "code": dominant,
        "icon": icon,
        "description": desc,
        "warning": warning,
        "source": result.get("source"),
    }
    _WEATHER_CACHE[cache_key] = (now_utc(), payload)
    return payload


# =====================================================================
# ---------- Alerts (2-day auto reminders for tentative bookings) -----
# =====================================================================
# When an event is in status "wstepne" (preliminary inquiry) or "rezerwacja"
# (reservation) and has been sitting untouched for 2+ days without being
# confirmed, the system creates an in-app alert AND sends an email to the
# workspace owner. Alerts are deduplicated per (event_id, kind).

# Which statuses should be tracked
_TRACKED_STATUSES = {"wstepne", "rezerwacja"}
_ALERT_AGE_DAYS = 2  # trigger threshold


def _status_label(s: str) -> str:
    return {
        "wstepne": "Wstępne zapytanie",
        "rezerwacja": "Rezerwacja",
        "potwierdzona": "Potwierdzona",
        "zakonczona": "Zakończona",
        "anulowana": "Anulowana",
    }.get(s or "", s or "")


async def _send_alert_email(owner_email: str, owner_name: str, alerts_for_owner: List[dict]):
    """Send a single digest email listing all overdue tentative events."""
    if not owner_email or not alerts_for_owner:
        return
    try:
        from offer_email import send_offer_email  # reuse SMTP helper
    except Exception as e:
        logging.getLogger("alerts").warning(f"offer_email import failed: {e}")
        return

    rows_txt = []
    rows_html = []
    for a in alerts_for_owner:
        ev_name = a.get("event_name") or "(bez nazwy)"
        ev_date = a.get("event_date") or "?"
        st = _status_label(a.get("status"))
        client = a.get("client_name") or a.get("client_phone") or "-"
        rows_txt.append(f"• {ev_name} — {ev_date} — status: {st} — klient: {client}")
        rows_html.append(
            f"<li><strong>{ev_name}</strong> — {ev_date} — <em>{st}</em> — klient: {client}</li>"
        )
    body_txt = (
        f"Cześć {owner_name or ''}!\n\n"
        f"Poniższe imprezy mają status \"wstępne zapytanie\" lub \"rezerwacja\" "
        f"od co najmniej {_ALERT_AGE_DAYS} dni i wciąż nie są potwierdzone:\n\n"
        + "\n".join(rows_txt) + "\n\n"
        "Rozważ kontakt z klientem lub zmianę statusu, aby zwolnić terminy w kalendarzu.\n\n"
        "— Biesiada pod Lasem"
    )
    body_html = (
        f"<p>Cześć {owner_name or ''}!</p>"
        f"<p>Poniższe imprezy mają status <em>wstępne zapytanie</em> lub <em>rezerwacja</em> "
        f"od co najmniej <strong>{_ALERT_AGE_DAYS} dni</strong> i wciąż nie są potwierdzone:</p>"
        f"<ul>{''.join(rows_html)}</ul>"
        "<p>Rozważ kontakt z klientem lub zmianę statusu, aby zwolnić terminy w kalendarzu.</p>"
        "<p>— Biesiada pod Lasem</p>"
    )
    try:
        # Run blocking SMTP call in a thread
        import asyncio as _asyncio
        await _asyncio.to_thread(
            send_offer_email,
            to_email=owner_email,
            subject=f"🔔 {len(alerts_for_owner)} niepotwierdzon" + ("a impreza" if len(alerts_for_owner) == 1 else "e imprezy") + " — Biesiada pod Lasem",
            body_text=body_txt,
            body_html=body_html,
        )
    except Exception as e:
        logging.getLogger("alerts").warning(f"Alert email failed to {owner_email}: {e}")


async def scan_and_create_alerts():
    """Scan all events across all workspaces and create alerts for stale tentative bookings."""
    log = logging.getLogger("alerts")
    try:
        threshold = now_utc() - timedelta(days=_ALERT_AGE_DAYS)
        threshold_iso = threshold.isoformat()

        # Find candidate events: status in tracked set, not already alerted
        cursor = db.events.find(
            {
                "status": {"$in": list(_TRACKED_STATUSES)},
                "created_at": {"$lte": threshold_iso},
                "$or": [{"alert_sent": {"$exists": False}}, {"alert_sent": False}],
            },
            {"_id": 0}
        )
        pending_by_owner: dict = {}
        touched_event_ids: List[str] = []
        async for ev in cursor:
            owner_id = ev.get("owner_id")
            if not owner_id: continue
            # Skip if event is already in the past (already resolved by time)
            ev_date = ev.get("date") or ""
            try:
                if datetime.strptime(ev_date, "%Y-%m-%d").date() < now_utc().date():
                    continue
            except Exception:
                pass
            # Skip if valid_until has passed (user already knows it's expired)
            # (keep alert though — but don't duplicate)

            # Create alert doc if not exists
            existing = await db.alerts.find_one({"event_id": ev.get("id"), "kind": "stale_status"})
            if not existing:
                alert_doc = {
                    "id": str(uuid.uuid4()),
                    "owner_id": owner_id,
                    "event_id": ev.get("id"),
                    "event_name": ev.get("name") or "",
                    "event_date": ev_date,
                    "status": ev.get("status") or "",
                    "kind": "stale_status",
                    "client_name": ev.get("client_name") or "",
                    "client_phone": ev.get("client_phone") or "",
                    "created_at": now_utc().isoformat(),
                    "dismissed": False,
                    "emailed": False,
                }
                await db.alerts.insert_one(alert_doc)
                pending_by_owner.setdefault(owner_id, []).append(alert_doc)
                touched_event_ids.append(ev.get("id"))

        # Mark events as alerted (so we don't re-scan them)
        if touched_event_ids:
            await db.events.update_many(
                {"id": {"$in": touched_event_ids}},
                {"$set": {"alert_sent": True, "alert_sent_at": now_utc().isoformat()}}
            )

        # Send digest email per workspace owner (find workspace owner's email)
        for owner_id, alerts in pending_by_owner.items():
            # workspace owner = user whose id == owner_id (the workspace root user)
            owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "password_hash": 0})
            if not owner:
                # owner_id might be a workspace id; find any member and pick the "root"
                owner = await db.users.find_one({"workspace_id": owner_id}, {"_id": 0, "password_hash": 0})
            if not owner:
                continue
            await _send_alert_email(owner.get("email") or "", owner.get("name") or "", alerts)
            # Mark alerts as emailed
            await db.alerts.update_many(
                {"id": {"$in": [a["id"] for a in alerts]}},
                {"$set": {"emailed": True}}
            )
        if pending_by_owner:
            log.info(f"Alerts scan: created {sum(len(v) for v in pending_by_owner.values())} alert(s) for {len(pending_by_owner)} owner(s)")
    except Exception as e:
        log.exception(f"scan_and_create_alerts failed: {e}")


@api.get("/alerts")
async def list_alerts(user=Depends(current_user)):
    """List active (not-dismissed) alerts for the current workspace, newest first."""
    items = await db.alerts.find(
        {"owner_id": ws(user), "dismissed": {"$ne": True}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return items


@api.post("/alerts/{alert_id}/dismiss")
async def dismiss_alert(alert_id: str, user=Depends(current_user)):
    res = await db.alerts.update_one(
        {"id": alert_id, "owner_id": ws(user)},
        {"$set": {"dismissed": True, "dismissed_at": now_utc().isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Alert nie znaleziony")
    return {"ok": True}


@api.post("/alerts/dismiss-all")
async def dismiss_all_alerts(user=Depends(current_user)):
    await db.alerts.update_many(
        {"owner_id": ws(user), "dismissed": {"$ne": True}},
        {"$set": {"dismissed": True, "dismissed_at": now_utc().isoformat()}}
    )
    return {"ok": True}


@api.post("/alerts/scan")
async def alerts_scan_now(user=Depends(current_user)):
    """Trigger the alerts scan immediately (useful for testing / manual refresh)."""
    await scan_and_create_alerts()
    return {"ok": True}


# ---------- Activity alerts (event created / deleted) ----------
async def _create_activity_alert(kind: str, owner_id: str, event: dict, actor: dict):
    """kind ∈ {'event_created','event_deleted'}. Non-fatal on errors."""
    try:
        doc = {
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "event_id": event.get("id"),
            "event_name": event.get("name") or "",
            "event_date": event.get("date") or "",
            "status": event.get("status") or "",
            "kind": kind,
            "actor_id": actor.get("id"),
            "actor_name": actor.get("name") or actor.get("email") or "",
            "client_name": event.get("client_name") or "",
            "created_at": now_utc().isoformat(),
            "dismissed": False,
            "emailed": True,  # activity alerts are in-app only, no email needed
        }
        await db.alerts.insert_one(doc)
    except Exception as e:
        logging.getLogger("alerts").warning(f"activity alert failed: {e}")


# ---------- Menu customization (editable prices + custom items) ----------
class MenuSettingsIn(BaseModel):
    model_config = {"extra": "allow"}
    dinner_price_overrides: Optional[Dict[str, float]] = None   # {item_id: new_price}
    dinner_cost_overrides: Optional[Dict[str, float]] = None    # {item_id: new_cost_price}
    dinner_custom_items: Optional[List[dict]] = None            # user-added dinner items
    grill_price_overrides: Optional[Dict[str, float]] = None    # {set_id: new_price/person}
    recipe_overrides: Optional[Dict[str, List[dict]]] = None    # recipe_key -> [ingredient,...]
    fixed_per_event: Optional[List[dict]] = None                # override fixed per-event items


@api.get("/menu-settings")
async def get_menu_settings(user=Depends(require_admin)):
    """Return per-workspace menu customizations (empty defaults if not saved yet)."""
    doc = await db.menu_settings.find_one({"owner_id": ws(user)}, {"_id": 0}) or {}
    return {
        "dinner_price_overrides": doc.get("dinner_price_overrides") or {},
        "dinner_cost_overrides":  doc.get("dinner_cost_overrides") or {},
        "dinner_custom_items":    doc.get("dinner_custom_items") or [],
        "grill_price_overrides":  doc.get("grill_price_overrides") or {},
        "recipe_overrides":       doc.get("recipe_overrides") or {},
        "fixed_per_event":        doc.get("fixed_per_event") or [],
        "updated_at":             doc.get("updated_at") or "",
    }


@api.put("/menu-settings")
async def put_menu_settings(body: MenuSettingsIn, user=Depends(require_admin)):
    """Upsert menu customizations for the current workspace."""
    payload = {
        "owner_id": ws(user),
        "dinner_price_overrides": body.dinner_price_overrides or {},
        "dinner_cost_overrides":  body.dinner_cost_overrides or {},
        "dinner_custom_items":    body.dinner_custom_items or [],
        "grill_price_overrides":  body.grill_price_overrides or {},
        "recipe_overrides":       body.recipe_overrides or {},
        "fixed_per_event":        body.fixed_per_event or [],
        "updated_at":             now_utc().isoformat(),
    }
    await db.menu_settings.update_one(
        {"owner_id": ws(user)}, {"$set": payload}, upsert=True
    )
    try:
        await log_change(user, "update", "menu_settings", "", "Zaktualizowano cennik menu")
    except Exception:
        pass
    return {"ok": True, **payload}


import re as _re

_WA_DATE_MSG = _re.compile(
    r'(\d{1,2}\.\d{1,2}\.\d{4}),\s+\d{1,2}:\d{2}\s*-\s*([^:]+?):\s*(.*?)(?=\s\d{1,2}\.\d{1,2}\.\d{4},\s+\d{1,2}:\d{2}\s*-|$)',
    _re.DOTALL,
)
_WA_OVERRIDE_DATE = _re.compile(
    r'\((?:data\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\)|(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?!\d)'
)
_WA_SKIP_PHRASES = [
    "wiadomości i rozmowy", "utworzyłeś", "utworzyles", "dodano:", "zmieniłeś", "zmieniles",
    "ikonę grupy", "ikone grupy", "wiadomość została usunięta", "usunąłeś", "usunales",
    "opłacało się", "oplacalo sie",
]

def _parse_whatsapp_profits(text: str) -> List[dict]:
    text = (text or "").replace("\r", "").replace("\n", " ")
    results = []
    for m in _WA_DATE_MSG.finditer(text):
        date_str, author, msg = m.group(1), m.group(2).strip(), m.group(3).strip()
        msg_low = msg.lower()
        if any(p in msg_low for p in _WA_SKIP_PHRASES):
            continue
        if not msg:
            continue
        d, mo, y = date_str.split(".")
        y_int, mo_int, d_int = int(y), int(mo), int(d)
        iso = f"{y_int:04d}-{mo_int:02d}-{d_int:02d}"
        amt = None
        for cand in _re.finditer(r'(\d{1,6}(?:[.,]\d{1,2})?)(?:\s*(?:zł|zl|pln))?', msg):
            raw = cand.group(1)
            val = float(raw.replace(",", "."))
            if val < 100 or val == y_int:
                continue
            after = msg[cand.end():cand.end()+12].lower()
            if after.strip().startswith("%"):
                continue
            amt = val
            break
        if amt is None:
            continue
        # date override
        override_iso = None
        for om in _WA_OVERRIDE_DATE.finditer(msg):
            g = om.groups()
            dd, mm, yy = None, None, None
            if g[0] and g[1]:
                dd, mm, yy = int(g[0]), int(g[1]), int(g[2]) if g[2] else None
            elif g[3] and g[4]:
                dd, mm, yy = int(g[3]), int(g[4]), int(g[5]) if g[5] else None
            if dd and mm:
                if not yy:
                    yy = y_int
                if 1 <= dd <= 31 and 1 <= mm <= 12 and 2020 <= yy <= 2030:
                    override_iso = f"{yy:04d}-{mm:02d}-{dd:02d}"
                    break
        results.append({
            "date": override_iso or iso,
            "amount": amt,
            "msg": msg[:200],
            "override": bool(override_iso),
        })
    return results


class WhatsAppProfitImportIn(BaseModel):
    content: str
    dry_run: bool = True
    window_days: int = 7


@api.post("/import/whatsapp-profits")
async def import_whatsapp_profits(body: WhatsAppProfitImportIn, user=Depends(current_user)):
    """
    Parse a WhatsApp chat export and attach profit amounts to events in the workspace.
    - Matches each profit entry to the closest event within `window_days`.
    - Idempotent: entries already applied (dedup key = date|amount|msg_hash) are skipped.
    - `dry_run=True` returns a preview without changes.
    """
    entries = _parse_whatsapp_profits(body.content)
    # Load all events in this workspace
    events = await db.events.find(
        {"owner_id": ws(user)},
        {"_id": 0, "id": 1, "name": 1, "date": 1, "revenue": 1, "category": 1, "whatsapp_profits": 1}
    ).sort("date", 1).to_list(None)

    # Build a set of already-applied entry keys per event to prevent double-import
    already_keys: set = set()
    for ev in events:
        for wp in (ev.get("whatsapp_profits") or []):
            already_keys.add(wp.get("key"))

    def entry_key(e: dict) -> str:
        # stable dedup key
        return f"{e['date']}|{e['amount']:.2f}|{(e.get('msg') or '')[:80]}"

    from datetime import date as _date
    def parse_iso(s: str):
        try:
            y, m, d = s.split("-"); return _date(int(y), int(m), int(d))
        except Exception:
            return None

    matched, unmatched, skipped = [], [], []
    # Track events already used in THIS import so we don't stack multiple different profits
    # onto the same event unless there is no alternative in the ± window.
    used_event_ids: set = set()

    # ---- Keyword-based semantic matching ----
    # Groups of related keywords: msg word -> preferred event name keywords.
    KW_GROUPS = [
        {"msg": ["komunia", "komunii"], "ev": ["komuni"]},
        {"msg": ["urodzin", "urodziny", "urodzinki", "18 stka", "18-stka", "18stka", "18tka"],
         "ev": ["urodz", "18", "roczek", "16", "40"]},
        {"msg": ["wesele", "ślub", "slub"], "ev": ["wesel", "ślub", "slub"]},
        {"msg": ["chrzcin", "chrzest"], "ev": ["chrzcin"]},
        {"msg": ["firmow"], "ev": ["firmow", "resovia", "renault", "ekobox"]},
        {"msg": ["wycieczk", "przedszkol", "szkol", "warsztat"],
         "ev": ["wycieczk", "przedszkol", "szkol", "warsztat", "klas"]},
        {"msg": ["roczek", "roczka"], "ev": ["roczek"]},
        {"msg": ["ognisko"], "ev": ["ognisko"]},
        {"msg": ["dziki zach"], "ev": ["dziki zach"]},
        {"msg": ["harry", "potter"], "ev": ["harry", "potter"]},
        {"msg": ["gady"], "ev": ["gady"]},
        {"msg": ["konie", "kucyk"], "ev": ["kon", "alpak", "kucyk"]},
    ]
    def semantic_boost(msg: str, ev_name: str) -> int:
        """Return negative score bonus (better) when msg keywords line up with event name."""
        msg_l = (msg or "").lower()
        name_l = (ev_name or "").lower()
        for grp in KW_GROUPS:
            if any(w in msg_l for w in grp["msg"]):
                if any(w in name_l for w in grp["ev"]):
                    return -500   # strong match
                # msg has a strong keyword but event doesn't → mild penalty
                return 200
        return 0

    # Sort entries by date so earlier ones win when there is ambiguity
    entries_sorted = sorted(entries, key=lambda e: (e["date"], -e["amount"]))

    for e in entries_sorted:
        key = entry_key(e)
        if key in already_keys:
            skipped.append({**e, "reason": "already_applied"})
            continue
        target = parse_iso(e["date"])
        if not target:
            unmatched.append({**e, "reason": "bad_date"})
            continue
        # find candidate events within window
        best = None
        best_score = None
        for ev in events:
            ed = parse_iso(ev.get("date") or "")
            if not ed:
                continue
            diff = abs((ed - target).days)
            if diff > body.window_days:
                continue
            has_revenue = float(ev.get("revenue") or 0) > 0
            already_used_here = ev["id"] in used_event_ids
            # Score (lower = better):
            #  - primary: date proximity (×100)
            #  - keyword semantic boost (−500 for strong match, +200 for mismatch)
            #  - secondary: prefer unused events (+1000 if used here)
            #  - tertiary: prefer events with no revenue yet (+50 if has_revenue)
            score = (
                diff * 100
                + semantic_boost(e.get("msg", ""), ev.get("name") or "")
                + (1000 if already_used_here else 0)
                + (50 if has_revenue else 0)
            )
            if best_score is None or score < best_score:
                best = ev
                best_score = score
        if best:
            used_event_ids.add(best["id"])
            matched.append({
                "entry": e,
                "event": {"id": best["id"], "name": best.get("name") or "", "date": best.get("date")},
                "previous_revenue": float(best.get("revenue") or 0),
                "new_revenue": float(best.get("revenue") or 0) + e["amount"],
                "days_off": abs((parse_iso(best.get("date")) - target).days),
                "key": key,
            })
        else:
            unmatched.append({**e, "reason": "no_event_in_window"})

    if not body.dry_run and matched:
        # apply changes
        for row in matched:
            ev_id = row["event"]["id"]
            prev_rev = row["previous_revenue"]
            new_rev = row["new_revenue"]
            wp_entry = {
                "key": row["key"],
                "date": row["entry"]["date"],
                "amount": row["entry"]["amount"],
                "msg": row["entry"]["msg"],
                "imported_at": now_utc().isoformat(),
                "imported_by": user.get("email") or user.get("id"),
            }
            await db.events.update_one(
                {"id": ev_id, "owner_id": ws(user)},
                {
                    "$set": {"revenue": new_rev},
                    "$push": {"whatsapp_profits": wp_entry},
                }
            )
        # Log a single summary in change history
        try:
            await log_change(
                user, "import", "event", "",
                f"Import zysków WhatsApp: dopasowano {len(matched)} wpisów, suma {sum(r['entry']['amount'] for r in matched):.2f} zł"
            )
        except Exception:
            pass

    return {
        "parsed": len(entries),
        "matched": matched,
        "unmatched": unmatched,
        "skipped": skipped,
        "applied": (not body.dry_run) and bool(matched),
        "totals": {
            "matched_amount": round(sum(r["entry"]["amount"] for r in matched), 2),
            "unmatched_amount": round(sum(u["amount"] for u in unmatched), 2),
            "skipped_amount": round(sum(s["amount"] for s in skipped), 2),
        },
    }


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# APScheduler for periodic alert scans
_scheduler = None

@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.events.create_index([("owner_id", 1), ("date", -1)])
    await db.staff.create_index([("owner_id", 1)])
    # Emergent Google Auth session storage
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    # TTL index — MongoDB will auto-delete expired sessions
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    # Alerts indices
    await db.alerts.create_index([("owner_id", 1), ("dismissed", 1), ("created_at", -1)])
    await db.alerts.create_index([("event_id", 1), ("kind", 1)])
    # Google Calendar OAuth
    await db.oauth_states.create_index("state", unique=True)
    await db.oauth_states.create_index("expires_at", expireAfterSeconds=0)
    await db.google_calendar_connections.create_index("user_id", unique=True)

    # Start APScheduler for 2-day stale-status alerts
    global _scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.interval import IntervalTrigger
        _scheduler = AsyncIOScheduler(timezone="Europe/Warsaw")
        # Run every 2 hours; also run once shortly after startup
        _scheduler.add_job(
            scan_and_create_alerts,
            IntervalTrigger(hours=2),
            id="alerts_scan",
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        _scheduler.start()
        logger.info("APScheduler started: alerts_scan every 2h")
    except Exception as e:
        logger.warning(f"APScheduler failed to start: {e}")


# ================================================================
# Rozliczenie wspólników (Partner Settlements) — cash flow module
# ================================================================
class PartnerPayoutIn(BaseModel):
    partner_name: str
    amount: float

class SettlementIn(BaseModel):
    date: Optional[str] = None            # ISO datetime — if None, uses now
    payouts: List[PartnerPayoutIn]        # each partner + amount
    cash_before: Optional[float] = None   # if None, computed server-side
    notes: Optional[str] = ""


async def _last_settlement(owner_id: str) -> Optional[dict]:
    return await db.settlements.find_one(
        {"owner_id": owner_id}, {"_id": 0}, sort=[("date", -1)]
    )


async def _sum_revenue(owner_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                       only_realized: bool = True) -> float:
    """Sum event revenues in a date window (inclusive on date field YYYY-MM-DD).
    If only_realized=True (default), events with date > today are EXCLUDED — cash counts only what has happened.
    Cancelled events are always excluded.
    """
    q: dict = {"owner_id": owner_id}
    today_iso = datetime.now(timezone.utc).date().isoformat()
    if date_from or date_to or only_realized:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
        if only_realized:
            # cap at today
            cap = date_to if date_to else today_iso
            if not date_to or date_to > today_iso:
                q["date"]["$lte"] = today_iso
    total = 0.0
    async for e in db.events.find(q, {"revenue": 1, "status": 1}):
        if (e.get("status") or "").lower() == "anulowana":
            continue
        total += float(e.get("revenue") or 0)
    return total


async def _sum_expenses(owner_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                       category: Optional[str] = None, exclude_category: Optional[str] = None) -> float:
    q: dict = {"owner_id": owner_id}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    if category:
        q["category"] = category
    if exclude_category:
        q["category"] = {"$ne": exclude_category}
    total = 0.0
    async for x in db.expenses.find(q, {"amount": 1}):
        total += float(x.get("amount") or 0)
    return total


async def _sum_settlements(owner_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> float:
    q: dict = {"owner_id": owner_id}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    total = 0.0
    async for s in db.settlements.find(q, {"total_payout": 1}):
        total += float(s.get("total_payout") or 0)
    return total


async def _sum_event_costs(owner_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> float:
    """Sum event material + labor costs (from event.costs array and event.shifts × hourly_rate)."""
    q: dict = {"owner_id": owner_id}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    # preload staff for labor
    staff_map: Dict[str, dict] = {}
    async for s in db.staff.find({"owner_id": owner_id}, {"_id": 0}):
        staff_map[s["id"]] = s
    total = 0.0
    async for ev in db.events.find(q, {"costs": 1, "shifts": 1, "status": 1}):
        if (ev.get("status") or "").lower() == "anulowana":
            continue
        for c in (ev.get("costs") or []):
            total += float(c.get("amount") or 0)
        for sh in (ev.get("shifts") or []):
            s = staff_map.get(sh.get("staff_id"))
            if s:
                total += float(sh.get("hours", 0)) * float(s.get("hourly_rate", 0))
    return total


async def _get_opening_balance(owner_id: str) -> float:
    doc = await db.workspace_settings.find_one({"owner_id": owner_id}, {"opening_balance": 1}) or {}
    return float(doc.get("opening_balance") or 0)


async def _compute_cash_state(owner_id: str) -> dict:
    """Cash state formula:
    Aktualny stan = OpeningBalance + ΣRevenue − ΣEventCosts − ΣExpenses(incl. wyplaty_szefow) − ΣSettlements
    """
    opening = await _get_opening_balance(owner_id)
    all_revenue = await _sum_revenue(owner_id)
    all_event_costs = await _sum_event_costs(owner_id)
    all_expenses = await _sum_expenses(owner_id)
    all_settlements = await _sum_settlements(owner_id)
    cash_current = round(opening + all_revenue - all_event_costs - all_expenses - all_settlements, 2)

    last = await _last_settlement(owner_id)
    if last:
        last_date_iso = (last.get("date") or "")[:10]
        after_date = _next_day_iso(last_date_iso) if last_date_iso else None
        rev_since = await _sum_revenue(owner_id, date_from=after_date) if after_date else all_revenue
        # 'Koszty od rozliczenia' — WYKLUCZAMY wyplaty_szefow (te są rozliczeniami, nie kosztami)
        cost_since_exp = await _sum_expenses(owner_id, date_from=after_date, exclude_category="wyplaty_szefow") if after_date else 0
        cost_since_event = await _sum_event_costs(owner_id, date_from=after_date) if after_date else 0
        cost_since = cost_since_exp + cost_since_event
        payouts_since_from_expenses = await _sum_expenses(owner_id, date_from=after_date, category="wyplaty_szefow") if after_date else 0
        payouts_since_from_settlements = await _sum_settlements(owner_id, date_from=after_date) if after_date else 0
        payouts_since = payouts_since_from_expenses + payouts_since_from_settlements
        cash_from_last = round(float(last.get("cash_after", 0)) + rev_since - cost_since - payouts_since, 2)
        return {
            "opening_balance": opening,
            "cash_current": cash_current,
            "cash_from_last_settlement": cash_from_last,
            "revenue_since_last": round(rev_since, 2),
            "cost_since_last": round(cost_since, 2),
            "payouts_since_last": round(payouts_since, 2),
            "last_settlement": last,
        }
    # No settlement yet — everything counts
    return {
        "opening_balance": opening,
        "cash_current": cash_current,
        "cash_from_last_settlement": cash_current,
        "revenue_since_last": round(all_revenue, 2),
        "cost_since_last": round(all_expenses - await _sum_expenses(owner_id, category="wyplaty_szefow") + all_event_costs, 2),
        "payouts_since_last": round(await _sum_expenses(owner_id, category="wyplaty_szefow") + all_settlements, 2),
        "last_settlement": None,
    }


def _next_day_iso(d: str) -> str:
    """Return ISO date one day after the given YYYY-MM-DD, or empty on parse errors."""
    try:
        y, m, dd = d.split("-")
        from datetime import date as _dt
        nd = _dt(int(y), int(m), int(dd)) + timedelta(days=1)
        return nd.isoformat()
    except Exception:
        return d


@api.get("/finance/cash-state")
async def get_cash_state(user=Depends(require_admin)):
    """Return the current cash balance and breakdown from the last settlement."""
    return await _compute_cash_state(ws(user))


class OpeningBalanceIn(BaseModel):
    opening_balance: float
    note: Optional[str] = ""


@api.put("/finance/opening-balance")
async def set_opening_balance(body: OpeningBalanceIn, user=Depends(current_user)):
    """Set the workspace opening cash balance (used as offset in cash-state formula)."""
    owner = ws(user)
    await db.workspace_settings.update_one(
        {"owner_id": owner},
        {"$set": {
            "opening_balance": float(body.opening_balance),
            "opening_balance_note": (body.note or "").strip(),
            "opening_balance_updated_at": now_utc().isoformat(),
            "opening_balance_updated_by": user.get("email") or user["id"],
        }},
        upsert=True,
    )
    try:
        await log_change(user, "update", "opening_balance", "", f"Ustawiono saldo początkowe: {body.opening_balance:.2f} zł")
    except Exception:
        pass
    return {"ok": True, "opening_balance": float(body.opening_balance)}


@api.get("/finance/period-summary")
async def get_period_summary(user=Depends(require_admin), date_from: str = "", date_to: str = ""):
    """Return revenue / regular costs / partner payouts / result for an arbitrary date range."""
    owner = ws(user)
    df = date_from or None
    dt = date_to or None
    revenue = await _sum_revenue(owner, df, dt, only_realized=False)
    regular_costs = await _sum_expenses(owner, df, dt, exclude_category="wyplaty_szefow")
    partner_payouts_expenses = await _sum_expenses(owner, df, dt, category="wyplaty_szefow")
    settlements_total = await _sum_settlements(owner, df, dt)
    partner_payouts_total = partner_payouts_expenses + settlements_total
    # Lists — recent items for drill-down
    q_ev: dict = {"owner_id": owner}
    if df or dt:
        q_ev["date"] = {}
        if df: q_ev["date"]["$gte"] = df
        if dt: q_ev["date"]["$lte"] = dt
    events = await db.events.find(q_ev, {"_id": 0, "id": 1, "name": 1, "date": 1, "revenue": 1, "status": 1}).sort("date", 1).to_list(2000)
    events = [e for e in events if (e.get("status") or "").lower() != "anulowana" and float(e.get("revenue") or 0) > 0]
    q_ex: dict = {"owner_id": owner}
    if df or dt:
        q_ex["date"] = {}
        if df: q_ex["date"]["$gte"] = df
        if dt: q_ex["date"]["$lte"] = dt
    expenses = await db.expenses.find(q_ex, {"_id": 0, "id": 1, "date": 1, "label": 1, "amount": 1, "category": 1}).sort("date", 1).to_list(5000)
    return {
        "date_from": df, "date_to": dt,
        "revenue": round(revenue, 2),
        "regular_costs": round(regular_costs, 2),
        "partner_payouts": round(partner_payouts_total, 2),
        "result": round(revenue - regular_costs, 2),  # standard profit excluding partner payouts
        "result_after_payouts": round(revenue - regular_costs - partner_payouts_total, 2),
        "events": events[:200],
        "expenses": expenses[:500],
    }


@api.get("/settlements")
async def list_settlements(user=Depends(require_admin)):
    """Return all settlements for this workspace, newest first."""
    rows = await db.settlements.find({"owner_id": ws(user)}, {"_id": 0}).sort("date", -1).to_list(500)
    return rows


@api.post("/settlements")
async def create_settlement(body: SettlementIn, user=Depends(require_admin)):
    """Create a new partner-settlement snapshot.
    The current cash is captured (if not provided) and the record becomes the new starting point.
    """
    owner = ws(user)
    now_iso = now_utc().isoformat()
    date_str = body.date or now_iso
    # cash_before default = current computed cash
    if body.cash_before is not None:
        cash_before = float(body.cash_before)
    else:
        state = await _compute_cash_state(owner)
        cash_before = float(state.get("cash_current") or 0)
    payouts_norm = [{"partner_name": p.partner_name.strip(), "amount": float(p.amount or 0)} for p in body.payouts if p.partner_name.strip() and float(p.amount or 0) > 0]
    total_payout = round(sum(p["amount"] for p in payouts_norm), 2)
    cash_after = round(cash_before - total_payout, 2)
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": owner,
        "date": date_str,
        "cash_before": round(cash_before, 2),
        "payouts": payouts_norm,
        "total_payout": total_payout,
        "cash_after": cash_after,
        "notes": (body.notes or "").strip(),
        "created_by_id": user["id"],
        "created_by_name": user.get("name") or user.get("email") or "",
        "created_at": now_iso,
    }
    await db.settlements.insert_one(doc)
    try:
        await log_change(user, "create", "settlement", doc["id"],
                         f"Rozliczenie wspólników: {len(payouts_norm)} osób, wypłacono {total_payout:.2f} zł, stan {cash_before:.2f} → {cash_after:.2f} zł")
    except Exception:
        pass
    return doc


@api.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: str, user=Depends(require_admin)):
    """Soft policy: allow deletion (owner can undo a mistaken settlement).
    Ważne: user prosił żeby NIE usuwać z historii — więc endpoint zwraca 403 dla bezpieczeństwa.
    """
    raise HTTPException(status_code=403, detail="Nie można usuwać rozliczeń z historii.")


# ================================================================
# Shopping list (Automatyczna lista zakupów)
# ================================================================
class ShoppingItemIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    category: str = "inne"           # catering | grill | napoje | kawa | jednorazowki | dekoracje | srodki | dodatkowe | inne
    qty: float = 1
    unit: str = "szt"
    stock_qty: float = 0             # na magazynie
    unit_price: float = 0            # estimated unit price
    actual_price: Optional[float] = None
    status: str = "todo"             # todo | bought | ready
    event_ids: List[str] = []        # linked events
    event_names: List[str] = []
    notes: Optional[str] = ""

@api.post("/shopping/items")
async def add_shopping_item(body: ShoppingItemIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user)
    doc["created_at"] = now_utc().isoformat()
    await db.shopping_items.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/shopping/items")
async def list_shopping_items(user=Depends(current_user), date_from: str = "", date_to: str = ""):
    q: dict = {"owner_id": ws(user)}
    rows = await db.shopping_items.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return rows

class ShoppingItemPatch(BaseModel):
    model_config = {"extra": "allow"}
    qty: Optional[float] = None
    stock_qty: Optional[float] = None
    unit_price: Optional[float] = None
    actual_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None

@api.patch("/shopping/items/{item_id}")
async def update_shopping_item(item_id: str, body: ShoppingItemPatch, user=Depends(current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    prev = await db.shopping_items.find_one({"id": item_id, "owner_id": ws(user)}, {"_id": 0})
    if not prev:
        raise HTTPException(404, "not found")
    await db.shopping_items.update_one({"id": item_id, "owner_id": ws(user)}, {"$set": updates})
    # If status just became "bought" AND we have event_ids → add expense to those events
    if updates.get("status") == "bought" and prev.get("status") != "bought" and updates.get("actual_price") is not None:
        actual = float(updates["actual_price"])
        event_ids = prev.get("event_ids") or []
        # Split proportionally across linked events (or 1 event → full amount)
        per_event = actual / max(1, len(event_ids))
        for ev_id in event_ids:
            await db.events.update_one(
                {"id": ev_id, "owner_id": ws(user)},
                {"$push": {"costs": {"label": f"Zakup: {prev.get('name','')}", "amount": round(per_event, 2)}}}
            )
    return {"ok": True}

@api.delete("/shopping/items/{item_id}")
async def delete_shopping_item(item_id: str, user=Depends(current_user)):
    await db.shopping_items.delete_one({"id": item_id, "owner_id": ws(user)})
    return {"ok": True}

@api.get("/shopping/recipes")
async def get_recipes(user=Depends(current_user)):
    """Return current recipes (defaults merged with per-workspace overrides) and labels."""
    ms = await db.menu_settings.find_one({"owner_id": ws(user)}, {"_id": 0}) or {}
    overrides = ms.get("recipe_overrides") or {}
    fixed_ov = ms.get("fixed_per_event")
    merged = merge_recipes(overrides)
    return {
        "recipes": merged,
        "labels": RECIPE_LABELS,
        "fixed_per_event": fixed_ov if fixed_ov else FIXED_PER_EVENT,
        "categories": ["warzywa","mieso","nabial","spozywcze","pieczywo","napoje","kawa","jednorazowki","dekoracje","srodki","dodatkowe","inne"],
        "units": ["kg","g","l","ml","szt","opak","sloik","peczek","porcja"],
    }


class RecipeUpdateIn(BaseModel):
    model_config = {"extra": "allow"}
    ingredients: List[dict]  # [{name, category, unit, qty, price}, ...]


@api.put("/shopping/recipes/{key}")
async def update_recipe(key: str, body: RecipeUpdateIn, user=Depends(current_user)):
    """Save an override recipe for one dish/package key."""
    owner = ws(user)
    ms = await db.menu_settings.find_one({"owner_id": owner}, {"_id": 0}) or {}
    ovr = ms.get("recipe_overrides") or {}
    # Basic validation
    cleaned = []
    for it in body.ingredients:
        name = str(it.get("name") or "").strip()
        if not name: continue
        cleaned.append({
            "name": name,
            "category": str(it.get("category") or "inne"),
            "unit": str(it.get("unit") or "szt"),
            "qty": float(it.get("qty") or 0),
            "price": float(it.get("price") or 0),
        })
    ovr[key] = cleaned
    await db.menu_settings.update_one(
        {"owner_id": owner},
        {"$set": {"recipe_overrides": ovr, "updated_at": now_utc().isoformat(), "owner_id": owner}},
        upsert=True,
    )
    return {"ok": True, "recipe": cleaned}


@api.delete("/shopping/recipes/{key}")
async def reset_recipe(key: str, user=Depends(current_user)):
    """Reset a recipe key back to default (remove override)."""
    owner = ws(user)
    ms = await db.menu_settings.find_one({"owner_id": owner}, {"_id": 0}) or {}
    ovr = ms.get("recipe_overrides") or {}
    if key in ovr:
        ovr.pop(key, None)
        await db.menu_settings.update_one(
            {"owner_id": owner},
            {"$set": {"recipe_overrides": ovr, "updated_at": now_utc().isoformat(), "owner_id": owner}},
            upsert=True,
        )
    return {"ok": True}


@api.get("/shopping/generate")
async def generate_shopping_list(user=Depends(current_user), date_from: str = "", date_to: str = "", expand: bool = True):
    """Analyze events in [date_from, date_to] and produce aggregated purchase suggestions.
    When expand=True (default), packages/dishes are broken down into raw atomic ingredients.
    Aggregation groups: warzywa, mieso, nabial, spozywcze, pieczywo, napoje, kawa,
    jednorazowki, srodki, dekoracje, dodatkowe, inne.
    Response is READ-ONLY suggestion — user can accept items to store them (POST /shopping/items).
    """
    owner = ws(user)
    q: dict = {"owner_id": owner}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    events = await db.events.find(q, {"_id": 0}).sort("date", 1).to_list(500)
    events = [e for e in events if (e.get("status") or "").lower() != "anulowana"]

    # Load recipe overrides + fixed items
    ms = await db.menu_settings.find_one({"owner_id": owner}, {"_id": 0}) or {}
    recipes_map = merge_recipes(ms.get("recipe_overrides") or {})
    fixed_items = ms.get("fixed_per_event") if ms.get("fixed_per_event") else FIXED_PER_EVENT

    # aggregators: key = (category, name.lower(), unit) → row
    agg: dict = {}
    def _add(cat, name, unit, qty, unit_price, ev):
        k = (cat, name.strip().lower(), unit)
        if k not in agg:
            agg[k] = {
                "category": cat, "name": name.strip(), "unit": unit,
                "qty": 0.0, "unit_price": unit_price,
                "event_ids": [], "event_names": [],
            }
        agg[k]["qty"] += float(qty)
        if unit_price > 0 and agg[k]["unit_price"] == 0:
            agg[k]["unit_price"] = unit_price
        if ev is not None and ev.get("id") and ev["id"] not in agg[k]["event_ids"]:
            agg[k]["event_ids"].append(ev["id"])
            agg[k]["event_names"].append(f"{ev.get('date','')} · {ev.get('name','')}")

    def _apply_recipe(key: str, people: float, ev: dict):
        ings = recipes_map.get(key) or []
        for ing in ings:
            per = float(ing.get("qty") or 0)
            if per <= 0: continue
            total = round(per * float(people), 3)
            _add(
                ing.get("category") or "inne",
                ing.get("name") or "?",
                ing.get("unit") or "szt",
                total,
                float(ing.get("price") or 0),
                ev,
            )

    for ev in events:
        people = int(ev.get("people") or 0)
        if people <= 0:
            continue
        pkg = ev.get("package_set") or ""
        # 1) catering — dinner_items (z1..dd8) each with its own qty (in "osoby")
        for dish_id, qty in (ev.get("dinner_items") or {}).items():
            try: qn = float(qty)
            except Exception: qn = 0
            if not qn:
                continue
            if expand and dish_id in recipes_map:
                _apply_recipe(dish_id, qn, ev)
            else:
                # Fallback: aggregate under generic label (no expansion)
                label = RECIPE_LABELS.get(dish_id, dish_id)
                _add("catering", label, "os", qn, 0, ev)

        # 2) grill package — expand for all people
        if pkg in ("set1", "set2", "set3"):
            if expand:
                _apply_recipe(pkg, people, ev)
            else:
                _add("grill", f"Pakiet grill {pkg.upper()} (per os.)", "os", people, 0, ev)

        # 3) napoje (from extras_qty)
        extras = ev.get("extras_qty") or {}
        if extras.get("napoje") and people > 0:
            if expand:
                _apply_recipe("napoje", people, ev)
            else:
                _add("napoje", "Napoje (mix)", "os", people, 8, ev)

        # 4) other extras from event (custom ones) — kept as-is
        for ex_id, ex_qty in extras.items():
            if ex_id == "napoje" or not ex_qty:
                continue
            try: qn = float(ex_qty)
            except Exception: qn = 0
            if qn <= 0:
                continue
            # If we have a recipe for that extras id, expand it
            if expand and ex_id in recipes_map:
                # extras qty semantic: treat as "portions" ~ people count for that extra
                _apply_recipe(ex_id, qn, ev)
            else:
                _add("dodatkowe", ex_id, "szt", qn, 0, ev)

        # 5) Fixed per event items (serwetki, worki, płyn do naczyń...)
        if fixed_items:
            for it in fixed_items:
                _add(
                    it.get("category") or "jednorazowki",
                    it.get("name") or "?",
                    it.get("unit") or "szt",
                    float(it.get("qty") or 0),
                    float(it.get("price") or 0),
                    ev,
                )

    suggestions = []
    for row in agg.values():
        row["qty"] = round(row["qty"], 2)
        row["estimated_cost"] = round(row["qty"] * row["unit_price"], 2)
        suggestions.append(row)

    # --- Apply user overrides (manual qty / unit_price edits) ---
    ov_rows = await db.shopping_overrides.find({"owner_id": owner}, {"_id": 0}).to_list(2000)
    ov_map = {(r.get("category") or "inne", (r.get("name") or "").strip().lower(), r.get("unit") or ""): r for r in ov_rows}
    for s in suggestions:
        k = (s["category"], (s["name"] or "").strip().lower(), s.get("unit") or "")
        ov = ov_map.get(k)
        if not ov:
            continue
        s["overridden"] = True
        if ov.get("qty_override") is not None:
            try: s["qty"] = float(ov["qty_override"])
            except Exception: pass
        if ov.get("price_override") is not None:
            try: s["unit_price"] = float(ov["price_override"])
            except Exception: pass

    # --- Cross-reference with stock + reservations ---
    stock_rows = await db.stock_items.find({"owner_id": owner}, {"_id": 0}).to_list(2000)
    res_rows = await db.stock_reservations.find({"owner_id": owner}, {"_id": 0}).to_list(2000)
    # Only reservations whose event still ongoing/future (date >= today)
    today_iso = now_utc().date().isoformat()
    active_res = []
    for r in res_rows:
        ev_id = r.get("event_id")
        if not ev_id:
            active_res.append(r); continue
        # look up event date once (cache)
        ev = next((e for e in events if e.get("id") == ev_id), None)
        if ev is None:
            ev = await db.events.find_one({"id": ev_id, "owner_id": owner}, {"_id": 0, "date": 1})
        if ev and (ev.get("date") or "") >= today_iso:
            active_res.append(r)

    def _norm(x: str) -> str:
        return (x or "").strip().lower()

    # Build map (name_lower, unit) -> {stock_qty, expiry_min, reserved_qty, stock_id, reservations:[]}
    smap: dict = {}
    for st in stock_rows:
        k = (_norm(st.get("name")), st.get("unit") or "")
        d = smap.setdefault(k, {"stock_qty": 0.0, "expiry": None, "reserved_qty": 0.0, "stock_ids": [], "reservations": []})
        d["stock_qty"] += float(st.get("qty") or 0)
        exp = st.get("expiry_date") or ""
        if exp and (d["expiry"] is None or exp < d["expiry"]):
            d["expiry"] = exp
        d["stock_ids"].append(st.get("id"))
    for r in active_res:
        k = (_norm(r.get("name")), r.get("unit") or "")
        d = smap.setdefault(k, {"stock_qty": 0.0, "expiry": None, "reserved_qty": 0.0, "stock_ids": [], "reservations": []})
        d["reserved_qty"] += float(r.get("qty") or 0)
        d["reservations"].append({"id": r.get("id"), "event_id": r.get("event_id"), "event_name": r.get("event_name",""), "qty": r.get("qty",0)})

    # Enrich each suggestion
    for s in suggestions:
        k = (_norm(s["name"]), s.get("unit") or "")
        d = smap.get(k) or {}
        stk = float(d.get("stock_qty") or 0)
        rsv = float(d.get("reserved_qty") or 0)
        available = max(0.0, stk - rsv)
        needed = float(s["qty"])
        to_buy = max(0.0, needed - available)
        s["needed"] = round(needed, 2)
        s["stock_qty"] = round(stk, 2)
        s["reserved_qty"] = round(rsv, 2)
        s["available_qty"] = round(available, 2)
        s["to_buy"] = round(to_buy, 2)
        s["stock_expiry"] = d.get("expiry")
        # Adjust estimated cost to only what we actually buy
        s["estimated_cost"] = round(to_buy * s["unit_price"], 2)

    # sort: category then name
    order = ["mieso","warzywa","nabial","pieczywo","spozywcze","napoje","kawa","jednorazowki","srodki","dekoracje","dodatkowe","catering","grill","inne"]
    suggestions.sort(key=lambda x: (order.index(x["category"]) if x["category"] in order else 99, x["name"]))
    total_est = sum(s["estimated_cost"] for s in suggestions)

    # Category totals for the frontend hero (based on to_buy cost)
    from collections import defaultdict
    cat_totals: dict = defaultdict(lambda: {"count": 0, "cost": 0.0})
    for s in suggestions:
        if s.get("to_buy", s["qty"]) <= 0:
            continue
        cat_totals[s["category"]]["count"] += 1
        cat_totals[s["category"]]["cost"] += s["estimated_cost"]

    # Staff sees the list but WITHOUT company financial totals / cost projections
    if is_staff(user):
        for s in suggestions:
            s.pop("estimated_cost", None)
            s.pop("unit_price", None)
        return {
            "date_from": date_from, "date_to": date_to,
            "event_count": len(events),
            "total_people": sum(int(e.get("people") or 0) for e in events),
            "expanded": bool(expand),
            "unique_to_buy": sum(1 for s in suggestions if (s.get("to_buy") or 0) > 0),
            "suggestions": suggestions,
        }

    return {
        "date_from": date_from, "date_to": date_to,
        "event_count": len(events),
        "total_people": sum(int(e.get("people") or 0) for e in events),
        "estimated_total": round(total_est, 2),
        "expanded": bool(expand),
        "category_totals": {k: {"count": v["count"], "cost": round(v["cost"], 2)} for k, v in cat_totals.items()},
        "unique_to_buy": sum(1 for s in suggestions if (s.get("to_buy") or 0) > 0),
        "suggestions": suggestions,
    }


# ---------- Shopping suggestion overrides ----------
class ShoppingOverrideIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    category: str = "inne"
    unit: str = "szt"
    qty_override: Optional[float] = None      # None = clear
    price_override: Optional[float] = None    # None = clear


@api.put("/shopping/overrides")
async def upsert_shopping_override(body: ShoppingOverrideIn, user=Depends(current_user)):
    owner = ws(user)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Brak nazwy")
    key = f"{body.category}|{name.lower()}|{body.unit}"
    doc = {
        "owner_id": owner,
        "key": key,
        "name": name,
        "category": body.category or "inne",
        "unit": body.unit or "szt",
        "qty_override": float(body.qty_override) if body.qty_override is not None else None,
        "price_override": float(body.price_override) if body.price_override is not None else None,
        "updated_at": now_utc().isoformat(),
    }
    await db.shopping_overrides.update_one(
        {"owner_id": owner, "key": key},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True, **doc}


@api.get("/shopping/overrides")
async def list_shopping_overrides(user=Depends(current_user)):
    rows = await db.shopping_overrides.find({"owner_id": ws(user)}, {"_id": 0}).to_list(2000)
    return rows


@api.delete("/shopping/overrides")
async def clear_shopping_override(name: str, category: str = "inne", unit: str = "szt", user=Depends(current_user)):
    key = f"{category}|{(name or '').strip().lower()}|{unit}"
    await db.shopping_overrides.delete_one({"owner_id": ws(user), "key": key})
    return {"ok": True}


# ================================================================
# Magazyn (Stock / Inventory)
# ================================================================
def _expiry_status(exp: str | None) -> str:
    """Return one of: '' | 'expired' | 'urgent' | 'soon' | 'ok'"""
    if not exp:
        return ""
    try:
        d = datetime.strptime(exp[:10], "%Y-%m-%d").date()
    except Exception:
        return ""
    today = now_utc().date()
    delta = (d - today).days
    if delta < 0: return "expired"
    if delta <= 3: return "urgent"
    if delta <= 7: return "soon"
    return "ok"


class StockItemIn(BaseModel):
    model_config = {"extra": "allow"}
    name: str
    category: str = "inne"
    qty: float = 0
    unit: str = "szt"
    expiry_date: Optional[str] = None    # YYYY-MM-DD
    notes: Optional[str] = ""


@api.get("/stock/items")
async def list_stock_items(user=Depends(current_user)):
    rows = await db.stock_items.find({"owner_id": ws(user)}, {"_id": 0}).sort("category", 1).to_list(2000)
    # reservations map to compute available
    res_rows = await db.stock_reservations.find({"owner_id": ws(user)}, {"_id": 0}).to_list(2000)
    today_iso = now_utc().date().isoformat()

    def _norm(x): return (x or "").strip().lower()
    res_by_key: dict = {}
    for r in res_rows:
        ev = await db.events.find_one({"id": r.get("event_id"), "owner_id": ws(user)}, {"_id": 0, "date": 1, "name": 1})
        if not ev or (ev.get("date") or "") < today_iso:
            continue
        k = (_norm(r.get("name")), r.get("unit") or "")
        res_by_key.setdefault(k, []).append({**r, "event_date": ev.get("date"), "event_name": ev.get("name","")})
    for it in rows:
        it["expiry_status"] = _expiry_status(it.get("expiry_date"))
        k = (_norm(it.get("name")), it.get("unit") or "")
        resvs = res_by_key.get(k, [])
        it["reservations"] = resvs
        it["reserved_qty"] = round(sum(float(x.get("qty") or 0) for x in resvs), 2)
        it["available_qty"] = round(max(0.0, float(it.get("qty") or 0) - it["reserved_qty"]), 2)
    return rows


@api.post("/stock/items")
async def add_stock_item(body: StockItemIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user)
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = doc["created_at"]
    await db.stock_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


class StockItemPatch(BaseModel):
    model_config = {"extra": "allow"}
    name: Optional[str] = None
    category: Optional[str] = None
    qty: Optional[float] = None
    unit: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


@api.patch("/stock/items/{item_id}")
async def update_stock_item(item_id: str, body: StockItemPatch, user=Depends(current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates: return {"ok": True}
    updates["updated_at"] = now_utc().isoformat()
    await db.stock_items.update_one({"id": item_id, "owner_id": ws(user)}, {"$set": updates})
    return {"ok": True}


@api.delete("/stock/items/{item_id}")
async def delete_stock_item(item_id: str, user=Depends(require_admin)):
    await db.stock_items.delete_one({"id": item_id, "owner_id": ws(user)})
    # also clean orphan reservations
    await db.stock_reservations.delete_many({"stock_id": item_id, "owner_id": ws(user)})
    return {"ok": True}


class StockCheckItem(BaseModel):
    model_config = {"extra": "allow"}
    id: Optional[str] = None  # existing stock item id (else new)
    name: str
    category: Optional[str] = "inne"
    qty: float = 0
    unit: str = "szt"
    expiry_date: Optional[str] = None


class StockCheckIn(BaseModel):
    model_config = {"extra": "allow"}
    items: List[StockCheckItem]
    notes: Optional[str] = ""
    check_date: Optional[str] = None  # default today


@api.post("/stock/check")
async def save_stock_check(body: StockCheckIn, user=Depends(current_user)):
    """Bulk update stock quantities/expiry dates. Save snapshot for audit trail."""
    owner = ws(user)
    check_date = body.check_date or now_utc().date().isoformat()
    snap_items = []
    for it in body.items:
        payload = {
            "owner_id": owner,
            "name": it.name.strip(),
            "category": it.category or "inne",
            "qty": float(it.qty or 0),
            "unit": it.unit or "szt",
            "expiry_date": it.expiry_date or None,
            "updated_at": now_utc().isoformat(),
        }
        if it.id:
            await db.stock_items.update_one({"id": it.id, "owner_id": owner}, {"$set": payload})
            iid = it.id
        else:
            iid = str(uuid.uuid4())
            payload["id"] = iid
            payload["created_at"] = now_utc().isoformat()
            await db.stock_items.insert_one(payload)
        snap_items.append({
            "id": iid, "name": payload["name"], "category": payload["category"],
            "qty": payload["qty"], "unit": payload["unit"], "expiry_date": payload["expiry_date"],
        })
    snap = {
        "id": str(uuid.uuid4()),
        "owner_id": owner,
        "check_date": check_date,
        "created_at": now_utc().isoformat(),
        "user_email": user.get("email",""),
        "notes": body.notes or "",
        "items": snap_items,
        "item_count": len(snap_items),
    }
    await db.stock_snapshots.insert_one(snap)
    snap.pop("_id", None)
    return {"ok": True, "snapshot": snap}


@api.get("/stock/snapshots")
async def list_stock_snapshots(user=Depends(current_user), limit: int = 30):
    rows = await db.stock_snapshots.find({"owner_id": ws(user)}, {"_id": 0}).sort("created_at", -1).to_list(int(limit))
    return rows


class StockReservationIn(BaseModel):
    model_config = {"extra": "allow"}
    stock_id: Optional[str] = None
    name: str
    unit: str = "szt"
    qty: float = 0
    event_id: str
    event_name: Optional[str] = ""


@api.post("/stock/reservations")
async def add_reservation(body: StockReservationIn, user=Depends(require_admin)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user)
    doc["created_at"] = now_utc().isoformat()
    await db.stock_reservations.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/stock/reservations")
async def list_reservations(user=Depends(require_admin), event_id: str = ""):
    q = {"owner_id": ws(user)}
    if event_id: q["event_id"] = event_id
    rows = await db.stock_reservations.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return rows


@api.delete("/stock/reservations/{res_id}")
async def delete_reservation(res_id: str, user=Depends(require_admin)):
    await db.stock_reservations.delete_one({"id": res_id, "owner_id": ws(user)})
    return {"ok": True}


@api.get("/stock/needed-suggestions")
async def stock_needed_suggestions(user=Depends(current_user), date_from: str = "", date_to: str = ""):
    """Return raw ingredients needed for upcoming events (identical logic to /shopping/generate)
    but WITHOUT stock subtraction — useful to prefill Kontrola magazynu with items you actually need.
    """
    resp = await generate_shopping_list(user=user, date_from=date_from, date_to=date_to, expand=True)
    return {
        "date_from": resp.get("date_from"),
        "date_to": resp.get("date_to"),
        "items": [{
            "name": s["name"], "category": s["category"], "unit": s["unit"],
            "qty_needed": s["needed"], "stock_qty": s["stock_qty"], "reserved_qty": s["reserved_qty"],
            "expiry_status": _expiry_status(s.get("stock_expiry")), "expiry_date": s.get("stock_expiry"),
        } for s in resp.get("suggestions", [])],
    }


# ---------- Checklists (event tasks) ----------
class ChecklistTemplateIn(BaseModel):
    title: str
    event_types: Optional[List[str]] = None   # None or empty = all event types
    order: Optional[int] = 0

class ChecklistTaskIn(BaseModel):
    title: str
    order: Optional[int] = 0

class ChecklistTaskPatch(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None
    order: Optional[int] = None


@api.get("/checklist-templates")
async def list_checklist_templates(user=Depends(require_admin)):
    rows = await db.checklist_templates.find(
        {"owner_id": ws(user)}, {"_id": 0}
    ).sort([("order", 1), ("created_at", 1)]).to_list(500)
    return rows


@api.post("/checklist-templates")
async def create_checklist_template(body: ChecklistTemplateIn, user=Depends(require_admin)):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Podaj treść zadania")
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": ws(user),
        "title": title,
        "event_types": [e.lower() for e in (body.event_types or []) if e] or None,
        "order": int(body.order or 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.checklist_templates.insert_one(dict(doc))
    await log_change(user, "create", "checklist_template", doc["id"], f"Dodano szablon zadania: {title}")
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/checklist-templates/{tpl_id}")
async def update_checklist_template(tpl_id: str, body: ChecklistTemplateIn, user=Depends(require_admin)):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Podaj treść zadania")
    r = await db.checklist_templates.update_one(
        {"id": tpl_id, "owner_id": ws(user)},
        {"$set": {
            "title": title,
            "event_types": [e.lower() for e in (body.event_types or []) if e] or None,
            "order": int(body.order or 0),
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Nie znaleziono szablonu")
    doc = await db.checklist_templates.find_one({"id": tpl_id}, {"_id": 0})
    await log_change(user, "update", "checklist_template", tpl_id, f"Edytowano szablon zadania: {title}")
    return doc


@api.delete("/checklist-templates/{tpl_id}")
async def delete_checklist_template(tpl_id: str, user=Depends(require_admin)):
    doc = await db.checklist_templates.find_one({"id": tpl_id, "owner_id": ws(user)}, {"_id": 0})
    await db.checklist_templates.delete_one({"id": tpl_id, "owner_id": ws(user)})
    if doc:
        await log_change(user, "delete", "checklist_template", tpl_id, f"Usunięto szablon zadania: {doc.get('title','')}")
    return {"ok": True}


async def _materialize_checklist_from_templates(ws_id: str, ev: dict) -> None:
    """Create default checklist tasks for an event from admin templates.
    Idempotent — skips if the event was already initialized. Adds tasks that don't yet
    exist for this event (by template_id) so re-init picks up NEW templates."""
    et = (ev.get("category") or ev.get("event_type") or "").strip().lower()
    q: dict = {"owner_id": ws_id}
    if et:
        q["$or"] = [
            {"event_types": None},
            {"event_types": {"$size": 0}},
            {"event_types": {"$in": [et]}},
        ]
    else:
        q["$or"] = [{"event_types": None}, {"event_types": {"$size": 0}}]
    tpls = await db.checklist_templates.find(q, {"_id": 0}).sort([("order", 1), ("created_at", 1)]).to_list(500)
    # Skip templates already applied to this event
    existing = await db.checklist_items.find(
        {"owner_id": ws_id, "event_id": ev["id"], "source": "template"},
        {"_id": 0, "template_id": 1},
    ).to_list(1000)
    already = {x.get("template_id") for x in existing if x.get("template_id")}
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for i, t in enumerate(tpls):
        if t["id"] in already:
            continue
        docs.append({
            "id": str(uuid.uuid4()),
            "owner_id": ws_id,
            "event_id": ev["id"],
            "title": t["title"],
            "order": int(t.get("order") or i),
            "done": False,
            "done_by_id": None,
            "done_by_name": None,
            "done_at": None,
            "source": "template",
            "template_id": t["id"],
            "created_at": now,
        })
    if docs:
        await db.checklist_items.insert_many(docs)
    await db.events.update_one(
        {"id": ev["id"]},
        {"$set": {"checklist_initialized": True, "checklist_initialized_at": now}},
    )


async def _event_visible_to_user(user: dict, event_id: str) -> Optional[dict]:
    """Return event doc iff the user can see it (owner or assigned staff)."""
    q: dict = {"id": event_id, "owner_id": ws(user)}
    if is_staff(user):
        sid = user.get("staff_id")
        if not sid:
            return None
        q["shifts.staff_id"] = sid
    return await db.events.find_one(q, {"_id": 0})


@api.get("/events/{event_id}/checklist")
async def get_event_checklist(event_id: str, user=Depends(current_user)):
    ev = await _event_visible_to_user(user, event_id)
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    if not ev.get("checklist_initialized"):
        await _materialize_checklist_from_templates(ws(user), ev)
    items = await db.checklist_items.find(
        {"owner_id": ws(user), "event_id": event_id}, {"_id": 0}
    ).sort([("order", 1), ("created_at", 1)]).to_list(1000)
    return {
        "event": {
            "id": ev["id"],
            "name": ev.get("name", ""),
            "date": ev.get("date", ""),
            "time_start": ev.get("time_start", ""),
            "time_end": ev.get("time_end", ""),
            "category": ev.get("category", ""),
        },
        "items": items,
    }


@api.post("/events/{event_id}/checklist/init")
async def init_event_checklist(event_id: str, user=Depends(require_admin)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    await _materialize_checklist_from_templates(ws(user), ev)
    items = await db.checklist_items.find(
        {"owner_id": ws(user), "event_id": event_id}, {"_id": 0}
    ).sort([("order", 1), ("created_at", 1)]).to_list(1000)
    return {"ok": True, "items": items}


@api.post("/events/{event_id}/checklist")
async def add_checklist_task(event_id: str, body: ChecklistTaskIn, user=Depends(require_admin)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Podaj treść zadania")
    now = datetime.now(timezone.utc).isoformat()
    # Compute next order at the end
    last = await db.checklist_items.find(
        {"owner_id": ws(user), "event_id": event_id}, {"_id": 0, "order": 1}
    ).sort("order", -1).limit(1).to_list(1)
    next_order = int(body.order) if body.order else ((last[0]["order"] + 1) if last else 0)
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": ws(user),
        "event_id": event_id,
        "title": title,
        "order": next_order,
        "done": False,
        "done_by_id": None,
        "done_by_name": None,
        "done_at": None,
        "source": "adhoc",
        "created_at": now,
    }
    await db.checklist_items.insert_one(dict(doc))
    await db.events.update_one({"id": event_id}, {"$set": {"checklist_initialized": True}})
    return {k: v for k, v in doc.items() if k != "_id"}


@api.patch("/events/{event_id}/checklist/{task_id}")
async def patch_checklist_task(event_id: str, task_id: str, body: ChecklistTaskPatch,
                                user=Depends(current_user)):
    ev = await _event_visible_to_user(user, event_id)
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    updates: dict = {}
    if body.done is not None:
        updates["done"] = bool(body.done)
        if body.done:
            updates["done_by_id"] = user.get("id")
            updates["done_by_name"] = user.get("name") or user.get("email", "")
            updates["done_at"] = datetime.now(timezone.utc).isoformat()
        else:
            updates["done_by_id"] = None
            updates["done_by_name"] = None
            updates["done_at"] = None
    if is_admin(user):
        if body.title is not None:
            t = body.title.strip()
            if not t:
                raise HTTPException(400, "Treść zadania nie może być pusta")
            updates["title"] = t
        if body.order is not None:
            updates["order"] = int(body.order)
    if not updates:
        raise HTTPException(400, "Brak zmian")
    r = await db.checklist_items.update_one(
        {"id": task_id, "event_id": event_id, "owner_id": ws(user)},
        {"$set": updates},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Nie znaleziono zadania")
    doc = await db.checklist_items.find_one({"id": task_id}, {"_id": 0})
    return doc


@api.delete("/events/{event_id}/checklist/{task_id}")
async def delete_checklist_task(event_id: str, task_id: str, user=Depends(require_admin)):
    await db.checklist_items.delete_one(
        {"id": task_id, "event_id": event_id, "owner_id": ws(user)}
    )
    return {"ok": True}


@api.get("/staff/my/checklists")
async def my_checklists(user=Depends(current_user), days: int = 14):
    """Upcoming events (next `days`) visible to the caller with checklist progress."""
    from datetime import date as _date
    today = _date.today().isoformat()
    end = (_date.today() + timedelta(days=max(1, int(days or 14)))).isoformat()
    q: dict = {"owner_id": ws(user), "date": {"$gte": today, "$lte": end}}
    if is_staff(user):
        sid = user.get("staff_id")
        if not sid:
            return []
        q["shifts.staff_id"] = sid
    events = await db.events.find(q, {
        "_id": 0, "id": 1, "date": 1, "name": 1, "time_start": 1, "time_end": 1,
        "status": 1, "category": 1, "location": 1, "checklist_initialized": 1,
    }).sort("date", 1).to_list(200)
    out = []
    for ev in events:
        if not ev.get("checklist_initialized"):
            await _materialize_checklist_from_templates(ws(user), ev)
        total = await db.checklist_items.count_documents(
            {"owner_id": ws(user), "event_id": ev["id"]}
        )
        done = await db.checklist_items.count_documents(
            {"owner_id": ws(user), "event_id": ev["id"], "done": True}
        )
        out.append({**ev, "tasks_total": total, "tasks_done": done})
    return out


# ---------- Event Payments (Faza 2 v2.0) ----------
# Historia wpłat klienta per impreza. Odrębna kolekcja `event_payments`.
# Nie nadpisuje pola `deposit_amount` — pozostawione dla kompatybilności wstecznej.

PAYMENT_METHODS = {"Gotówka", "Przelew", "BLIK", "Karta", "Inne", "Zaliczka"}

class EventPaymentIn(BaseModel):
    amount: float
    date: str                     # ISO date YYYY-MM-DD
    method: str = "Przelew"
    note: Optional[str] = ""
    kind: Optional[str] = "wpłata"  # "zaliczka" | "wpłata" | "końcowa"

class EventPaymentPatch(BaseModel):
    amount: Optional[float] = None
    date: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None
    kind: Optional[str] = None


def _payment_status(price_total: float, paid_sum: float, n_payments: int) -> str:
    """Wyliczany automatycznie status płatności."""
    try:
        p = float(price_total or 0)
    except Exception:
        p = 0.0
    try:
        s = float(paid_sum or 0)
    except Exception:
        s = 0.0
    if s <= 0:
        return "Nie zapłacono"
    if p > 0 and s >= p - 0.01:
        return "Zapłacono"
    if n_payments == 1 and s < p:
        return "Zaliczka"
    return "Częściowo zapłacono"


async def _event_payments_summary(ws_id: str, event_id: str, price_total: float) -> dict:
    """Zwraca {payments: [...], paid_sum, remaining, payment_status}."""
    payments = await db.event_payments.find(
        {"owner_id": ws_id, "event_id": event_id}, {"_id": 0}
    ).sort([("date", 1), ("created_at", 1)]).to_list(500)
    paid = sum(float(p.get("amount") or 0) for p in payments)
    price = float(price_total or 0)
    remaining = max(0.0, price - paid) if price > 0 else 0.0
    status = _payment_status(price, paid, len(payments))
    return {
        "payments": payments,
        "payments_total": round(paid, 2),
        "payments_remaining": round(remaining, 2),
        "payment_status": status,
    }


@api.get("/events/{event_id}/payments")
async def list_event_payments(event_id: str, user=Depends(current_user)):
    ev = await _event_visible_to_user(user, event_id)
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    summary = await _event_payments_summary(ws(user), event_id, ev.get("price_total") or ev.get("revenue") or 0)
    return {
        "event": {
            "id": ev["id"],
            "name": ev.get("name", ""),
            "date": ev.get("date", ""),
            "price_total": float(ev.get("price_total") or ev.get("revenue") or 0),
        },
        **summary,
    }


@api.post("/events/{event_id}/payments")
async def add_event_payment(event_id: str, body: EventPaymentIn, user=Depends(require_admin)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")
    try:
        amount = float(body.amount)
    except Exception:
        raise HTTPException(400, "Nieprawidłowa kwota")
    if amount <= 0:
        raise HTTPException(400, "Kwota musi być większa od zera")
    if not body.date or len(body.date) < 8:
        raise HTTPException(400, "Podaj datę wpłaty")
    method = (body.method or "Przelew").strip() or "Przelew"
    kind = (body.kind or "wpłata").strip().lower()
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": ws(user),
        "event_id": event_id,
        "amount": round(amount, 2),
        "date": body.date,
        "method": method,
        "note": (body.note or "").strip(),
        "kind": kind,
        "created_by": user.get("id"),
        "created_by_name": user.get("name") or user.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.event_payments.insert_one(dict(doc))
    await log_change(user, "create", "event_payment", doc["id"],
                     f"Wpłata {amount:.2f} zł ({method}) do imprezy „{ev.get('name','')}")
    return {k: v for k, v in doc.items() if k != "_id"}


@api.patch("/events/{event_id}/payments/{payment_id}")
async def edit_event_payment(event_id: str, payment_id: str, body: EventPaymentPatch,
                              user=Depends(require_admin)):
    updates: dict = {}
    if body.amount is not None:
        try:
            a = float(body.amount)
        except Exception:
            raise HTTPException(400, "Nieprawidłowa kwota")
        if a <= 0:
            raise HTTPException(400, "Kwota musi być większa od zera")
        updates["amount"] = round(a, 2)
    if body.date is not None:
        if len(body.date) < 8:
            raise HTTPException(400, "Podaj datę")
        updates["date"] = body.date
    if body.method is not None:
        updates["method"] = body.method.strip() or "Przelew"
    if body.note is not None:
        updates["note"] = body.note.strip()
    if body.kind is not None:
        updates["kind"] = body.kind.strip().lower() or "wpłata"
    if not updates:
        raise HTTPException(400, "Brak zmian")
    r = await db.event_payments.update_one(
        {"id": payment_id, "event_id": event_id, "owner_id": ws(user)},
        {"$set": updates},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Nie znaleziono wpłaty")
    doc = await db.event_payments.find_one({"id": payment_id}, {"_id": 0})
    return doc


@api.delete("/events/{event_id}/payments/{payment_id}")
async def delete_event_payment(event_id: str, payment_id: str, user=Depends(require_admin)):
    doc = await db.event_payments.find_one({"id": payment_id, "event_id": event_id, "owner_id": ws(user)}, {"_id": 0})
    await db.event_payments.delete_one(
        {"id": payment_id, "event_id": event_id, "owner_id": ws(user)}
    )
    if doc:
        await log_change(user, "delete", "event_payment", payment_id,
                         f"Usunięto wpłatę {doc.get('amount',0)} zł")
    return {"ok": True}


# ---------- Finance Summary v2.0 (Faza 3B) ----------
# Realny przychód (revenue_real) = suma wpłat klientów w okresie
# Realne koszty (costs_real) = suma expenses w okresie
# Realny zysk (profit_real) = revenue_real - costs_real
# Należności (receivables) = SUM(price_total - wpłaty) dla eventów zaplanowanych w okresie
# Cena imprez (planned_revenue) = SUM(price_total) dla eventów w okresie

def _month_range(year: int, month: int) -> tuple[str, str]:
    """Zwraca (date_from, date_to) dla podanego miesiąca w formacie YYYY-MM-DD."""
    from calendar import monthrange
    last_day = monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


async def _finance_summary_v2(ws_id: str, date_from: str, date_to: str) -> dict:
    """
    KANONICZNY helper dla nowej logiki finansowej v2.0.
    Ważne: każda kwota liczona z pojedynczego źródła w bazie.
    """
    # 1) REALNY PRZYCHÓD — wpłaty w okresie (event_payments po dacie wpłaty)
    revenue_real = 0.0
    pay_count = 0
    async for p in db.event_payments.find({
        "owner_id": ws_id,
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"amount": 1}):
        revenue_real += float(p.get("amount") or 0)
        pay_count += 1

    # 2) REALNE KOSZTY — expenses w okresie (bez wypłat wspólników — Faza 4)
    costs_real = 0.0
    exp_count = 0
    async for e in db.expenses.find({
        "owner_id": ws_id,
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"amount": 1, "type": 1}):
        # W Fazie 4 wykluczymy tu wypłaty wspólników (type='partner_payout')
        if e.get("type") == "partner_payout":
            continue
        costs_real += float(e.get("amount") or 0)
        exp_count += 1

    # 3) EVENTY W OKRESIE (po dacie imprezy) → cena, wpłaty, należności
    events = await db.events.find({
        "owner_id": ws_id,
        "date": {"$gte": date_from, "$lte": date_to},
    }, {"_id": 0, "id": 1, "name": 1, "date": 1, "status": 1,
        "price_total": 1, "revenue": 1}).to_list(2000)

    n_events = len(events)
    n_by_status: Dict[str, int] = {}
    price_planned = 0.0
    for ev in events:
        st = (ev.get("status") or "").strip() or "brak"
        n_by_status[st] = n_by_status.get(st, 0) + 1
        # price_total ma pierwszeństwo, fallback revenue (starsze dane)
        p = float(ev.get("price_total") or 0) or float(ev.get("revenue") or 0)
        price_planned += p

    # Wpłaty per event (dla należności trzeba wiedzieć ile wpłacono w danym evencie)
    event_ids = [ev["id"] for ev in events]
    paid_per_event: Dict[str, float] = {eid: 0.0 for eid in event_ids}
    if event_ids:
        async for p in db.event_payments.find({
            "owner_id": ws_id, "event_id": {"$in": event_ids},
        }, {"event_id": 1, "amount": 1}):
            paid_per_event[p["event_id"]] = paid_per_event.get(p["event_id"], 0.0) + float(p.get("amount") or 0)

    # NALEŻNOŚCI = SUM max(0, price_total - wpłaty) dla nie-anulowanych
    receivables = 0.0
    for ev in events:
        status = (ev.get("status") or "").lower()
        if status in ("anulowana", "anulowane", "cancelled", "cancel"):
            continue
        price = float(ev.get("price_total") or 0) or float(ev.get("revenue") or 0)
        paid = paid_per_event.get(ev["id"], 0.0)
        outstanding = max(0.0, price - paid)
        receivables += outstanding

    profit_real = revenue_real - costs_real

    return {
        "date_from": date_from,
        "date_to": date_to,
        "revenue_real": round(revenue_real, 2),           # Realny przychód (wpłaty)
        "costs_real": round(costs_real, 2),               # Realne koszty
        "profit_real": round(profit_real, 2),             # Realny zysk
        "receivables": round(receivables, 2),             # Do pobrania
        "price_planned": round(price_planned, 2),         # Planowana wartość imprez
        "events_count": n_events,                         # Ile imprez w okresie
        "events_by_status": n_by_status,                  # Rozkład statusów
        "payments_count": pay_count,                      # Ile wpłat
        "expenses_count": exp_count,                      # Ile dokumentów kosztów
    }


@api.get("/finance/summary-v2")
async def finance_summary_v2(
    user=Depends(require_admin),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    period: Optional[str] = None,   # "current_month" | "prev_month" | "current_year"
):
    from datetime import date as _date
    today = _date.today()

    # Quick filters
    if period == "current_month":
        date_from, date_to = _month_range(today.year, today.month)
    elif period == "prev_month":
        y = today.year if today.month > 1 else today.year - 1
        m = today.month - 1 if today.month > 1 else 12
        date_from, date_to = _month_range(y, m)
    elif period == "current_year":
        date_from = f"{today.year:04d}-01-01"
        date_to = f"{today.year:04d}-12-31"

    if not date_from or not date_to:
        # Fallback: bieżący miesiąc
        date_from, date_to = _month_range(today.year, today.month)

    if len(date_from) < 8 or len(date_to) < 8:
        raise HTTPException(400, "Nieprawidłowy format daty")
    if date_from > date_to:
        raise HTTPException(400, "date_from musi być <= date_to")

    return await _finance_summary_v2(ws(user), date_from, date_to)


@api.get("/finance/monthly-series")
async def finance_monthly_series(user=Depends(require_admin), year: Optional[int] = None):
    """12 miesięcy przycho / koszty / zysk dla wykresu."""
    from datetime import date as _date
    if not year:
        year = _date.today().year
    out = []
    for m in range(1, 13):
        df, dt = _month_range(year, m)
        s = await _finance_summary_v2(ws(user), df, dt)
        out.append({
            "month": m,
            "label": f"{year:04d}-{m:02d}",
            "revenue_real": s["revenue_real"],
            "costs_real": s["costs_real"],
            "profit_real": s["profit_real"],
            "receivables": s["receivables"],
            "events_count": s["events_count"],
        })
    return {"year": year, "months": out}


# ---------- Partner Settlements (Faza 4A) ----------
# Osobna kolekcja wypłat wspólników. NIE są kosztami imprez ani firmy.
# Wypłaty pracowników godzinowych ZOSTAJĄ w `expenses` (bez zmian).

class PartnerSettlementIn(BaseModel):
    partner_id: str                  # staff.id z rolą staff_type="partner"
    amount: float
    date: str                        # YYYY-MM-DD
    method: Optional[str] = "Przelew"
    note: Optional[str] = ""
    kind: Optional[str] = "wypłata"  # "wypłata" | "zaliczka" | "zwrot"

class PartnerSettlementPatch(BaseModel):
    amount: Optional[float] = None
    date: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None
    kind: Optional[str] = None


@api.get("/partner-settlements")
async def list_partner_settlements(
    user=Depends(require_admin),
    partner_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q: dict = {"owner_id": ws(user)}
    if partner_id: q["partner_id"] = partner_id
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    rows = await db.partner_settlements.find(q, {"_id": 0}).sort("date", -1).to_list(1000)
    return rows


@api.get("/partner-settlements/summary")
async def partner_settlements_summary(
    user=Depends(require_admin),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Zwraca saldo per wspólnik + suma łączna."""
    q: dict = {"owner_id": ws(user)}
    if date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    per_partner: Dict[str, dict] = {}
    total = 0.0
    async for s in db.partner_settlements.find(q, {"_id": 0}):
        pid = s.get("partner_id") or "?"
        if pid not in per_partner:
            per_partner[pid] = {"partner_id": pid, "total": 0.0, "count": 0}
        per_partner[pid]["total"] += float(s.get("amount") or 0)
        per_partner[pid]["count"] += 1
        total += float(s.get("amount") or 0)
    # Get names
    ids = list(per_partner.keys())
    if ids:
        async for st in db.staff.find({"id": {"$in": ids}, "owner_id": ws(user)}, {"_id": 0, "id": 1, "name": 1}):
            if st["id"] in per_partner:
                per_partner[st["id"]]["partner_name"] = st.get("name", "")
    return {
        "total": round(total, 2),
        "by_partner": sorted(per_partner.values(), key=lambda x: -x["total"]),
    }


@api.post("/partner-settlements")
async def create_partner_settlement(body: PartnerSettlementIn, user=Depends(require_admin)):
    partner = await db.staff.find_one(
        {"id": body.partner_id, "owner_id": ws(user)}, {"_id": 0}
    )
    if not partner:
        raise HTTPException(404, "Nie znaleziono wspólnika")
    if partner.get("staff_type") != "partner":
        raise HTTPException(400, f"Pracownik {partner.get('name')} nie jest wspólnikiem. "
                                  "Najpierw ustaw jego 'staff_type' na 'partner'.")
    try:
        amt = float(body.amount)
    except Exception:
        raise HTTPException(400, "Nieprawidłowa kwota")
    if amt <= 0:
        raise HTTPException(400, "Kwota musi być większa od zera")
    if not body.date or len(body.date) < 8:
        raise HTTPException(400, "Podaj datę wypłaty")
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": ws(user),
        "partner_id": body.partner_id,
        "partner_name": partner.get("name", ""),
        "amount": round(amt, 2),
        "date": body.date,
        "method": (body.method or "Przelew").strip() or "Przelew",
        "note": (body.note or "").strip(),
        "kind": (body.kind or "wypłata").strip().lower(),
        "created_by": user.get("id"),
        "created_by_name": user.get("name") or user.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.partner_settlements.insert_one(dict(doc))
    await log_change(user, "create", "partner_settlement", doc["id"],
                     f"Wypłata wspólnika {partner.get('name','')}: {amt:.2f} zł")
    return {k: v for k, v in doc.items() if k != "_id"}


@api.patch("/partner-settlements/{sid}")
async def update_partner_settlement(sid: str, body: PartnerSettlementPatch, user=Depends(require_admin)):
    updates: dict = {}
    if body.amount is not None:
        try: a = float(body.amount)
        except Exception: raise HTTPException(400, "Nieprawidłowa kwota")
        if a <= 0: raise HTTPException(400, "Kwota musi być większa od zera")
        updates["amount"] = round(a, 2)
    if body.date is not None:
        if len(body.date) < 8: raise HTTPException(400, "Podaj datę")
        updates["date"] = body.date
    if body.method is not None:
        updates["method"] = body.method.strip() or "Przelew"
    if body.note is not None:
        updates["note"] = body.note.strip()
    if body.kind is not None:
        updates["kind"] = body.kind.strip().lower() or "wypłata"
    if not updates:
        raise HTTPException(400, "Brak zmian")
    r = await db.partner_settlements.update_one(
        {"id": sid, "owner_id": ws(user)}, {"$set": updates}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Nie znaleziono wypłaty")
    doc = await db.partner_settlements.find_one({"id": sid}, {"_id": 0})
    return doc


@api.delete("/partner-settlements/{sid}")
async def delete_partner_settlement(sid: str, user=Depends(require_admin)):
    doc = await db.partner_settlements.find_one({"id": sid, "owner_id": ws(user)}, {"_id": 0})
    r = await db.partner_settlements.delete_one({"id": sid, "owner_id": ws(user)})
    if doc:
        await log_change(user, "delete", "partner_settlement", sid,
                         f"Usunięto wypłatę wspólnika {doc.get('partner_name','')}")
    return {"ok": True, "deleted": r.deleted_count}


# ================================================================
# ---------- AI Asystent (GPT 5.6 Terra via Emergent LLM Key) ----
# ================================================================
# 3 funkcje na wspólnym ekranie „AI Asystent":
#  1. Asystent Biesiady — analiza nadchodzących imprez → wskazówki dnia
#  2. Generator ofert — brief klienta → gotowy tekst oferty
#  3. AI Czat — swobodny czat z kontekstem danych z apki (streaming)
#
# Wszystkie odpowiedzi po polsku. Model: gpt-5.6-terra (OpenAI).

_AI_MODEL_PROVIDER = "openai"
_AI_MODEL_NAME = "gpt-5.6-terra"

_AI_SYSTEM_BASE = (
    'Jesteś asystentem właściciela firmy cateringowej "Biesiada pod lasem". '
    'Odpowiadasz zwięźle, po polsku, w tonie rzeczowym i przyjaznym. '
    'Bazujesz WYŁĄCZNIE na danych podanych w kontekście — nie zmyślaj liczb ani nazwisk. '
    'Kwoty formatuj w złotych (np. "2 500 zł"). Daty w formacie "15 września 2026".'
)


class AITipsIn(BaseModel):
    period_days: Optional[int] = 14  # ile dni do przodu analizujemy


class AIOfferIn(BaseModel):
    brief: str                        # krótki opis od użytkownika
    tone: Optional[str] = "profesjonalny"  # profesjonalny | ciepły | krótki


class AIChatIn(BaseModel):
    session_id: str
    message: str


def _ai_get_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY") or ""
    if not key:
        raise HTTPException(500, "Brak klucza AI (EMERGENT_LLM_KEY). Skontaktuj się z administratorem.")
    if not _AI_AVAILABLE:
        raise HTTPException(500, "Biblioteka AI niedostępna. Uruchom ponownie serwer.")
    return key


async def _ai_build_events_context(user: dict, days: int = 14) -> str:
    """Buduje kompaktowy tekstowy kontekst nadchodzących imprez dla LLM."""
    today = datetime.now(timezone.utc).date().isoformat()
    until = (datetime.now(timezone.utc).date() + timedelta(days=max(1, min(days, 60)))).isoformat()
    q = {"owner_id": ws(user), "date": {"$gte": today, "$lte": until}}
    events = await db.events.find(q, {"_id": 0}).sort("date", 1).to_list(100)
    if not events:
        return "Brak nadchodzących imprez w najbliższych dniach."

    # Suma wpłat per event (event_payments)
    ids = [e.get("id") for e in events if e.get("id")]
    paid_by_event: Dict[str, float] = {}
    if ids:
        pipeline = [
            {"$match": {"owner_id": ws(user), "event_id": {"$in": ids}}},
            {"$group": {"_id": "$event_id", "sum": {"$sum": "$amount"}}},
        ]
        async for row in db.event_payments.aggregate(pipeline):
            paid_by_event[row["_id"]] = float(row.get("sum") or 0)

    lines = []
    for e in events:
        price = float(e.get("price_total") or e.get("revenue") or 0)
        paid = paid_by_event.get(e.get("id"), 0.0)
        remaining = max(0.0, price - paid)
        staff = len(e.get("shifts") or [])
        guests = int(e.get("guests") or 0)
        status = (e.get("status") or "").strip()
        lines.append(
            f"- {e.get('date')} | {e.get('name') or 'Impreza'} | {guests} os. "
            f"| cena {price:.0f} zł | wpłacono {paid:.0f} zł | pozostało {remaining:.0f} zł "
            f"| obsada {staff} osób | status: {status or '—'}"
        )
    return "NADCHODZĄCE IMPREZY:\n" + "\n".join(lines)


async def _ai_build_stats_context(user: dict) -> str:
    """Kontekst „biznesowy" — statystyki roku i miesiąca dla czatu."""
    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month
    # Wpłaty w tym miesiącu
    m_start = f"{year:04d}-{month:02d}-01"
    m_end = f"{year:04d}-{month:02d}-31"
    pipeline_pay = [
        {"$match": {"owner_id": ws(user), "date": {"$gte": m_start, "$lte": m_end}}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}, "n": {"$sum": 1}}},
    ]
    pay_agg = await db.event_payments.aggregate(pipeline_pay).to_list(1)
    pay_month = pay_agg[0] if pay_agg else {"sum": 0, "n": 0}
    # Wydatki w tym miesiącu (koszty firmowe)
    exp_agg = await db.expenses.aggregate([
        {"$match": {"owner_id": ws(user), "date": {"$gte": m_start, "$lte": m_end}}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}, "n": {"$sum": 1}}},
    ]).to_list(1)
    exp_month = exp_agg[0] if exp_agg else {"sum": 0, "n": 0}
    # Imprezy w tym miesiącu
    ev_count = await db.events.count_documents({"owner_id": ws(user), "date": {"$gte": m_start, "$lte": m_end}})
    ev_next_30 = await db.events.count_documents({
        "owner_id": ws(user),
        "date": {"$gte": now.date().isoformat(),
                  "$lte": (now.date() + timedelta(days=30)).isoformat()},
    })
    ev_year = await db.events.count_documents({"owner_id": ws(user), "date": {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}})
    profit = float(pay_month.get("sum") or 0) - float(exp_month.get("sum") or 0)
    return (
        f"KONTEKST BIZNESOWY (rok {year}):\n"
        f"- Imprezy w tym miesiącu ({month:02d}): {ev_count}\n"
        f"- Imprezy w ciągu 30 dni: {ev_next_30}\n"
        f"- Imprezy w tym roku: {ev_year}\n"
        f"- Wpłaty klientów w tym miesiącu: {float(pay_month.get('sum') or 0):.0f} zł ({int(pay_month.get('n') or 0)} wpłat)\n"
        f"- Koszty firmowe w tym miesiącu: {float(exp_month.get('sum') or 0):.0f} zł ({int(exp_month.get('n') or 0)} dok.)\n"
        f"- Wynik miesiąca (realny): {profit:.0f} zł"
    )


@api.post("/ai/assistant-tips")
async def ai_assistant_tips(body: AITipsIn, user=Depends(require_admin)):
    """Zwraca 3-5 krótkich wskazówek dnia bazując na nadchodzących imprezach."""
    key = _ai_get_key()
    ctx = await _ai_build_events_context(user, days=body.period_days or 14)
    system = (
        _AI_SYSTEM_BASE + " "
        "Twoje zadanie: przeanalizuj podane imprezy i zwróć od 3 do 5 KRÓTKICH, KONKRETNYCH wskazówek "
        "dla właściciela na dziś (max 15 słów każda). Skup się na: brakujących zaliczkach, brakującej "
        "obsadzie, ryzyku (mało czasu), pilnych telefonach. "
        "Odpowiedź MUSI być w formacie JSON: "
        '{ "tips": [ { "severity": "error|warning|info", "text": "...", "action": "..." } ] } '
        'Bez dodatkowego tekstu, tylko JSON. Pole "action" to krótki opis co zrobić (np. "Zadzwoń do klienta").'
    )
    session_id = f"tips-{ws(user)}-{uuid.uuid4()}"
    chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(
        _AI_MODEL_PROVIDER, _AI_MODEL_NAME
    )
    try:
        raw = await chat.send_message(UserMessage(text=ctx))
    except Exception as e:
        logging.exception("AI tips failed")
        raise HTTPException(502, f"Błąd AI: {str(e)[:200]}")
    # Parsuj JSON
    import re as _re2
    text = str(raw or "").strip()
    m = _re2.search(r"\{.*\}", text, _re2.DOTALL)
    parsed: dict = {}
    if m:
        try:
            parsed = _json.loads(m.group(0))
        except Exception:
            parsed = {}
    tips = parsed.get("tips") if isinstance(parsed, dict) else None
    if not isinstance(tips, list):
        # fallback: zwróć surowe zdanie
        tips = [{"severity": "info", "text": text[:200] or "Brak sugestii.", "action": ""}]
    # sanityzacja
    out = []
    for t in tips[:5]:
        if not isinstance(t, dict): continue
        sev = (t.get("severity") or "info").lower()
        if sev not in ("error", "warning", "info", "success"): sev = "info"
        out.append({
            "severity": sev,
            "text": str(t.get("text") or "").strip()[:220],
            "action": str(t.get("action") or "").strip()[:80],
        })
    return {"tips": out, "generated_at": datetime.now(timezone.utc).isoformat()}


@api.post("/ai/generate-offer")
async def ai_generate_offer(body: AIOfferIn, user=Depends(require_admin)):
    """Generuje gotowy tekst oferty w oparciu o krótki brief."""
    key = _ai_get_key()
    brief = (body.brief or "").strip()
    if len(brief) < 5:
        raise HTTPException(400, "Podaj krótki opis imprezy (min. 5 znaków).")
    tone = (body.tone or "profesjonalny").lower()
    tone_desc = {
        "profesjonalny": "Ton profesjonalny, uprzejmy, formalny (per Pan/Pani).",
        "ciepły":        "Ton ciepły, przyjazny, personalny (per Ty).",
        "krótki":        "Ton krótki i konkretny. Max 6 zdań.",
    }.get(tone, "Ton profesjonalny, uprzejmy.")
    system = (
        _AI_SYSTEM_BASE + " "
        "Twoje zadanie: na podstawie briefu klienta napisz gotowy tekst oferty cateringowej po polsku "
        "gotowy do wysłania SMS-em lub e-mailem. "
        f"{tone_desc} "
        "Struktura odpowiedzi: 1) powitanie 2) opis pakietu (2-4 zdania) 3) cena orientacyjna "
        "(jeśli w briefie jest liczba gości, przyjmij 250-350 zł/os. — podaj widełki) 4) prośba o kontakt. "
        "Bez podpisu z imieniem — właściciel doda ręcznie. Bez markdown-a, sam tekst."
    )
    session_id = f"offer-{ws(user)}-{uuid.uuid4()}"
    chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(
        _AI_MODEL_PROVIDER, _AI_MODEL_NAME
    )
    try:
        raw = await chat.send_message(UserMessage(text=f"Brief klienta: {brief}"))
    except Exception as e:
        logging.exception("AI offer failed")
        raise HTTPException(502, f"Błąd AI: {str(e)[:200]}")
    return {"offer": str(raw or "").strip(), "generated_at": datetime.now(timezone.utc).isoformat()}


@api.post("/ai/chat")
async def ai_chat(body: AIChatIn, user=Depends(require_admin)):
    """
    Prosty czat z pamięcią sesji (przechowywaną w ai_chat_messages).
    Zwraca odpowiedź jednorazowo (nie SSE) — MVP.
    """
    key = _ai_get_key()
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(400, "Wiadomość nie może być pusta.")
    sid = (body.session_id or "").strip() or f"chat-{ws(user)}-{uuid.uuid4()}"

    # Załaduj kontekst danych właściciela
    events_ctx = await _ai_build_events_context(user, days=30)
    stats_ctx = await _ai_build_stats_context(user)
    system = (
        _AI_SYSTEM_BASE + " "
        "Odpowiadasz na pytania właściciela o jego imprezy, przychody, koszty i statystyki. "
        "Bazuj wyłącznie na podanym kontekście danych. Jeśli w kontekście brak informacji, "
        'otwarcie powiedz "nie mam danych, żeby to policzyć" — NIE zmyślaj. '
        "Odpowiedzi krótkie (max 4-5 zdań), zwięzłe, po polsku.\n\n" + stats_ctx + "\n\n" + events_ctx
    )

    # Zapis wiadomości user do bazy
    user_msg_doc = {
        "id": str(uuid.uuid4()),
        "session_id": sid,
        "owner_id": ws(user),
        "role": "user",
        "content": msg,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_chat_messages.insert_one(dict(user_msg_doc))

    chat = LlmChat(api_key=key, session_id=sid, system_message=system).with_model(
        _AI_MODEL_PROVIDER, _AI_MODEL_NAME
    )
    try:
        raw = await chat.send_message(UserMessage(text=msg))
    except Exception as e:
        logging.exception("AI chat failed")
        raise HTTPException(502, f"Błąd AI: {str(e)[:200]}")

    reply = str(raw or "").strip()
    assistant_msg_doc = {
        "id": str(uuid.uuid4()),
        "session_id": sid,
        "owner_id": ws(user),
        "role": "assistant",
        "content": reply,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_chat_messages.insert_one(dict(assistant_msg_doc))
    return {"session_id": sid, "reply": reply}


@api.get("/ai/chat/history")
async def ai_chat_history(user=Depends(require_admin), session_id: Optional[str] = None, limit: int = 50):
    """Zwraca historię wiadomości w sesji (do rehydratacji ekranu)."""
    q: dict = {"owner_id": ws(user)}
    if session_id: q["session_id"] = session_id
    rows = await db.ai_chat_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(max(1, min(limit, 200)))
    return rows


@api.delete("/ai/chat/history")
async def ai_chat_clear(user=Depends(require_admin), session_id: Optional[str] = None):
    """Czyści historię czatu (całą lub jedną sesję)."""
    q: dict = {"owner_id": ws(user)}
    if session_id: q["session_id"] = session_id
    r = await db.ai_chat_messages.delete_many(q)
    return {"ok": True, "deleted": r.deleted_count}


class AICostCoachIn(BaseModel):
    year: Optional[int] = None
    month: Optional[int] = None  # 1-12


# Ścieżka do PDF-a oferty cateringowej (załącznik dla imprez firmowych)
_OFFER_PDF_PATH = "/app/backend/assets/offers/Biesiada_pod_Lasem_Oferta_Gastronomiczna_2026.pdf"


class AISendOfferIn(BaseModel):
    to_email: str
    client_name: Optional[str] = ""
    subject: Optional[str] = ""
    body_text: str
    event_kind: str = "okolicznosciowa"  # okolicznosciowa | firmowa
    mode: str = "offer"                   # offer | summary
    event_id: Optional[str] = ""
    attach_offer_pdf: Optional[bool] = None  # override — domyślnie True dla firmowa+offer


class AISummaryIn(BaseModel):
    event_id: str


def _detect_event_kind(text: str) -> str:
    """Prosta heurystyka wykrywająca typ imprezy z tekstu (brief / opis)."""
    t = (text or "").lower()
    corp = ["firm", "korpo", "integrac", "spółk", "sp. z o.o", "biznes", "b2b", "pracowni", "wieczor"]
    if any(k in t for k in corp): return "firmowa"
    return "okolicznosciowa"


@api.get("/clients/known")
async def list_known_clients(user=Depends(require_admin), q: Optional[str] = None, limit: int = 200):
    """Zwraca zdedublowaną listę klientów wyciągniętych z pola events.client_*."""
    match: dict = {"owner_id": ws(user)}
    if q:
        match["$or"] = [
            {"client_name":  {"$regex": q, "$options": "i"}},
            {"client_email": {"$regex": q, "$options": "i"}},
            {"client_phone": {"$regex": q, "$options": "i"}},
        ]
    pipe = [
        {"$match": match},
        {"$match": {"$or": [
            {"client_email": {"$exists": True, "$nin": ["", None]}},
            {"client_phone": {"$exists": True, "$nin": ["", None]}},
        ]}},
        {"$sort": {"date": -1}},
        {"$group": {
            "_id": {"$toLower": {"$ifNull": ["$client_email", "$client_phone"]}},
            "name":  {"$first": "$client_name"},
            "email": {"$first": "$client_email"},
            "phone": {"$first": "$client_phone"},
            "last_event_date": {"$first": "$date"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"last_event_date": -1}},
        {"$limit": max(1, min(limit, 500))},
        {"$project": {"_id": 0, "name": 1, "email": 1, "phone": 1, "last_event_date": 1, "count": 1}},
    ]
    rows: List[dict] = []
    async for r in db.events.aggregate(pipe):
        if not (r.get("email") or r.get("phone")): continue
        rows.append(r)
    return rows


@api.post("/ai/detect-kind")
async def ai_detect_kind(body: dict, user=Depends(require_admin)):
    """Zwraca sugerowany typ imprezy z briefu (bez wywołania LLM — lokalna heurystyka)."""
    text = str(body.get("brief") or body.get("text") or "")
    return {"event_kind": _detect_event_kind(text)}


@api.post("/ai/generate-summary")
async def ai_generate_summary(body: AISummaryIn, user=Depends(require_admin)):
    """Generuje podsumowanie szczegółów imprezy (potwierdzenie do klienta) — tekst gotowy do maila."""
    key = _ai_get_key()
    ev = await db.events.find_one({"owner_id": ws(user), "id": body.event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Nie znaleziono imprezy")

    # Wpłaty
    paid_agg = await db.event_payments.aggregate([
        {"$match": {"owner_id": ws(user), "event_id": ev.get("id")}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
    ]).to_list(1)
    paid = float(paid_agg[0]["sum"]) if paid_agg else 0.0
    price = float(ev.get("price_total") or ev.get("revenue") or 0)
    remaining = max(0.0, price - paid)

    ctx = (
        f"Klient: {ev.get('client_name') or '—'}\n"
        f"Data: {ev.get('date') or '—'}\n"
        f"Godziny: {ev.get('time_start') or '—'} - {ev.get('time_end') or '—'}\n"
        f"Nazwa imprezy: {ev.get('name') or '—'}\n"
        f"Kategoria: {ev.get('category') or '—'}\n"
        f"Liczba gości: {ev.get('guests') or 0}\n"
        f"Ustalona cena: {price:.0f} zł\n"
        f"Wpłacono: {paid:.0f} zł\n"
        f"Do zapłaty: {remaining:.0f} zł\n"
        f"Notatki: {ev.get('notes') or '—'}\n"
    )
    system = (
        _AI_SYSTEM_BASE + " "
        "Twoje zadanie: napisz gotowy do wysłania e-mail POTWIERDZAJĄCY szczegóły imprezy dla klienta. "
        "Ton: profesjonalny, uprzejmy, per Pan/Pani. Format: 1) powitanie 2) potwierdzenie daty i godzin "
        "3) lista uzgodnionych szczegółów (goście, cena, wpłacona zaliczka, pozostała kwota) 4) prośba o "
        "kontakt w razie zmian. Bez podpisu — właściciel doda ręcznie. Sam tekst, bez markdown-a."
    )
    session_id = f"summary-{ws(user)}-{uuid.uuid4()}"
    chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(
        _AI_MODEL_PROVIDER, _AI_MODEL_NAME
    )
    try:
        raw = await chat.send_message(UserMessage(text=ctx))
    except Exception as e:
        logging.exception("AI summary failed")
        raise HTTPException(502, f"Błąd AI: {str(e)[:200]}")
    return {"summary": str(raw or "").strip(), "event": {
        "date": ev.get("date"), "name": ev.get("name"), "guests": ev.get("guests"),
        "price": price, "paid": paid, "remaining": remaining,
        "client_name": ev.get("client_name"), "client_email": ev.get("client_email"),
    }}


@api.post("/ai/send-offer-email")
async def ai_send_offer_email(body: AISendOfferIn, user=Depends(require_admin)):
    """Wysyła wygenerowany tekst oferty/podsumowania na e-mail klienta. Załącznik PDF dla imprez firmowych."""
    from offer_email import send_offer_email

    email = (body.to_email or "").strip()
    text = (body.body_text or "").strip()
    if not email or "@" not in email:
        raise HTTPException(400, "Nieprawidłowy adres e-mail")
    if len(text) < 20:
        raise HTTPException(400, "Za krótka treść wiadomości")

    kind = (body.event_kind or "okolicznosciowa").lower()
    mode = (body.mode or "offer").lower()
    attach_pdf = body.attach_offer_pdf if body.attach_offer_pdf is not None else (kind == "firmowa" and mode == "offer")

    subject = (body.subject or "").strip()
    if not subject:
        if mode == "summary":
            subject = "Podsumowanie szczegółów imprezy — Biesiada pod Lasem"
        else:
            subject = "Oferta — Biesiada pod Lasem"

    extra_attachments = []
    if attach_pdf and os.path.exists(_OFFER_PDF_PATH):
        extra_attachments.append({
            "path": _OFFER_PDF_PATH,
            "filename": "Biesiada_pod_Lasem_Oferta_Gastronomiczna_2026.pdf",
            "mime": "application/pdf",
        })

    # Personalizacja: dodaj powitanie z imieniem jeśli brief nie zawiera
    who = (body.client_name or "").strip()
    if who and "dzień dobry" not in text.lower() and "witam" not in text.lower():
        text = f"Dzień dobry {who},\n\n{text}"

    try:
        send_offer_email(
            to_email=email,
            subject=subject,
            body_text=text,
            extra_attachments=extra_attachments,
        )
    except Exception as e:
        logging.exception("Email send failed")
        raise HTTPException(502, f"Nie udało się wysłać maila: {str(e)[:200]}")

    # Log do bazy — dla audytu
    log_doc = {
        "id": str(uuid.uuid4()),
        "owner_id": ws(user),
        "to_email": email,
        "client_name": who or None,
        "subject": subject,
        "event_kind": kind,
        "mode": mode,
        "event_id": body.event_id or None,
        "attached_offer_pdf": attach_pdf,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try: await db.ai_email_logs.insert_one(dict(log_doc))
    except Exception: pass

    return {"ok": True, "attached_pdf": attach_pdf, "subject": subject}


@api.post("/ai/cost-coach")
async def ai_cost_coach(body: AICostCoachIn, user=Depends(require_admin)):
    """Comiesięczna analiza kosztów: kategorie, zmiany m/m, sugestie cięć."""
    key = _ai_get_key()
    now = datetime.now(timezone.utc)
    y = int(body.year or now.year)
    m = int(body.month or now.month)
    if not (1 <= m <= 12): raise HTTPException(400, "Nieprawidłowy miesiąc")

    def month_range(yy: int, mm: int):
        last = 31
        if mm in (4, 6, 9, 11): last = 30
        if mm == 2:
            last = 29 if (yy % 4 == 0 and (yy % 100 != 0 or yy % 400 == 0)) else 28
        return f"{yy:04d}-{mm:02d}-01", f"{yy:04d}-{mm:02d}-{last:02d}"

    cur_from, cur_to = month_range(y, m)
    py = y if m > 1 else y - 1
    pm = m - 1 if m > 1 else 12
    prev_from, prev_to = month_range(py, pm)

    async def group_by_cat(df: str, dt: str):
        pipe = [
            {"$match": {"owner_id": ws(user), "date": {"$gte": df, "$lte": dt}}},
            {"$group": {"_id": {"$ifNull": ["$category", "Inne"]}, "sum": {"$sum": "$amount"}, "n": {"$sum": 1}}},
        ]
        rows: Dict[str, dict] = {}
        async for r in db.expenses.aggregate(pipe):
            cat = str(r.get("_id") or "Inne")
            rows[cat] = {"category": cat, "sum": float(r.get("sum") or 0), "count": int(r.get("n") or 0)}
        return rows

    cur_cats = await group_by_cat(cur_from, cur_to)
    prev_cats = await group_by_cat(prev_from, prev_to)

    cur_total = sum(x["sum"] for x in cur_cats.values())
    prev_total = sum(x["sum"] for x in prev_cats.values())

    # Merge into list with change %
    all_cats = set(cur_cats.keys()) | set(prev_cats.keys())
    breakdown = []
    for c in all_cats:
        cs = cur_cats.get(c, {"sum": 0.0, "count": 0})
        ps = prev_cats.get(c, {"sum": 0.0, "count": 0})
        change_pct = None
        if ps["sum"] > 0:
            change_pct = round(((cs["sum"] - ps["sum"]) / ps["sum"]) * 100)
        breakdown.append({
            "category": c,
            "current": round(cs["sum"], 2),
            "previous": round(ps["sum"], 2),
            "change_pct": change_pct,
            "count": cs["count"],
        })
    breakdown.sort(key=lambda x: -x["current"])

    if cur_total == 0 and prev_total == 0:
        return {
            "period": f"{y:04d}-{m:02d}",
            "current_total": 0,
            "previous_total": 0,
            "breakdown": [],
            "summary": "Brak kosztów w analizowanym miesiącu — nie mam czego analizować.",
            "suggestions": [],
        }

    # Kontekst dla LLM
    ctx_lines = [f"Miesiąc analizowany: {y}-{m:02d}", f"Poprzedni miesiąc: {py}-{pm:02d}",
                 f"Łączne koszty (bieżący): {cur_total:.0f} zł", f"Łączne koszty (poprzedni): {prev_total:.0f} zł",
                 "", "KOSZTY PER KATEGORIA (bieżący vs poprzedni):"]
    for b in breakdown[:15]:
        cp = f", zmiana {b['change_pct']:+d}%" if b["change_pct"] is not None else ""
        ctx_lines.append(f"- {b['category']}: {b['current']:.0f} zł (poprzednio {b['previous']:.0f} zł{cp}), {b['count']} dok.")

    system = (
        _AI_SYSTEM_BASE + " "
        "Twoja rola: coach kosztów. Analizujesz koszty firmy cateringowej per kategoria "
        "i wskazujesz KONKRETNE sugestie cięć. Format odpowiedzi to JSON: "
        '{ "summary": "krótki opis w 1-2 zdaniach", '
        '"suggestions": [ { "category": "...", "impact": "wysoki|średni|niski", "text": "...", "action": "..." } ] } '
        "Zwróć 3-5 sugestii. Bez dodatkowego tekstu, tylko JSON. Sugestie muszą być konkretne "
        '(np. "koszty napojów wzrosły o 40% — porównaj ceny u dwóch nowych dostawców") i realne '
        '(bez ogólników typu "oszczędzaj więcej"). Skup się na kategoriach które WZROSŁY najbardziej '
        "lub zajmują największą część budżetu."
    )
    session_id = f"cost-coach-{ws(user)}-{uuid.uuid4()}"
    chat = LlmChat(api_key=key, session_id=session_id, system_message=system).with_model(
        _AI_MODEL_PROVIDER, _AI_MODEL_NAME
    )
    try:
        raw = await chat.send_message(UserMessage(text="\n".join(ctx_lines)))
    except Exception as e:
        logging.exception("AI cost coach failed")
        raise HTTPException(502, f"Błąd AI: {str(e)[:200]}")

    import re as _re3
    text = str(raw or "").strip()
    m2 = _re3.search(r"\{.*\}", text, _re3.DOTALL)
    parsed: dict = {}
    if m2:
        try: parsed = _json.loads(m2.group(0))
        except Exception: parsed = {}

    return {
        "period": f"{y:04d}-{m:02d}",
        "current_total": round(cur_total, 2),
        "previous_total": round(prev_total, 2),
        "change_pct": round(((cur_total - prev_total) / prev_total) * 100) if prev_total > 0 else None,
        "breakdown": breakdown[:10],
        "summary": str(parsed.get("summary") or "").strip()[:300] or text[:300],
        "suggestions": parsed.get("suggestions") if isinstance(parsed.get("suggestions"), list) else [],
    }


app.include_router(api)



@app.on_event("shutdown")
async def _shutdown():
    global _scheduler
    try:
        if _scheduler:
            _scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()

