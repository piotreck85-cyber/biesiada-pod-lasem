"""Seed data for frontend UI testing:
  - 1 stale rezerwacja event → for alerts bell/modal test
  - 2 events on the SAME future date (potwierdzona + anulowana) → for status dots

Also triggers the alerts scan so the bell has a badge.
Prints the ISO date used for the dots test on the last line (STDOUT) so
the Playwright script can consume it.
"""
import os, sys, json
from datetime import datetime, timedelta, timezone
import requests
from pymongo import MongoClient

BASE = "https://event-profit-tracker.preview.emergentagent.com"
API = f"{BASE}/api"

# Login
r = requests.post(f"{API}/auth/login", json={"email": "test@eventa.pl", "password": "test123"})
assert r.status_code == 200, r.text
tok = r.json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

# Mongo direct
env = {}
for line in open("/app/backend/.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')
mc = MongoClient(env["MONGO_URL"])
db = mc[env["DB_NAME"]]

# Cleanup any prior TEST events + their alerts
prev = list(db.events.find({"name": {"$regex": r"^TEST"}}, {"_id": 0, "id": 1}))
if prev:
    ids = [e["id"] for e in prev]
    db.alerts.delete_many({"event_id": {"$in": ids}})
    db.events.delete_many({"id": {"$in": ids}})
# Also dismiss any remaining alerts from prior runs
requests.post(f"{API}/alerts/dismiss-all", headers=H)

def make_ev(name, date, status):
    payload = {
        "name": name, "date": date, "status": status,
        "client_name": "TEST Klient", "client_phone": "+48 000 000 000",
        "guests": 50, "price_per_guest": 100,
    }
    r = requests.post(f"{API}/events", json=payload, headers=H)
    assert r.status_code == 200, r.text
    return r.json()

# 1) Stale rezerwacja for alerts
future1 = (datetime.now(timezone.utc).date() + timedelta(days=14)).strftime("%Y-%m-%d")
ev_stale = make_ev("TEST -- stara rezerwacja (UI)", future1, "rezerwacja")
old_iso = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
db.events.update_one({"id": ev_stale["id"]}, {"$set": {"created_at": old_iso}, "$unset": {"alert_sent": ""}})

# Trigger scan
r = requests.post(f"{API}/alerts/scan", headers=H)
assert r.status_code == 200, r.text

# 2) Two events on same future date for dots (choose a date within same visible month)
# Use "day 20 of current month" or nearest future date to ensure it's on the current visible month.
today = datetime.now(timezone.utc).date()
# Pick day = 25 of current month if in the future, else 25 of next month
if today.day < 25:
    dots_date = today.replace(day=25)
else:
    # move to next month
    year = today.year + (1 if today.month == 12 else 0)
    month = 1 if today.month == 12 else today.month + 1
    dots_date = datetime(year, month, 25).date()
dots_str = dots_date.strftime("%Y-%m-%d")
make_ev("TEST -- potwierdzona (dots)", dots_str, "potwierdzona")
make_ev("TEST -- anulowana (dots)", dots_str, "anulowana")

# Verify alerts endpoint returns the stale one
alerts = requests.get(f"{API}/alerts", headers=H).json()
mine = [a for a in alerts if a.get("event_id") == ev_stale["id"]]
assert len(mine) == 1, alerts

print(json.dumps({
    "dots_date": dots_str,
    "dots_year": dots_date.year,
    "dots_month": dots_date.month,
    "alert_event_id": ev_stale["id"],
    "alert_count": len(alerts),
}))
