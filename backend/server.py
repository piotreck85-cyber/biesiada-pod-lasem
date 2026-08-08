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
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Nieprawidłowy token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Użytkownik nie istnieje")
    if not user.get("workspace_id"):
        user["workspace_id"] = user["id"]
    return user

def ws(user: dict) -> str:
    """Workspace id used to scope all data queries."""
    return user.get("workspace_id") or user["id"]

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

@api.delete("/auth/me")
async def delete_account(user=Depends(current_user)):
    """Delete user account and all associated data (events, staff, templates)."""
    uid = user["id"]
    await db.events.delete_many({"owner_id": uid})
    await db.staff.delete_many({"owner_id": uid})
    await db.templates.delete_many({"owner_id": uid})
    await db.users.delete_one({"id": uid})
    return {"ok": True}

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
    return doc

@api.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(current_user)):
    await db.staff.delete_one({"id": staff_id, "owner_id": ws(user)})
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
    return await compute_event_summary(doc)

@api.get("/events/{event_id}")
async def get_event(event_id: str, user=Depends(current_user)):
    ev = await db.events.find_one({"id": event_id, "owner_id": ws(user)}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Impreza nie znaleziona")
    return await compute_event_summary(ev)

@api.put("/events/{event_id}")
async def update_event(event_id: str, body: EventIn, user=Depends(current_user)):
    res = await db.events.update_one(
        {"id": event_id, "owner_id": ws(user)},
        {"$set": body.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Impreza nie znaleziona")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    return await compute_event_summary(ev)

@api.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(current_user)):
    await db.events.delete_one({"id": event_id, "owner_id": ws(user)})
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
    events = await db.events.find({"owner_id": ws(user)}, {"_id": 0}).sort("date", 1).to_list(10000)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Biesiada pod lasem//PL//", "CALSCALE:GREGORIAN"]
    for ev in events:
        date = str(ev.get("date", "")).replace("-", "")
        time_str = str(ev.get("time") or "").replace(":", "")
        if len(time_str) >= 4 and len(date) == 8:
            try:
                hh = int(time_str[:2]); mm = int(time_str[2:4])
                start_dt = datetime(int(date[:4]), int(date[4:6]), int(date[6:8]), hh, mm)
                end_dt = start_dt + timedelta(hours=4)
                dtstart = start_dt.strftime("%Y%m%dT%H%M00")
                dtend = end_dt.strftime("%Y%m%dT%H%M00")
                dt_line = f"DTSTART:{dtstart}\r\nDTEND:{dtend}"
            except Exception:
                dt_line = f"DTSTART;VALUE=DATE:{date}"
        else:
            dt_line = f"DTSTART;VALUE=DATE:{date}"
        summary = str(ev.get("name", "Impreza")).replace("\n", " ")
        location = str(ev.get("venue", "")).replace("\n", " ")
        desc = str(ev.get("notes", "")).replace("\n", "\\n")
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{ev.get('id')}@eventa")
        lines.append(dt_line)
        lines.append(f"SUMMARY:{summary}")
        if location: lines.append(f"LOCATION:{location}")
        if desc: lines.append(f"DESCRIPTION:{desc}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines), media_type="text/calendar")

@api.post("/import/ics")
async def import_ics(body: ImportIcsIn, user=Depends(current_user)):
    """Parse an iCal file and create events. Only events within the last N years are imported."""
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
    skipped_future_limit = 0
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
        doc = {
            "id": str(uuid.uuid4()),
            "owner_id": ws(user),
            "name": ev.get("SUMMARY", "Impreza"),
            "date": date_str,
            "time": time_str,
            "venue": ev.get("LOCATION", ""),
            "notes": ev.get("DESCRIPTION", "").replace("\\n", "\n").replace("\\,", ","),
            "category": "",
            "revenue": 0.0,
            "costs": [],
            "shifts": [],
            "image_url": "",
            "created_at": now_utc().isoformat(),
        }
        # De-dup by UID if provided
        uid = ev.get("UID")
        if uid:
            existing = await db.events.find_one({"owner_id": ws(user), "imported_uid": uid})
            if existing:
                continue
            doc["imported_uid"] = uid
        await db.events.insert_one(doc)
        imported += 1
    return {"ok": True, "imported": imported, "skipped_older_than_cutoff": skipped_old, "total_parsed": len(events_raw)}

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
    return doc

@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(current_user)):
    await db.expenses.delete_one({"id": expense_id, "owner_id": ws(user)})
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

@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.events.create_index([("owner_id", 1), ("date", -1)])
    await db.staff.create_index([("owner_id", 1)])

@app.on_event("shutdown")
async def _shutdown():
    client.close()
