"""Import of BPL_2026 costs spreadsheet (Import_kosztow sheet) — RECLASSIFICATION mode.

What it does (per user's approved plan, option A):
1. Archives the old flat WhatsApp import (expenses with import_batch_id=WHATSAPP_2026_02-08_V2)
   into `_backup_expenses_whatsapp_v2` (nothing is lost; full mongodump also exists in /app/backups).
2. Imports every sheet row into `imported_costs` (full audit: date, amount, original description,
   category, subcategory, person, source, sheet status) and routes it:
   - Koszt bezpośredni imprezy/warsztatów + status OK → matched to event by date:
       exactly 1 event that day → cost appended to event.costs (affects that event's profitability)
       0 or >1 events → PENDING review (owner picks the event)
   - Koszt ogólny firmy / Finansowanie + OK → `expenses` (general company costs)
   - Inwestycja / wyposażenie + OK → `investments` (separate, no event profitability impact)
   - Rozliczenie właścicielskie → `partner_settlements` (not a company cost); existing ones deduped
   - Informacja finansowa → skipped (recorded as info, never a cost)
   - Zwrot/transfer, "Nie księgować automatycznie", ambiguous types, or sheet status DO WERYFIKACJI
     → PENDING review (Finanse → Import kosztów → Do weryfikacji)
3. Dedup: sha1(date|amount|original description|source) — idempotent re-runs; rows matching the
   owner's MANUAL expenses (date+amount) are skipped as duplicates.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone

BATCH_ID = "BPL_2026_V5"
OLD_BATCH_ID = "WHATSAPP_2026_02-08_V2"
ARCHIVE_COLLECTION = "_backup_expenses_whatsapp_v2"

EVENT_TYPES = {"Koszt bezpośredni imprezy", "Koszt bezpośredni warsztatów"}
GENERAL_TYPES = {"Koszt ogólny firmy", "Finansowanie — poza rentownością imprez"}
INVESTMENT_TYPES = {"Inwestycja / wyposażenie"}
SETTLEMENT_TYPES = {"Rozliczenie właścicielskie — poza kosztami"}
INFO_TYPES = {"Informacja — nie importować jako koszt"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(s) -> str:
    return str(s or "").strip()


def dedup_key(date: str, amount: float, desc: str, source: str) -> str:
    raw = f"{date}|{amount:.2f}|{_norm(desc).lower()}|{_norm(source).lower()}"
    return hashlib.sha1(raw.encode()).hexdigest()


def read_rows(xlsx_path: str) -> list[dict]:
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Import_kosztow"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        date = r[1].date().isoformat() if hasattr(r[1], "date") else _norm(r[1])
        rows.append({
            "row_id": int(r[0]),
            "date": date,
            "time": _norm(r[2]),
            "author": _norm(r[3]),
            "amount": round(float(r[4] or 0), 2),
            "description": _norm(r[5]),
            "category": _norm(r[6]),
            "subcategory": _norm(r[7]),
            "record_type": _norm(r[8]),
            "is_event_cost": _norm(r[9]).upper() == "TAK",
            "person": _norm(r[12]),
            "suggestion": _norm(r[13]),
            "sheet_status": _norm(r[15]).upper(),
            "notes": _norm(r[16]),
            "source": _norm(r[17]) or "BPL 2026",
            "source_line": r[18],
        })
    return rows


def suggested_action(record_type: str) -> str:
    if record_type in EVENT_TYPES:
        return "event"
    if record_type in GENERAL_TYPES:
        return "general"
    if record_type in INVESTMENT_TYPES:
        return "investment"
    if record_type in SETTLEMENT_TYPES:
        return "settlement"
    if record_type == "Koszt ogólny lub inwestycja":
        return "investment"
    return "general"


def build_expense_doc(owner_id: str, row: dict, rec_id: str) -> dict:
    notes_bits = [b for b in [row["subcategory"], row["person"]] if b]
    return {
        "id": str(uuid.uuid4()), "owner_id": owner_id,
        "label": row["description"], "amount": row["amount"], "date": row["date"],
        "category": row["category"], "notes": " · ".join(notes_bits),
        "source": "bpl2026_import", "import_batch_id": BATCH_ID,
        "imported_cost_id": rec_id, "created_at": _now(),
    }


def build_investment_doc(owner_id: str, row: dict, rec_id: str) -> dict:
    return {
        "id": str(uuid.uuid4()), "owner_id": owner_id,
        "label": row["description"], "amount": row["amount"], "date": row["date"],
        "category": row["category"], "subcategory": row["subcategory"],
        "person": row["person"], "source": "bpl2026_import",
        "import_batch_id": BATCH_ID, "imported_cost_id": rec_id, "created_at": _now(),
    }


def build_settlement_doc(owner_id: str, row: dict, rec_id: str) -> dict:
    return {
        "id": str(uuid.uuid4()), "owner_id": owner_id,
        "partner_id": None, "partner_name_hint": row["author"] or None,
        "date": row["date"], "amount": row["amount"],
        "method": "wypłata (gotówka/przelew)", "description": row["description"],
        "source": "bpl2026_import", "import_batch_id": BATCH_ID,
        "imported_cost_id": rec_id, "imported_at": _now(), "created_at": _now(),
    }


def build_event_cost_item(row: dict, rec_id: str) -> dict:
    return {
        "label": row["description"], "amount": row["amount"],
        "imported": True, "import_batch_id": BATCH_ID,
        "imported_cost_id": rec_id, "category": row["category"],
    }


async def run_import(db, owner_id: str, xlsx_path: str) -> dict:
    rows = read_rows(xlsx_path)

    # --- 1. Archive old flat WhatsApp batch (idempotent) ---
    archived = 0
    old_docs = await db.expenses.find({"import_batch_id": OLD_BATCH_ID}).to_list(2000)
    if old_docs:
        for d in old_docs:
            d.pop("_id", None)
            d["archived_at"] = _now()
            d["archived_reason"] = f"Reclassified by {BATCH_ID} import"
        await db[ARCHIVE_COLLECTION].insert_many([dict(d) for d in old_docs])
        res = await db.expenses.delete_many({"import_batch_id": OLD_BATCH_ID})
        archived = res.deleted_count

    # --- 2. Prepare dedup sets ---
    manual_keys = set()
    async for e in db.expenses.find({"owner_id": owner_id}, {"_id": 0, "date": 1, "amount": 1}):
        manual_keys.add((e.get("date"), round(float(e.get("amount") or 0), 2)))
    settlement_keys = set()
    async for p in db.partner_settlements.find({"owner_id": owner_id}, {"_id": 0, "date": 1, "amount": 1, "description": 1}):
        settlement_keys.add((p.get("date"), round(float(p.get("amount") or 0), 2), _norm(p.get("description")).lower()))
    existing_dedup = set()
    async for r in db.imported_costs.find({"owner_id": owner_id}, {"_id": 0, "dedup_key": 1}):
        existing_dedup.add(r.get("dedup_key"))

    # events grouped by date (excluding cancelled)
    events_by_date: dict[str, list] = defaultdict(list)
    async for ev in db.events.find(
        {"owner_id": owner_id, "status": {"$ne": "anulowana"}},
        {"_id": 0, "id": 1, "date": 1, "name": 1, "time_start": 1, "status": 1},
    ):
        if ev.get("date"):
            events_by_date[ev["date"]].append(ev)

    stats = defaultdict(int)
    sums = defaultdict(float)

    for row in rows:
        key = dedup_key(row["date"], row["amount"], row["description"], row["source"])
        if key in existing_dedup:
            stats["skipped_already_imported"] += 1
            continue
        existing_dedup.add(key)

        rec_id = str(uuid.uuid4())
        rec = {
            "id": rec_id, "owner_id": owner_id, "batch_id": BATCH_ID, "dedup_key": key,
            **row,
            "resolution": "pending", "applied_ref": None,
            "imported_at": _now(),
        }
        rtype = row["record_type"]

        # info rows — never a cost
        if rtype in INFO_TYPES:
            rec["resolution"] = "skipped_info"
            await db.imported_costs.insert_one(dict(rec))
            stats["skipped_info"] += 1
            continue

        # duplicate vs manual expenses (owner entered it by hand earlier)
        if (row["date"], row["amount"]) in manual_keys and rtype not in SETTLEMENT_TYPES:
            rec["resolution"] = "skipped_duplicate"
            await db.imported_costs.insert_one(dict(rec))
            stats["skipped_duplicate"] += 1
            continue

        # settlements — dedup vs existing partner_settlements, always recorded there
        if rtype in SETTLEMENT_TYPES:
            if (row["date"], row["amount"], row["description"].lower()) in settlement_keys:
                rec["resolution"] = "skipped_duplicate"
                await db.imported_costs.insert_one(dict(rec))
                stats["skipped_duplicate"] += 1
                continue
            if row["sheet_status"] == "OK":
                doc = build_settlement_doc(owner_id, row, rec_id)
                await db.partner_settlements.insert_one(dict(doc))
                rec["resolution"] = "auto_settlement"
                rec["applied_ref"] = {"collection": "partner_settlements", "id": doc["id"]}
                stats["settlement"] += 1
                sums["settlement"] += row["amount"]
            else:
                rec["suggested_action"] = "settlement"
                stats["pending"] += 1
                sums["pending"] += row["amount"]
            await db.imported_costs.insert_one(dict(rec))
            continue

        needs_review = row["sheet_status"] != "OK"

        if not needs_review and rtype in EVENT_TYPES:
            candidates = events_by_date.get(row["date"], [])
            if len(candidates) == 1:
                ev = candidates[0]
                await db.events.update_one(
                    {"id": ev["id"], "owner_id": owner_id},
                    {"$push": {"costs": build_event_cost_item(row, rec_id)}},
                )
                rec["resolution"] = "auto_event"
                rec["applied_ref"] = {"collection": "events", "id": ev["id"], "event_name": ev.get("name")}
                stats["event"] += 1
                sums["event"] += row["amount"]
            else:
                rec["suggested_action"] = "event"
                rec["match_note"] = "brak imprezy w tym dniu" if not candidates else f"{len(candidates)} imprezy tego dnia — wybierz"
                stats["pending"] += 1
                sums["pending"] += row["amount"]
        elif not needs_review and rtype in GENERAL_TYPES:
            doc = build_expense_doc(owner_id, row, rec_id)
            await db.expenses.insert_one(dict(doc))
            rec["resolution"] = "auto_general"
            rec["applied_ref"] = {"collection": "expenses", "id": doc["id"]}
            stats["general"] += 1
            sums["general"] += row["amount"]
        elif not needs_review and rtype in INVESTMENT_TYPES:
            doc = build_investment_doc(owner_id, row, rec_id)
            await db.investments.insert_one(dict(doc))
            rec["resolution"] = "auto_investment"
            rec["applied_ref"] = {"collection": "investments", "id": doc["id"]}
            stats["investment"] += 1
            sums["investment"] += row["amount"]
        else:
            rec["suggested_action"] = suggested_action(rtype)
            if rtype in EVENT_TYPES:
                rec["match_note"] = f"{len(events_by_date.get(row['date'], []))} imprez(y) tego dnia"
            stats["pending"] += 1
            sums["pending"] += row["amount"]

        await db.imported_costs.insert_one(dict(rec))

    report = {
        "batch_id": BATCH_ID,
        "rows_in_sheet": len(rows),
        "archived_old_whatsapp": archived,
        "imported_total": stats["event"] + stats["general"] + stats["investment"] + stats["settlement"],
        "event_costs": stats["event"], "event_costs_sum": round(sums["event"], 2),
        "general_costs": stats["general"], "general_costs_sum": round(sums["general"], 2),
        "investments": stats["investment"], "investments_sum": round(sums["investment"], 2),
        "settlements": stats["settlement"], "settlements_sum": round(sums["settlement"], 2),
        "pending_review": stats["pending"], "pending_review_sum": round(sums["pending"], 2),
        "skipped_duplicates": stats["skipped_duplicate"],
        "skipped_info": stats["skipped_info"],
        "skipped_already_imported": stats["skipped_already_imported"],
        "created_at": _now(),
    }
    await db.import_batches.insert_one({"id": str(uuid.uuid4()), "owner_id": owner_id, **report})
    await db.audit_log.insert_one({
        "id": str(uuid.uuid4()), "owner_id": owner_id, "user_id": None,
        "user_name": "Import BPL_2026", "action": "create", "entity_type": "cost_import",
        "entity_id": BATCH_ID,
        "summary": (f"Import kosztów: {report['imported_total']} zaksięgowane "
                    f"({report['event_costs']} do imprez, {report['general_costs']} ogólne, "
                    f"{report['investments']} inwestycje, {report['settlements']} rozliczenia), "
                    f"{report['pending_review']} do weryfikacji, "
                    f"{report['skipped_duplicates']} duplikatów pominięto, "
                    f"zarchiwizowano {archived} starych wpisów WhatsApp"),
        "at": _now(),
    })
    return report


if __name__ == "__main__":
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

    async def main():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "eventa_db")]
        owner_id = sys.argv[1]
        xlsx = sys.argv[2] if len(sys.argv) > 2 else "/tmp/koszty.xlsx"
        report = await run_import(db, owner_id, xlsx)
        for k, v in report.items():
            print(f"{k}: {v}")

    asyncio.run(main())
