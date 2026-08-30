"""Dry-run regression checks. This file never connects to SMTP or writes MongoDB."""
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import pre_event_email as module


NOW = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


def event(**overrides):
    base = {
        "id": "dry-run-event",
        "owner_id": "dry-run-owner",
        "name": "Test bez wysyłki",
        "date": "2026-09-10",
        "time_start": "18:00",
        "status": "potwierdzona",
        "category": "dzieci/urodzinki/standard",
        "client_email": "dry-run@example.com",
    }
    base.update(overrides)
    return base


async def run():
    checks = []

    def check(name, condition, details=""):
        checks.append({"name": name, "passed": bool(condition), "details": details})

    mapping = {
        "dzieci/urodzinki/standard": "children",
        "warsztaty/przyrodnicze": "children",
        "dzieci/wycieczki": "children",
        "dorosli/okolicznosciowe": "adults",
        "dorosli/firmowe": "adults",
    }
    for category, expected in mapping.items():
        actual = module.regulation_type_for_category(category)
        check(f"Mapowanie {category}", actual == expected, f"{actual} == {expected}")

    non_confirmed = module.schedule_patch(event(status="rezerwacja"), NOW)
    check("Status inny niż Potwierdzona", non_confirmed["pre_event_email_status"] == "not_scheduled")

    first = module.schedule_patch(event(), NOW)
    expected = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc).isoformat()
    check("Termin wynosi dokładnie 48 godzin przed startem", first["pre_event_email_scheduled_at"] == expected, first["pre_event_email_scheduled_at"])
    ordinary_edit = module.schedule_patch(event(**{**first, "name": "Zmieniona nazwa"}), NOW)
    check("Zwykła edycja nie zmienia terminu", ordinary_edit["pre_event_email_scheduled_at"] == first["pre_event_email_scheduled_at"])
    changed = module.schedule_patch(event(**{**first, "date": "2026-09-12"}), NOW)
    check("Zmiana daty aktualizuje termin", changed["pre_event_email_scheduled_at"] != first["pre_event_email_scheduled_at"])

    cancelled = module.schedule_patch(event(**{**first, "status": "anulowana"}), NOW)
    check("Anulowanie anuluje wysyłkę", cancelled["pre_event_email_status"] == "cancelled")

    missing_email = module.schedule_patch(event(client_email=""), NOW)
    check("Brak e-maila nie wysyła", missing_email["pre_event_email_status"] == "failed")
    check("Brak e-maila daje komunikat", missing_email["pre_event_email_error"] == module.NO_EMAIL_MESSAGE)

    late = module.schedule_patch(event(date="2026-09-02", time_start="13:00"), NOW)
    check("Późne potwierdzenie planuje od razu", late["pre_event_email_scheduled_at"] == NOW.isoformat())

    for category, expected_file in [
        ("dzieci/urodzinki/standard", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
        ("dorosli/firmowe", "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"),
    ]:
        result = await module.send_event_email(None, event(category=category), dry_run=True)
        check(f"Dokładnie jeden PDF dla {category}", result["attachment"] == expected_file, result["attachment"])

    sent_event = event(pre_event_email_status="sent", pre_event_email_sent_at=NOW.isoformat())
    duplicate = await module.send_event_email(None, sent_event, dry_run=True)
    check("Automatyczna wysyłka tylko raz", duplicate.get("reason") == "already_sent")

    report = {
        "mode": "DRY-RUN — bez połączenia SMTP i bez zmian w MongoDB",
        "passed": sum(1 for item in checks if item["passed"]),
        "failed": sum(1 for item in checks if not item["passed"]),
        "checks": checks,
    }
    target = Path("/app/test_reports/pre_event_email_report.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(run())