from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, uuid, io, csv, logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
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

# ---------- Google Calendar sync helpers ----------
import google_calendar as gcal
from fastapi.responses import HTMLResponse


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
    role: Optional[str] = ""
    hourly_rate: float = 0.0

class CostItem(BaseModel):
    label: str
    amount: float

class StaffShift(BaseModel):
    staff_id: str
    hours: float = 0.0
    time_start: Optional[str] = ""  # HH:MM
    time_end: Optional[str] = ""    # HH:MM

class EventIn(BaseModel):
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
    deposit_paid: Optional[bool] = False
    deposit_amount: Optional[float] = 0.0
    deposit_date: Optional[str] = ""

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

async def compute_event_summary(ev: dict, staff_map: Optional[dict] = None) -> dict:
    """Enrich event with labor_cost & profit.

    If a preloaded ``staff_map`` (id -> staff doc) is supplied, no DB call is made.
    Otherwise, this function fetches only the staff referenced by the event's shifts.
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
    token = make_token(u["id"])
    return {"access_token": token, "user": {"id": u["id"], "email": u["email"], "name": u.get("name", "")}}

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
    greeting = f"Dzień dobry {who}," if who else "Dzień dobry,"

    # Attachment strategy per event type
    is_workshops = body.event_type == "warsztaty"
    is_adult = body.event_type in ("okolicznosciowe", "firmowe")
    is_birthday = body.event_type == "urodziny"
    att_mode = (body.attachments_mode or "both").lower()
    if att_mode not in ("grill", "dinner", "both"):
        att_mode = "both"

    if is_birthday:
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
        skip_auto_pdf = body.event_type in ("okolicznosciowe", "firmowe", "warsztaty", "urodziny")

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

# ---------- Staff ----------
@api.get("/staff")
async def list_staff(user=Depends(current_user)):
    items = await db.staff.find({"owner_id": ws(user)}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api.post("/staff")
async def create_staff(body: StaffIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "staff", doc["id"], f"Dodano pracownika: {doc.get('name','')}")
    return doc

@api.put("/staff/{staff_id}")
async def update_staff(staff_id: str, body: StaffIn, user=Depends(current_user)):
    res = await db.staff.update_one(
        {"id": staff_id, "owner_id": ws(user)},
        {"$set": body.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Pracownik nie znaleziony")
    doc = await db.staff.find_one({"id": staff_id}, {"_id": 0})
    await log_change(user, "update", "staff", staff_id, f"Edytowano pracownika: {doc.get('name','')}")
    return doc

@api.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(current_user)):
    doc = await db.staff.find_one({"id": staff_id, "owner_id": ws(user)}, {"_id": 0})
    await db.staff.delete_one({"id": staff_id, "owner_id": ws(user)})
    if doc: await log_change(user, "delete", "staff", staff_id, f"Usunięto pracownika: {doc.get('name','')}")
    return {"ok": True}

# ---------- Events ----------
@api.get("/events")
async def list_events(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    items = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    staff_map = await load_owner_staff_map(user["id"])
    enriched = []
    for ev in items:
        enriched.append(await compute_event_summary(ev, staff_map))
    return enriched

@api.post("/events")
async def create_event(body: EventIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "event", doc["id"], f"Utworzono imprezę: {doc.get('name','')} ({doc.get('date','')})")
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
async def update_event(event_id: str, body: EventIn, user=Depends(current_user)):
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
async def delete_event(event_id: str, user=Depends(current_user)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    # sync BEFORE delete so we still have google_event_ids
    try:
        if ev:
            await _sync_event_for_workspace(ws(user), event_id, "delete")
    except Exception:
        pass
    await db.events.delete_one({"id": event_id, "owner_id": ws(user)})
    if ev: await log_change(user, "delete", "event", event_id, f"Usunięto imprezę: {ev.get('name','')} ({ev.get('date','')})")
    return {"ok": True}

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
async def export_backup(user=Depends(current_user)):
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
    skipped_old = 0
    skipped_dup_uid = 0
    skipped_dup_name = 0

    # Preload existing (date, name-lowercased) pairs for the workspace for O(1) fallback dedup
    existing_docs = await db.events.find(
        {"owner_id": ws(user)}, {"_id": 0, "date": 1, "name": 1, "imported_uid": 1}
    ).to_list(20000)
    existing_uids = {d.get("imported_uid") for d in existing_docs if d.get("imported_uid")}
    existing_date_name = {(d.get("date", ""), (d.get("name") or "").strip().lower()) for d in existing_docs}

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

        # Dedup 1: UID (if present)
        uid = ev.get("UID")
        if uid and uid in existing_uids:
            skipped_dup_uid += 1
            continue

        # Dedup 2: same (date, name) already in DB
        dedup_key = (date_str, name.lower())
        if dedup_key in existing_date_name:
            skipped_dup_name += 1
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
            "venue": ev.get("LOCATION", ""),
            "notes": ev.get("DESCRIPTION", "").replace("\\n", "\n").replace("\\,", ","),
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
        "skipped_older_than_cutoff": skipped_old,
        "skipped_duplicate_uid": skipped_dup_uid,
        "skipped_duplicate_name_date": skipped_dup_name,
        "total_parsed": len(events_raw),
    }

# ---------- Company Expenses ----------
@api.get("/expenses")
async def list_expenses(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": ws(user)}
    if year and month:
        q["date"] = {"$regex": f"^{year:04d}-{month:02d}"}
    elif year:
        q["date"] = {"$regex": f"^{year:04d}-"}
    items = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items

@api.post("/expenses")
async def create_expense(body: ExpenseIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = ws(user); doc["created_by_id"] = user["id"]; doc["created_by_name"] = user.get("name") or user.get("email", "")
    doc["created_at"] = now_utc().isoformat()
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    await log_change(user, "create", "expense", doc["id"], f"Dodano koszt: {doc.get('label','')} ({doc.get('amount',0)} zł)")
    return doc

@api.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseIn, user=Depends(current_user)):
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
async def delete_expense(expense_id: str, user=Depends(current_user)):
    doc = await db.expenses.find_one({"id": expense_id, "owner_id": ws(user)}, {"_id": 0})
    await db.expenses.delete_one({"id": expense_id, "owner_id": ws(user)})
    if doc: await log_change(user, "delete", "expense", expense_id, f"Usunięto koszt: {doc.get('label','')} ({doc.get('amount',0)} zł)")
    return {"ok": True}

# ---------- Stats ----------
@api.get("/staff/wages")
async def staff_wages(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
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
async def stats(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
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
    per_event = []
    for ev in events:
        ev = await compute_event_summary(ev, staff_map)
        total_revenue += ev.get("revenue", 0)
        total_material += ev.get("material_cost", 0)
        total_labor += ev.get("labor_cost", 0)
        per_event.append({
            "id": ev["id"], "name": ev["name"], "date": ev["date"],
            "revenue": ev["revenue"], "total_cost": ev["total_cost"], "profit": ev["profit"],
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
        "events": per_event,
    }

# ---------- Export ----------
@api.get("/export/events")
async def export_events(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
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


app.include_router(api)

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

@app.on_event("shutdown")
async def _shutdown():
    global _scheduler
    try:
        if _scheduler:
            _scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()

