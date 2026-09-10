"""Owner-scoped activity records. No URLs, query strings or form contents."""
from datetime import datetime, timezone, timedelta
import uuid

SECTIONS = {
    "kalendarz": "Kalendarz", "imprezy": "Imprezy", "grafik": "Moja praca",
    "obecnosc": "Obecność", "zadania": "Zadania", "zakupy": "Zakupy i magazyn",
    "finanse": "Finanse", "koszty": "Koszty", "rozliczenie": "Rozliczenie",
    "pracownicy": "Pracownicy", "statystyki": "Statystyki", "wiecej": "Więcej",
    "oferta": "Oferta", "majatek": "Majątek", "wspolnicy": "Wspólnicy",
    "event": "Szczegóły imprezy", "moja-impreza": "Moja impreza", "checklist": "Zadania imprezy",
    "dostepnosc-zespolu": "Dostępność zespołu", "grafik-pracownikow": "Grafik pracowników",
    "czas-zespolu": "Czas zespołu", "korekty-czasu": "Korekty czasu", "ai-asystent": "Asystent AI",
    "gmail": "Gmail", "ustawienia": "Ustawienia", "checklist-templates": "Szablony zadań",
    "import-kosztow": "Import kosztów", "pozostale-przychody": "Pozostałe przychody",
}

def owner_id(user):
    return user.get("workspace_id") or user["id"]

def is_owner(user):
    return bool(user.get("id")) and user.get("role") != "staff" and user["id"] == owner_id(user)

async def record(db, user, action, section="", entity_id=""):
    if user.get("role") != "staff":
        return
    if action not in ("visit", "login", "view_event"):
        raise ValueError("Unknown activity")
    if action == "visit" and section not in SECTIONS:
        raise ValueError("Unknown section")
    await db.activity_log.insert_one({
        "id": str(uuid.uuid4()), "owner_id": owner_id(user),
        "user_id": user["id"], "user_name": user.get("name") or user.get("email", ""),
        "action": action, "section": section, "entity_id": entity_id,
        "summary": "Zalogowano" if action == "login" else (
            "Otwarto imprezę" if action == "view_event" else "Wejście: " + SECTIONS[section]),
        "at": datetime.now(timezone.utc).isoformat(),
    })

async def read_activity(db, user, days=7, user_id="", kind="all"):
    if not is_owner(user):
        raise PermissionError("Panel dostępny tylko dla właściciela")
    if days not in (1, 7, 30):
        raise ValueError("Wybierz 1, 7 lub 30 dni")
    if kind not in ("all", "login", "browsing"):
        raise ValueError("Nieznany rodzaj aktywności")
    query = {"owner_id": owner_id(user), "at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}}
    if user_id:
        query["user_id"] = user_id
    activity_query = dict(query)
    if kind == "login":
        activity_query["action"] = "login"
    elif kind == "browsing":
        activity_query["action"] = {"$in": ["visit", "view_event"]}
    rows = await db.activity_log.find(activity_query, {"_id": 0}).sort("at", -1).to_list(201)
    # Reuse the application's existing server-side change log, without exposing raw field values.
    changes = []
    if kind == "all":
        changes = await db.audit_log.find(query, {"_id": 0, "id": 1, "at": 1, "user_id": 1, "user_name": 1,
        "action": 1, "entity_type": 1, "entity_id": 1, "summary": 1}).sort("at", -1).to_list(201)
    combined = sorted(rows + changes, key=lambda row: row.get("at", ""), reverse=True)
    return {"items": combined[:200], "truncated": len(combined) > 200}
