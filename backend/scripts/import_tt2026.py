"""Import TimeTree ZIP 2026 (events + costs + profits) for Biesiada pod Lasem.

Usage:
  python scripts/import_tt2026.py --dry-run [--from 2026-08-01]
  python scripts/import_tt2026.py --apply   [--from 2026-08-01]

Strategy (adapted to reality — user already has Aug/Sep events entered manually):
- Match CSV events to existing app events by (date + title token overlap); single-single
  fallback on same date. Matched → UPDATE (attach source_uid, fill revenue if empty, append costs).
  Unmatched → CREATE. Ambiguous → report, no action.
- Profits (02): summed per event → revenue/price_total ONLY when existing is empty/0.
  Conflicts are reported, never overwritten.
- Expenses (03): appended to event.costs as {label, amount=allocated_amount}; idempotent via
  import_tt2026_log collection (expense_record_id / profit_record_id).
- General costs (04): NOT touched here (per user request only events+costs+profit).
"""
import argparse
import asyncio
import csv
import sys
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

CFG = dotenv_values("/app/backend/.env")
OWNER = "18ea076f-3ff4-4ac4-b17b-1ef2f44aadfc"  # piotreck85@gmail.com
DIR = "/tmp/import_zip"
BATCH = "TT_ZIP_2026_08"

CAT_MAP = {
    "birthday": "dzieci/urodzinki/standard",
    "school": "dzieci/wycieczki",
    "family": "dorosli/okolicznosciowe",
    "corporate": "dorosli/firmowe",
}
STATUS_MAP = {"confirmed": "potwierdzona", "reservation": "rezerwacja", "tentative": "wstepne", "calendar": ""}
STOP = {"impreza", "imprezs", "urodzinki", "urodziny", "firmowa", "firmowe", "rodzinna", "standard",
        "rezerwacja", "wstepna", "wstępna", "potwierdzone", "godz", "start", "kontakt"}

# Decyzje użytkownika (akceptacja z 2026-06): wymuszone dopasowania po (date, title)
# → nazwa imprezy w aplikacji; no_revenue = tylko koszty (przychód już ujęty gdzie indziej).
FORCE_MATCH = {
    ("2026-08-08", "Urodzinki"): {"app_name": "Standard", "no_revenue": True},
}
GENERAL_CAT = {"general_cost": "Koszty ogólne", "partner_payout": "Wypłaty wspólników",
               "unassigned_cost": "Nieprzypisane"}


def norm_tokens(s: str) -> set:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    out = set()
    for t in "".join(c if c.isalnum() else " " for c in s).split():
        if len(t) >= 4 or t.isdigit():
            out.add(t)
    return out


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--from", dest="date_from", default="2026-08-01")
    args = ap.parse_args()
    dry = not args.apply

    db = AsyncIOMotorClient(CFG["MONGO_URL"])[CFG.get("DB_NAME", "test_database")]

    ev_rows = [r for r in csv.DictReader(open(f"{DIR}/01_events_2026.csv", encoding="utf-8-sig"))
               if r["date"] >= args.date_from]
    profits = list(csv.DictReader(open(f"{DIR}/02_event_reported_profits_2026.csv", encoding="utf-8-sig")))
    expenses = list(csv.DictReader(open(f"{DIR}/03_event_expenses_2026.csv", encoding="utf-8-sig")))

    ids = {r["event_id"] for r in ev_rows}
    prof_by_ev = defaultdict(list)
    for p in profits:
        if p["event_id"] in ids:
            prof_by_ev[p["event_id"]].append(p)
    exp_by_ev = defaultdict(list)
    for e in expenses:
        if e["event_id"] in ids:
            exp_by_ev[e["event_id"]].append(e)

    # existing app events in range
    app_events = await db.events.find(
        {"owner_id": OWNER, "date": {"$gte": args.date_from}},
        {"_id": 0, "id": 1, "date": 1, "name": 1, "revenue": 1, "price_total": 1,
         "costs": 1, "source_uid": 1, "client_phone": 1, "status": 1}
    ).to_list(500)
    app_by_date = defaultdict(list)
    for a in app_events:
        app_by_date[a["date"]].append(a)

    # already-imported log (idempotency)
    done_recs = set()
    async for l in db.import_tt2026_log.find({"owner_id": OWNER}, {"_id": 0, "record_id": 1}):
        done_recs.add(l["record_id"])

    matched_app_ids = set()
    plan = []  # (action, csv_row, app_event|None, note)

    csv_by_date = defaultdict(list)
    for r in ev_rows:
        csv_by_date[r["date"]].append(r)

    for r in sorted(ev_rows, key=lambda x: (x["date"], x["title"])):
        # already imported before (source_uid present)?
        pre = next((a for a in app_events if a.get("source_uid") == r["source_uid"]), None)
        if pre:
            plan.append(("UPDATE", r, pre, "po source_uid (wcześniejszy import)"))
            matched_app_ids.add(pre["id"])
            continue
        cands = [a for a in app_by_date.get(r["date"], []) if a["id"] not in matched_app_ids]
        forced = FORCE_MATCH.get((r["date"], r["title"].strip()))
        if forced:
            fm = next((a for a in cands if a["name"].strip() == forced["app_name"]), None)
            if fm:
                r["_no_revenue"] = forced.get("no_revenue", False)
                plan.append(("UPDATE", r, fm, f"wymuszone dopasowanie: „{fm['name']}”" + (" (bez przychodu)" if r["_no_revenue"] else "")))
                matched_app_ids.add(fm["id"])
                continue
        ctoks = norm_tokens(r["title"]) | norm_tokens(r.get("description", "")[:80])
        best, best_score = None, 0
        for a in cands:
            atoks = norm_tokens(a["name"])
            score = len((ctoks & atoks) - STOP) * 2 + len(ctoks & atoks & STOP) * 0  # significant overlap
            # plain overlap incl. common words as weak signal
            if score == 0 and (norm_tokens(r["title"]) & norm_tokens(a["name"])):
                score = 1
            if score > best_score:
                best, best_score = a, score
        if best is None and len(cands) == 1 and len(csv_by_date[r["date"]]) == 1:
            best, best_score = cands[0], 1  # single-single same date
        if best:
            plan.append(("UPDATE", r, best, f"dopasowano: „{best['name']}” (score {best_score})"))
            matched_app_ids.add(best["id"])
        elif cands:
            plan.append(("AMBIGUOUS", r, None, f"{len(cands)} kandydatów tego dnia, brak dopasowania nazwy: "
                        + "; ".join(a["name"][:30] for a in cands)))
        else:
            plan.append(("CREATE", r, None, "brak imprezy w aplikacji tego dnia"))

    # ---- report / apply ----
    stats = {"UPDATE": 0, "CREATE": 0, "AMBIGUOUS": 0}
    total_costs, total_profit, n_cost_recs, n_prof_recs = 0.0, 0.0, 0, 0
    conflicts, mediums = [], []

    print(f"\n{'='*100}\n{'TRYB: DRY RUN (nic nie zapisano)' if dry else 'TRYB: IMPORT — ZAPIS DO BAZY'}   zakres: od {args.date_from}   konto: piotreck85@gmail.com\n{'='*100}")
    for action, r, app_ev, note in plan:
        stats[action] += 1
        psum = sum(float(p["reported_profit_amount"]) for p in prof_by_ev[r["event_id"]])
        csum = sum(float(e["allocated_amount"]) for e in exp_by_ev[r["event_id"]])
        total_profit += psum; total_costs += csum
        n_prof_recs += len(prof_by_ev[r["event_id"]]); n_cost_recs += len(exp_by_ev[r["event_id"]])
        rev_note = ""
        if app_ev:
            old_rev = float(app_ev.get("revenue") or 0) or float(app_ev.get("price_total") or 0)
            if psum > 0 and old_rev > 0 and abs(old_rev - psum) > 1:
                rev_note = f"  ⚠ KONFLIKT przychodu: app {old_rev:.0f} zł vs import {psum:.0f} zł → zostawiam {old_rev:.0f}"
                conflicts.append(f"{r['date']} {r['title'][:35]}: app {old_rev:.0f} vs zip {psum:.0f}")
            elif psum > 0 and old_rev == 0:
                rev_note = f"  → ustawię przychód {psum:.0f} zł"
        for rec in prof_by_ev[r["event_id"]] + exp_by_ev[r["event_id"]]:
            if rec.get("assignment_confidence") == "medium":
                key = rec.get("profit_record_id") or rec.get("expense_record_id")
                mediums.append(f"{key} · {r['date']} {r['title'][:30]} · {rec.get('reported_profit_amount') or rec.get('allocated_amount')} zł · {rec.get('description', rec.get('source_text',''))[:45]}")
        print(f"[{action:9}] {r['date']} · {r['title'][:44]:44} | zysk zgł.: {psum:8.0f} zł ({len(prof_by_ev[r['event_id']])}) | koszty: {csum:8.0f} zł ({len(exp_by_ev[r['event_id']])}) | {note}{rev_note}")

        if dry or action == "AMBIGUOUS":
            continue

        # ---------- APPLY ----------
        if action == "CREATE":
            doc = {
                "id": str(uuid.uuid4()), "owner_id": OWNER,
                "name": r["title"].strip(), "date": r["date"],
                "time_start": r.get("start_time") or "", "time_end": r.get("end_time") or "",
                "category": CAT_MAP.get(r.get("event_type", ""), ""),
                "status": STATUS_MAP.get(r.get("status", ""), ""),
                "client_phone": (r.get("client_phone") or "").strip(),
                "client_email": (r.get("client_email") or "").strip(),
                "notes": ((r.get("description") or "").strip() + "\n[Import TimeTree ZIP]").strip(),
                "venue": "Biesiada pod lasem",
                "revenue": 0, "price_total": 0, "costs": [], "shifts": [],
                "source_uid": r["source_uid"], "tt_event_id": r["event_id"],
                "import_source": BATCH, "created_at": now_iso(),
            }
            await db.events.insert_one(dict(doc))
            app_ev = doc
        else:
            await db.events.update_one({"id": app_ev["id"], "owner_id": OWNER}, {"$set": {
                "source_uid": r["source_uid"], "tt_event_id": r["event_id"], "import_source": BATCH,
            }})
            upd = {}
            if not (app_ev.get("client_phone") or "").strip() and (r.get("client_phone") or "").strip():
                upd["client_phone"] = r["client_phone"].strip()
            if upd:
                await db.events.update_one({"id": app_ev["id"]}, {"$set": upd})

        # revenue from profits (only if empty; skip when forced no_revenue)
        old_rev = float(app_ev.get("revenue") or 0) or float(app_ev.get("price_total") or 0)
        new_prof = [p for p in prof_by_ev[r["event_id"]] if p["profit_record_id"] not in done_recs]
        if new_prof:
            psum_new = sum(float(p["reported_profit_amount"]) for p in new_prof)
            applied = old_rev == 0 and psum_new > 0 and not r.get("_no_revenue")
            if applied:
                await db.events.update_one({"id": app_ev["id"]}, {"$set": {"revenue": psum_new, "price_total": psum_new}})
            for p in new_prof:
                await db.import_tt2026_log.insert_one({
                    "owner_id": OWNER, "record_id": p["profit_record_id"], "kind": "profit",
                    "event_id": app_ev["id"], "tt_event_id": r["event_id"],
                    "amount": float(p["reported_profit_amount"]),
                    "applied_as_revenue": applied, "at": now_iso(),
                })

        # costs from expenses
        new_exp = [e for e in exp_by_ev[r["event_id"]] if e["expense_record_id"] not in done_recs]
        if new_exp:
            add = [{"label": (e.get("description") or "Koszt")[:80].strip() or "Koszt",
                    "amount": float(e["allocated_amount"])} for e in new_exp]
            await db.events.update_one({"id": app_ev["id"]}, {"$push": {"costs": {"$each": add}}})
            for e in new_exp:
                await db.import_tt2026_log.insert_one({
                    "owner_id": OWNER, "record_id": e["expense_record_id"], "kind": "expense",
                    "event_id": app_ev["id"], "tt_event_id": r["event_id"],
                    "amount": float(e["allocated_amount"]), "at": now_iso(),
                })

    print(f"\n{'-'*100}")
    print(f"PODSUMOWANIE: aktualizacje istniejących: {stats['UPDATE']} · nowe imprezy: {stats['CREATE']} · niejednoznaczne (pominięte): {stats['AMBIGUOUS']}")
    print(f"Zyski zgłoszone: {total_profit:.0f} zł w {n_prof_recs} rekordach · Koszty: {total_costs:.0f} zł w {n_cost_recs} alokacjach")
    if conflicts:
        print(f"\n⚠ KONFLIKTY PRZYCHODU ({len(conflicts)}) — zostawiam wartości z aplikacji:")
        for c in conflicts: print("   ", c)
    if mediums:
        print(f"\n🟡 REKORDY assignment_confidence=medium ({len(mediums)}) — do Twojej kontroli:")
        for m in mediums: print("   ", m)

    # ---------- Plik 04: koszty ogólne → db.expenses ----------
    general = list(csv.DictReader(open(f"{DIR}/04_general_unassigned_costs_2026.csv", encoding="utf-8-sig")))
    existing_exp = await db.expenses.find({"owner_id": OWNER}, {"_id": 0, "label": 1, "amount": 1, "date": 1}).to_list(3000)
    exist_keys = {(e.get("date"), round(float(e.get("amount") or 0), 2), (e.get("label") or "").strip().lower())
                  for e in existing_exp}
    g_new, g_dupe, g_done = [], [], 0
    for g in general:
        if g["cost_record_id"] in done_recs:
            g_done += 1
            continue
        key = (g["date"], round(float(g["amount"]), 2), g["description"].strip().lower())
        (g_dupe if key in exist_keys else g_new).append(g)
    print(f"\nKOSZTY OGÓLNE (plik 04): {len(general)} rekordów → nowe: {len(g_new)}, duplikaty (już w Finansach): {len(g_dupe)}, wcześniej zaimportowane: {g_done}")
    for g in g_dupe:
        print(f"   [DUPLIKAT] {g['date']} · {g['description'][:50]} · {g['amount']} zł")
    if not dry:
        for g in g_new:
            await db.expenses.insert_one({
                "id": str(uuid.uuid4()), "owner_id": OWNER,
                "label": g["description"].strip()[:120] or "Koszt ogólny",
                "amount": float(g["amount"]), "date": g["date"],
                "category": GENERAL_CAT.get(g["cost_type"], "Koszty ogólne"),
                "notes": f"{g.get('source_sender','')} · {g.get('cost_type','')}".strip(" ·"),
                "source": "tt_zip_import", "import_batch_id": BATCH,
                "created_at": now_iso(),
            })
            await db.import_tt2026_log.insert_one({
                "owner_id": OWNER, "record_id": g["cost_record_id"], "kind": "general_cost",
                "amount": float(g["amount"]), "at": now_iso(),
            })
        print(f"   → zapisano {len(g_new)} kosztów ogólnych do Finansów")
    print()

asyncio.run(main())
