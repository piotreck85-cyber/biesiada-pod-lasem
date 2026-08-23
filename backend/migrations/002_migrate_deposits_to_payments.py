"""
FAZA 2 v2.0 — Migracja `deposit_amount` → `event_payments`
============================================================
Bezpieczeństwo:
- IDEMPOTENTNA: kolejne uruchomienia nie dodają duplikatów
  (sprawdza flagę `migrated_from_deposit=True`)
- ODWRACALNA: nie modyfikuje pola deposit_amount w events, tylko czyta.
  Cofnięcie: db.event_payments.delete_many({"migrated_from_deposit": True})
- DRY-RUN dostępny (--dry-run)
- Log podsumowania: liczba wpłat, sumy, sample.

Użycie:
  python3 002_migrate_deposits_to_payments.py           # wykonaj
  python3 002_migrate_deposits_to_payments.py --dry-run # tylko podgląd
  python3 002_migrate_deposits_to_payments.py --rollback  # cofnij
"""
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Load .env from parent directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from pymongo import MongoClient

MIGRATION_TAG = "002_deposits_to_event_payments"


def run(dry_run: bool = False, rollback: bool = False):
    c = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    if rollback:
        n = c.event_payments.count_documents({"migrated_from_deposit": True})
        if dry_run:
            print(f"[DRY-RUN] Cofnięcie: usunięto by {n} wpłat migrowanych z deposit_amount")
            return
        r = c.event_payments.delete_many({"migrated_from_deposit": True})
        print(f"✅ Rollback: usunięto {r.deleted_count} wpłat migrowanych z deposit_amount")
        return

    # 1) Znajdź eventy z zaliczką > 0
    events_with_deposit = list(c.events.find(
        {"deposit_amount": {"$gt": 0}},
        {"_id": 0, "id": 1, "owner_id": 1, "name": 1, "date": 1,
         "deposit_amount": 1, "deposit_date": 1, "deposit_paid": 1}
    ))
    print(f"Eventy z deposit_amount > 0: {len(events_with_deposit)}")

    to_insert = []
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for ev in events_with_deposit:
        # Sprawdź czy migracja tego eventu już się odbyła
        existing = c.event_payments.find_one({
            "event_id": ev["id"],
            "migrated_from_deposit": True,
        }, {"_id": 0})
        if existing:
            skipped += 1
            continue

        amount = float(ev.get("deposit_amount") or 0)
        if amount <= 0:
            continue

        # Data: użyj deposit_date jeśli jest, inaczej data imprezy
        date = (ev.get("deposit_date") or "").strip() or ev.get("date") or ""

        doc = {
            "id": str(uuid.uuid4()),
            "owner_id": ev.get("owner_id"),
            "event_id": ev["id"],
            "amount": round(amount, 2),
            "date": date,
            "method": "Przelew",  # bezpieczny default (nie mamy oryginalnej metody)
            "note": "Migrowane z deposit_amount",
            "kind": "zaliczka",
            "created_by": "migration:002",
            "created_by_name": "Migracja",
            "created_at": now_iso,
            "migrated_from_deposit": True,  # ← FLAGA POZWALAJĄCA COFNĄĆ
            "migration_tag": MIGRATION_TAG,
        }
        to_insert.append(doc)

    print(f"Do migracji: {len(to_insert)} · Już zmigrowane: {skipped}")

    if dry_run:
        print("\n[DRY-RUN] Nic nie zapisuję. Przykład dokumentu do wstawienia:")
        if to_insert:
            for k, v in list(to_insert[0].items())[:10]:
                print(f"  {k}: {v}")
        return

    if to_insert:
        c.event_payments.insert_many(to_insert)
        print(f"✅ Wstawiono {len(to_insert)} wpłat")

    # Weryfikacja: suma wpłat migrowanych = suma deposit_amount
    total_deposits = sum(float(e.get("deposit_amount") or 0) for e in events_with_deposit)
    total_migrated = sum(float(p.get("amount") or 0) for p in c.event_payments.find(
        {"migrated_from_deposit": True}, {"_id": 0, "amount": 1}
    ))
    print(f"\n📊 Weryfikacja:")
    print(f"  Suma deposit_amount (source):  {total_deposits:.2f} zł")
    print(f"  Suma wpłat migrowanych (dest): {total_migrated:.2f} zł")
    if abs(total_deposits - total_migrated) > 0.01:
        print("  ⚠️  Rozbieżność! Sprawdź logi.")
    else:
        print("  ✅ Sumy się zgadzają.")

    # Sample
    print(f"\n📄 Ostatnie 3 wpłaty migrowane:")
    for p in c.event_payments.find({"migrated_from_deposit": True}, {"_id": 0}).limit(3):
        print(f"  event={p['event_id'][:8]}... · {p['amount']} zł · {p['date']} · {p['method']}")


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    rollback = "--rollback" in sys.argv
    print("=" * 70)
    print(f"MIGRACJA: {MIGRATION_TAG}")
    print(f"  dry-run: {dry}  ·  rollback: {rollback}")
    print("=" * 70)
    run(dry_run=dry, rollback=rollback)
