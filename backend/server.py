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
JWT_SECRET = os.environ.get('JWT_SECRET', 'eventa-dev-secret-change-me-please-2026')
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

class EventIn(BaseModel):
    name: str
    date: str  # ISO YYYY-MM-DD
    time: Optional[str] = ""
    venue: Optional[str] = ""
    notes: Optional[str] = ""
    revenue: float = 0.0
    costs: List[CostItem] = []
    shifts: List[StaffShift] = []
    image_url: Optional[str] = ""

class TemplateIn(BaseModel):
    name: str
    venue: Optional[str] = ""
    notes: Optional[str] = ""
    revenue: float = 0.0
    costs: List[CostItem] = []
    shifts: List[StaffShift] = []
    image_url: Optional[str] = ""

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
    return user

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

async def compute_event_summary(ev: dict) -> dict:
    """Enrich event with labor_cost & profit."""
    labor_cost = 0.0
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

# ---------- Staff ----------
@api.get("/staff")
async def list_staff(user=Depends(current_user)):
    items = await db.staff.find({"owner_id": user["id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api.post("/staff")
async def create_staff(body: StaffIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = user["id"]
    doc["created_at"] = now_utc().isoformat()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/staff/{staff_id}")
async def update_staff(staff_id: str, body: StaffIn, user=Depends(current_user)):
    res = await db.staff.update_one(
        {"id": staff_id, "owner_id": user["id"]},
        {"$set": body.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Pracownik nie znaleziony")
    doc = await db.staff.find_one({"id": staff_id}, {"_id": 0})
    return doc

@api.delete("/staff/{staff_id}")
async def delete_staff(staff_id: str, user=Depends(current_user)):
    await db.staff.delete_one({"id": staff_id, "owner_id": user["id"]})
    return {"ok": True}

# ---------- Events ----------
@api.get("/events")
async def list_events(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": user["id"]}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    items = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    enriched = []
    for ev in items:
        enriched.append(await compute_event_summary(ev))
    return enriched

@api.post("/events")
async def create_event(body: EventIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = user["id"]
    doc["created_at"] = now_utc().isoformat()
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return await compute_event_summary(doc)

@api.get("/events/{event_id}")
async def get_event(event_id: str, user=Depends(current_user)):
    ev = await db.events.find_one({"id": event_id, "owner_id": user["id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Impreza nie znaleziona")
    return await compute_event_summary(ev)

@api.put("/events/{event_id}")
async def update_event(event_id: str, body: EventIn, user=Depends(current_user)):
    res = await db.events.update_one(
        {"id": event_id, "owner_id": user["id"]},
        {"$set": body.dict()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Impreza nie znaleziona")
    ev = await db.events.find_one({"id": event_id}, {"_id": 0})
    return await compute_event_summary(ev)

@api.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(current_user)):
    await db.events.delete_one({"id": event_id, "owner_id": user["id"]})
    return {"ok": True}

# ---------- Templates ----------
@api.get("/templates")
async def list_templates(user=Depends(current_user)):
    items = await db.templates.find({"owner_id": user["id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    return items

@api.post("/templates")
async def create_template(body: TemplateIn, user=Depends(current_user)):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["owner_id"] = user["id"]
    doc["created_at"] = now_utc().isoformat()
    await db.templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.delete("/templates/{tpl_id}")
async def delete_template(tpl_id: str, user=Depends(current_user)):
    await db.templates.delete_one({"id": tpl_id, "owner_id": user["id"]})
    return {"ok": True}

# ---------- Backup Export / Import ----------
class BackupIn(BaseModel):
    staff: List[dict] = []
    events: List[dict] = []
    templates: List[dict] = []
    mode: str = "merge"  # "merge" or "replace"

@api.get("/export/backup")
async def export_backup(user=Depends(current_user)):
    staff = await db.staff.find({"owner_id": user["id"]}, {"_id": 0, "owner_id": 0}).to_list(5000)
    events = await db.events.find({"owner_id": user["id"]}, {"_id": 0, "owner_id": 0}).to_list(10000)
    templates = await db.templates.find({"owner_id": user["id"]}, {"_id": 0, "owner_id": 0}).to_list(5000)
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
        await db.staff.delete_many({"owner_id": user["id"]})
        await db.events.delete_many({"owner_id": user["id"]})
        await db.templates.delete_many({"owner_id": user["id"]})

    # Staff: keep original ids if provided (so shifts still match)
    for s in body.staff:
        doc = {k: v for k, v in s.items() if k != "_id"}
        doc["owner_id"] = user["id"]
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.staff.update_one(
            {"id": doc["id"], "owner_id": user["id"]},
            {"$set": doc}, upsert=True,
        )
        imported["staff"] += 1
    for ev in body.events:
        doc = {k: v for k, v in ev.items() if k not in ("_id", "labor_cost", "material_cost", "total_cost", "profit")}
        doc["owner_id"] = user["id"]
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.events.update_one(
            {"id": doc["id"], "owner_id": user["id"]},
            {"$set": doc}, upsert=True,
        )
        imported["events"] += 1
    for tpl in body.templates:
        doc = {k: v for k, v in tpl.items() if k != "_id"}
        doc["owner_id"] = user["id"]
        if "id" not in doc: doc["id"] = str(uuid.uuid4())
        await db.templates.update_one(
            {"id": doc["id"], "owner_id": user["id"]},
            {"$set": doc}, upsert=True,
        )
        imported["templates"] += 1
    return {"ok": True, "imported": imported}

@api.get("/export/calendar.ics")
async def export_ics(user=Depends(current_user)):
    events = await db.events.find({"owner_id": user["id"]}, {"_id": 0}).sort("date", 1).to_list(10000)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Eventa//PL//", "CALSCALE:GREGORIAN"]
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

# ---------- Stats ----------
@api.get("/stats")
async def stats(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": user["id"]}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    events = await db.events.find(q, {"_id": 0}).to_list(5000)
    total_revenue = 0.0
    total_material = 0.0
    total_labor = 0.0
    per_event = []
    for ev in events:
        ev = await compute_event_summary(ev)
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
        "profit": round(total_revenue - total_cost, 2),
        "events": per_event,
    }

# ---------- Export ----------
@api.get("/export/events")
async def export_events(user=Depends(current_user), year: Optional[int] = None, month: Optional[int] = None):
    q = {"owner_id": user["id"]}
    if year and month:
        prefix = f"{year:04d}-{month:02d}"
        q["date"] = {"$regex": f"^{prefix}"}
    events = await db.events.find(q, {"_id": 0}).sort("date", 1).to_list(5000)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Data", "Impreza", "Miejsce", "Przychód (PLN)", "Koszty materiałowe (PLN)", "Koszty pracy (PLN)", "Zysk (PLN)"])
    for ev in events:
        ev = await compute_event_summary(ev)
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
