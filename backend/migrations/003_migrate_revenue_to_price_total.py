"""
FAZA 3 v2.0 — Migracja `revenue` → `price_total`
==================================================
Bezpieczeństwo:
- IDEMPOTENTNA: sprawdza flagę `_migrated_price_total_from_revenue=True`
- ODWRACALNA: przechowuje oryginalną wartość w `_migration_003_orig_price_total`
- NIE NADPISUJE `price_total > 0` (ochrona przed utratą danych)
- DRY-RUN dostępny

Migracja: dla każdego eventu:
  - Jeśli `revenue > 0` I (`price_total` puste, None, lub 0):
      ustaw `price_total = revenue`
      zaznacz `_migrated_price_total_from_revenue=True`
      zapisz `_migration_003_orig_price_total = <oryginal>`
  - W przeciwnym razie: pomiń

Użycie:
  python3 003_migrate_revenue_to_price_total.py --dry-run
  python3 003_migrate_revenue_to_price_total.py
  python3 003_migrate_revenue_to_price_total.py --rollback
"""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from pymongo import MongoClient

TAG = "003_revenue_to_price_total"


def find_candidates(c):
    """Eventy: revenue > 0 AND (price_total missing OR = 0 OR = None)."""
    return list(c.events.find(
        {
            "revenue": {"$gt": 0},
            "$or": [
                {"price_total": {"$exists": False}},
                {"price_total": 0},
                {"price_total": None},
                {"price_total": ""},
            ],
            # Ignore already migrated (idempotent)
            "_migrated_price_total_from_revenue": {"$ne": True},
        },
        {"_id": 0, "id": 1, "revenue": 1, "price_total": 1, "name": 1, "date": 1}
    ))


def run(dry_run: bool = False, rollback: bool = False):
    c = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    if rollback:
        # Reverse: restore price_total to original value and unset the flag.
        rows = list(c.events.find(
            {"_migrated_price_total_from_revenue": True},
            {"_id": 0, "id": 1, "_migration_003_orig_price_total": 1}
        ))
        print(f"Do cofnięcia: {len(rows)} eventów")
        if dry_run:
            print("[DRY-RUN] Nic nie zmieniam.")
            return
        for r in rows:
            orig = r.get("_migration_003_orig_price_total")
            update: dict = {
                "$unset": {
                    "_migrated_price_total_from_revenue": "",
                    "_migration_003_orig_price_total": "",
                    "_migration_003_tag": "",
                }
            }
            if orig is None or orig == "":
                update["$unset"]["price_total"] = ""
            else:
                update["$set"] = {"price_total": orig}
            c.events.update_one({"id": r["id"]}, update)
        print(f"✅ Rollback zakończony: {len(rows)} eventów przywróconych")
        return

    candidates = find_candidates(c)
    total_revenue = sum(float(x.get("revenue") or 0) for x in candidates)
    protected = c.events.count_documents({"price_total": {"$gt": 0}})

    print(f"Kandydaci do migracji         : {len(candidates)}")
    print(f"Suma revenue kandydatów       : {total_revenue:.2f} zł")
    print(f"Chronione (price_total > 0)   : {protected}  (NIE tknę)")

    if dry_run:
        print("\n[DRY-RUN] Przykład pierwszych 3 eventów do migracji:")
        for c_ev in candidates[:3]:
            print(f"  id={c_ev['id'][:8]}... name='{c_ev.get('name','')[:30]}' "
                  f"revenue={c_ev.get('revenue')} → price_total={c_ev.get('revenue')}")
        return

    # Real migration
    n_migrated = 0
    for ev in candidates:
        orig = ev.get("price_total")  # may be None/0/""
        r = c.events.update_one(
            {"id": ev["id"], "_migrated_price_total_from_revenue": {"$ne": True}},
            {"$set": {
                "price_total": float(ev["revenue"]),
                "_migrated_price_total_from_revenue": True,
                "_migration_003_orig_price_total": orig,
                "_migration_003_tag": TAG,
            }}
        )
        if r.modified_count:
            n_migrated += 1

    print(f"\n✅ Zmigrowanych eventów: {n_migrated}")

    # Verification
    verify_migrated = c.events.count_documents({"_migrated_price_total_from_revenue": True})
    verify_price_total_gt0 = c.events.count_documents({"price_total": {"$gt": 0}})
    verify_total_price = 0.0
    for x in c.events.find({"_migrated_price_total_from_revenue": True}, {"price_total": 1, "revenue": 1}):
        verify_total_price += float(x.get("price_total") or 0)
    verify_total_rev_source = 0.0
    for x in c.events.find({"_migrated_price_total_from_revenue": True}, {"revenue": 1}):
        verify_total_rev_source += float(x.get("revenue") or 0)

    print(f"\n📊 Weryfikacja:")
    print(f"  Eventy z flagą migracji   : {verify_migrated}")
    print(f"  Suma price_total migr.    : {verify_total_price:.2f} zł")
    print(f"  Suma revenue źródłowa     : {verify_total_rev_source:.2f} zł")
    print(f"  Eventy z price_total > 0  : {verify_price_total_gt0} (przed: {protected})")
    if abs(verify_total_price - verify_total_rev_source) > 0.01:
        print("  ⚠️  Rozbieżność!")
    else:
        print("  ✅ Sumy się zgadzają — dane spójne")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    rb = "--rollback" in sys.argv
    print("=" * 70)
    print(f"MIGRACJA: {TAG}")
    print(f"  dry-run={dry}  rollback={rb}")
    print("=" * 70)
    run(dry_run=dry, rollback=rb)
