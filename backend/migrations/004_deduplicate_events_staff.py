"""
FAZA 3 v2.0 — Deduplikacja events + staff
============================================
Kontekst: podczas Fazy 3 wykryto że kolekcja `events` zawiera 508 duplikatów
UUID (1033 → 525 unikalnych), a `staff` 12 duplikatów (77 → 65 unikalnych).

Strategia bezpieczna:
- Dla każdego zduplikowanego `id` (pole UUID):
  - Znajdź wszystkie dokumenty z tym `id`
  - Zachowaj dokument z NAJSTARSZYM `_id` (ObjectId zawiera timestamp)
  - Pozostałe zapisz w kolekcji `_removed_duplicates_YYYYMMDD_HHMMSS` (bezpieczna kopia)
  - Usuń pozostałe kopie z kolekcji głównej

- Weryfikacja: po dedup każde id ma dokładnie 1 dokument, oryginalne
  wartości (name, revenue, price_total, date) zachowane w najstarszej kopii.

Odwracalność: zbiór usuniętych rekordów zapisany w `_removed_duplicates_*`.
Rollback: przenieś je z powrotem do głównej kolekcji.

Użycie:
  python3 004_deduplicate_events_staff.py --dry-run
  python3 004_deduplicate_events_staff.py
"""
import os, sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from pymongo import MongoClient
from bson import ObjectId

TAG = "004_dedup_events_staff"


def analyze(col, name: str) -> dict:
    total = col.count_documents({})
    unique = len(col.distinct("id"))
    dupes = total - unique
    # Detailed duplicates: group by id, count > 1
    detailed = list(col.aggregate([
        {"$group": {"_id": "$id", "count": {"$sum": 1},
                    "ids_mongo": {"$push": "$_id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]))
    return {"name": name, "total": total, "unique_id": unique,
            "duplicates": dupes, "groups": detailed}


def dedup_collection(db, col_name: str, tag: str, dry_run: bool = False) -> dict:
    col = db[col_name]
    analysis = analyze(col, col_name)
    print(f"\n[{col_name}]")
    print(f"  total: {analysis['total']}, unique_id: {analysis['unique_id']}, "
          f"duplicates: {analysis['duplicates']}")

    if not analysis["groups"]:
        print(f"  Brak duplikatów w {col_name}")
        return {"removed": 0, "kept": analysis["total"]}

    # Bezpieczna kopia usuniętych do audytu
    removed_col = f"_removed_duplicates_{col_name}_{tag}"

    to_remove_ids = []          # _id do usunięcia
    to_backup_docs = []         # pełne dokumenty do zachowania w removed_col
    kept_summary = []

    for g in analysis["groups"]:
        uuid = g["_id"]
        # Fetch all docs sorted by _id (oldest first — ObjectId embeds timestamp)
        docs = list(col.find({"id": uuid}).sort("_id", 1))
        # Keep first (oldest), backup + remove the rest
        keep = docs[0]
        for extra in docs[1:]:
            to_remove_ids.append(extra["_id"])
            # Dodaj metadane audytu
            extra["_removed_by"] = tag
            extra["_removed_at"] = datetime.now(timezone.utc).isoformat()
            extra["_kept_mongo_id"] = str(keep["_id"])
            to_backup_docs.append(extra)
        kept_summary.append({"uuid": uuid, "kept_mongo_id": str(keep["_id"]),
                             "removed_count": len(docs) - 1})

    print(f"  Do usunięcia: {len(to_remove_ids)} kopii (zachowuję 1 na każde id)")
    if dry_run:
        print(f"  [DRY-RUN] Nic nie usuwam.")
        # Pokaż sample
        for k in kept_summary[:3]:
            print(f"    id={k['uuid'][:8]} · zachowuję {k['kept_mongo_id']} · usuwam {k['removed_count']}")
        return {"analysis": analysis, "would_remove": len(to_remove_ids)}

    # 1) Backup to _removed_duplicates_*
    if to_backup_docs:
        db[removed_col].insert_many(to_backup_docs)
        print(f"  ✅ Backup {len(to_backup_docs)} dokumentów → {removed_col}")

    # 2) Delete from main collection
    r = col.delete_many({"_id": {"$in": to_remove_ids}})
    print(f"  ✅ Usunięto {r.deleted_count} kopii z {col_name}")

    # 3) Verify
    total_after = col.count_documents({})
    unique_after = len(col.distinct("id"))
    print(f"  📊 Po dedup: total={total_after}  unique_id={unique_after}  "
          f"{'✅' if total_after == unique_after else '⚠️'}")

    return {
        "removed": r.deleted_count,
        "backed_up_to": removed_col,
        "total_before": analysis["total"],
        "total_after": total_after,
        "unique_id_after": unique_after,
    }


def main():
    dry = "--dry-run" in sys.argv
    print("=" * 70)
    print(f"DEDUPLIKACJA · dry-run={dry}")
    print("=" * 70)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    tag = f"{TAG}_{ts}"
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    results = {}
    for cname in ["events", "staff"]:
        results[cname] = dedup_collection(db, cname, tag, dry_run=dry)

    if not dry:
        # Manifest
        manifest_col = db["_dedup_manifest"]
        manifest_col.insert_one({
            "tag": tag,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "results": results,
        })
        print(f"\n📝 Manifest zapisany w kolekcji: _dedup_manifest (tag={tag})")

    print("\n" + "=" * 70)
    print("PODSUMOWANIE:")
    for name, r in results.items():
        print(f"  {name}: {r}")


if __name__ == "__main__":
    main()
