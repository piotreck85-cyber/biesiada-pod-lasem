"""Persistent pre-event email workflow for confirmed events.

The event category is the only source used to select a regulation PDF.
No event notes, names or AI classification are inspected.
"""
from __future__ import annotations

import asyncio
import os
import smtplib
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo
from pymongo import ReturnDocument


WARSAW = ZoneInfo("Europe/Warsaw")
ASSETS_DIR = Path(__file__).parent / "assets"
CHILDREN_PDF = ASSETS_DIR / "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"
ADULTS_PDF = ASSETS_DIR / "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"
ATTRACTIONS_MAP = ASSETS_DIR / "kolorowa_mapa_atrakcji_pod_lasem.png"

ADULT_CATEGORIES = {
    "dorosli/okolicznosciowe",
    "dorosli/firmowe",
}
CHILDREN_CATEGORIES = {
    "dzieci/wycieczki",
    "dzieci/wycieczki_rodzice",
    "warsztaty",
}
CHILDREN_PREFIXES = (
    "dzieci/urodzinki/",
    "warsztaty/",
)

STATUS_FIELDS = {
    "pre_event_email_status": "not_scheduled",
    "pre_event_email_scheduled_at": None,
    "pre_event_email_sent_at": None,
    "pre_event_email_address": None,
    "pre_event_email_message_id": None,
    "pre_event_email_schedule_key": None,
    "regulation_type": None,
}

NO_EMAIL_MESSAGE = "Brak adresu e-mail klienta – wiadomość przed imprezą nie została wysłana."
EMAIL_SUBJECT = "Do zobaczenia za 2 dni – Biesiada pod Lasem 🌲"
EMAIL_BODY = """Dzień dobry,

już za dwa dni spotykamy się w Biesiadzie pod Lasem 🌲
Bardzo się cieszymy i przygotowujemy miejsce na Państwa wydarzenie.

W załączniku przesyłamy:

• krótki regulamin Biesiady pod Lasem odpowiedni dla Państwa rodzaju wydarzenia,
• mapkę Biesiady, która ułatwi Państwu oraz gościom poruszanie się po naszym terenie i odnalezienie najważniejszych miejsc.

Prosimy również o odpowiedź na tę wiadomość i przekazanie nam kilku ostatnich informacji organizacyjnych:

• ostatecznej lub planowanej liczby uczestników,

• jakie dodatkowe produkty planują Państwo przywieźć, np. ciasta, przekąski, napoje lub inny prowiant,

• czy planują Państwo przygotować własne dekoracje,

• czy planują Państwo przyjechać przed rozpoczęciem imprezy w celu przygotowania dekoracji, rozłożenia produktów lub innych rzeczy,

• jeżeli tak – o której godzinie planują Państwo przyjazd.

Dzięki tym informacjom będziemy mogli odpowiednio przygotować stoły, miejsce na poczęstunek i napoje oraz zaplanować ustawienie przestrzeni przed Państwa przyjazdem.

Przypominamy, że dodatkowy prowiant, napoje, catering oraz własne dekoracje prosimy wcześniej z nami uzgodnić.

Rozliczenie wydarzenia odbywa się po zakończeniu imprezy, zgodnie z wcześniejszymi ustaleniami.

Jeżeli od ostatnich ustaleń zmieniło się coś jeszcze w organizacji wydarzenia, prosimy o krótką informację w odpowiedzi na tę wiadomość.

Do zobaczenia w Biesiadzie pod Lasem! 🌿

Biesiada pod Lasem
Dolina Przygód
"""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def regulation_type_for_category(category: Optional[str]) -> Optional[str]:
    """Map only the stored category value to children/adults."""
    value = (category or "").strip()
    if value in ADULT_CATEGORIES:
        return "adults"
    if value in CHILDREN_CATEGORIES or value.startswith(CHILDREN_PREFIXES):
        return "children"
    return None


def regulation_path(regulation_type: str) -> Path:
    if regulation_type == "children":
        return CHILDREN_PDF
    if regulation_type == "adults":
        return ADULTS_PDF
    raise ValueError("Brak regulaminu dla wybranego rodzaju imprezy.")


def event_start_utc(event: dict) -> Optional[datetime]:
    date_value = (event.get("date") or "").strip()
    time_value = (event.get("time_start") or event.get("time") or "").strip()
    if not date_value or not time_value:
        return None
    try:
        local = datetime.strptime(f"{date_value} {time_value[:5]}", "%Y-%m-%d %H:%M")
        return local.replace(tzinfo=WARSAW).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def format_event_date_pl(event: dict) -> str:
    try:
        return datetime.strptime(event.get("date") or "", "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return event.get("date") or ""


def subject_for_event(event: dict) -> str:
    return EMAIL_SUBJECT


def schedule_key_for_event(event: dict) -> str:
    """Fields that are allowed to change the schedule; ordinary edits do not."""
    return "|".join([
        (event.get("status") or "").strip(),
        (event.get("date") or "").strip(),
        (event.get("time_start") or event.get("time") or "").strip(),
        (event.get("client_email") or "").strip().lower(),
        (event.get("category") or "").strip(),
    ])


def schedule_patch(event: dict, at: Optional[datetime] = None) -> dict:
    """Return only pre-event fields. Existing sent events remain sent."""
    current = at or now_utc()
    previous = event.get("pre_event_email_status") or "not_scheduled"
    previous_key = event.get("pre_event_email_schedule_key")
    schedule_key = schedule_key_for_event(event)
    regulation_type = regulation_type_for_category(event.get("category"))
    base = {**STATUS_FIELDS, "regulation_type": regulation_type}
    for key in STATUS_FIELDS:
        if key in event:
            base[key] = event.get(key)
    base["regulation_type"] = regulation_type
    base["pre_event_email_schedule_key"] = schedule_key

    if previous == "sent" or event.get("pre_event_email_sent_at"):
        base["pre_event_email_status"] = "sent"
        return base

    if (previous == "failed" and event.get("pre_event_email_error_code") == "send_failed"
            and previous_key == schedule_key):
        return base

    if (event.get("status") or "") != "potwierdzona":
        base.update({
            "pre_event_email_status": "cancelled" if previous in ("scheduled", "failed", "cancelled") else "not_scheduled",
            "pre_event_email_scheduled_at": None,
            "pre_event_email_error": None,
            "pre_event_email_error_code": None,
            "pre_event_email_claimed_until": None,
        })
        return base

    if not regulation_type:
        base.update({
            "pre_event_email_status": "failed",
            "pre_event_email_scheduled_at": None,
            "pre_event_email_error": "Wybrany rodzaj imprezy nie ma przypisanego regulaminu.",
            "pre_event_email_error_code": "unsupported_category",
            "pre_event_email_claimed_until": None,
        })
        return base

    email = (event.get("client_email") or "").strip().lower()
    if not email:
        base.update({
            "pre_event_email_status": "failed",
            "pre_event_email_scheduled_at": None,
            "pre_event_email_address": None,
            "pre_event_email_error": NO_EMAIL_MESSAGE,
            "pre_event_email_error_code": "no_email",
            "pre_event_email_claimed_until": None,
        })
        return base

    start = event_start_utc(event)
    if not start:
        base.update({
            "pre_event_email_status": "failed",
            "pre_event_email_scheduled_at": None,
            "pre_event_email_address": email,
            "pre_event_email_error": "Brak poprawnej daty lub godziny rozpoczęcia imprezy.",
            "pre_event_email_error_code": "invalid_start",
            "pre_event_email_claimed_until": None,
        })
        return base

    if start <= current:
        base.update({
            "pre_event_email_status": "cancelled",
            "pre_event_email_scheduled_at": None,
            "pre_event_email_address": email,
            "pre_event_email_error": "Termin imprezy już minął.",
            "pre_event_email_error_code": "event_started",
            "pre_event_email_claimed_until": None,
        })
        return base

    planned = start - timedelta(hours=48)
    if previous_key == schedule_key and event.get("pre_event_email_scheduled_at"):
        try:
            planned = datetime.fromisoformat(event["pre_event_email_scheduled_at"])
        except (TypeError, ValueError):
            pass
    elif planned <= current:
        planned = current
    base.update({
        "pre_event_email_status": "scheduled",
        "pre_event_email_scheduled_at": planned.isoformat(),
        "pre_event_email_address": email,
        "pre_event_email_error": None,
        "pre_event_email_error_code": None,
        "pre_event_email_claimed_until": event.get("pre_event_email_claimed_until") if previous_key == schedule_key else None,
    })
    return base


async def _sync_no_email_alert(db, event: dict, patch: dict) -> None:
    query = {"event_id": event.get("id"), "kind": "pre_event_email_no_email"}
    if patch.get("pre_event_email_error_code") == "no_email":
        existing = await db.alerts.find_one(query, {"_id": 0, "id": 1})
        if not existing:
            await db.alerts.insert_one({
                "id": str(uuid.uuid4()),
                "owner_id": event.get("owner_id"),
                "event_id": event.get("id"),
                "event_name": event.get("name") or "",
                "event_date": event.get("date") or "",
                "status": event.get("status") or "",
                "kind": "pre_event_email_no_email",
                "message": NO_EMAIL_MESSAGE,
                "created_at": now_utc().isoformat(),
                "dismissed": False,
                "emailed": False,
            })
    else:
        await db.alerts.update_many(
            {**query, "dismissed": {"$ne": True}},
            {"$set": {"dismissed": True, "dismissed_at": now_utc().isoformat(), "auto_dismissed": True}},
        )


async def reconcile_event(db, event: dict, at: Optional[datetime] = None) -> dict:
    patch = schedule_patch(event, at)
    await db.events.update_one({"id": event.get("id")}, {"$set": patch})
    await _sync_no_email_alert(db, event, patch)
    return {**event, **patch}


def _build_message(event: dict, *, message_id: str) -> EmailMessage:
    regulation_type = regulation_type_for_category(event.get("category"))
    if not regulation_type:
        raise ValueError("Wybrany rodzaj imprezy nie ma przypisanego regulaminu.")
    pdf_path = regulation_path(regulation_type)
    if not pdf_path.is_file():
        raise FileNotFoundError(f"Brak pliku regulaminu: {pdf_path.name}")
    if not ATTRACTIONS_MAP.is_file():
        raise FileNotFoundError(f"Brak pliku mapy: {ATTRACTIONS_MAP.name}")

    recipient = (event.get("client_email") or "").strip().lower()
    if not recipient:
        raise ValueError(NO_EMAIL_MESSAGE)

    smtp_user = os.getenv("SMTP_USER")
    if not smtp_user:
        raise RuntimeError("Konfiguracja SMTP niedostępna (brak SMTP_USER).")

    msg = EmailMessage()
    msg["From"] = f"{os.getenv('SMTP_FROM_NAME', 'Biesiada pod Lasem')} <{smtp_user}>"
    msg["To"] = recipient
    msg["Reply-To"] = smtp_user
    msg["Subject"] = subject_for_event(event)
    msg["Message-ID"] = message_id
    msg.set_content(EMAIL_BODY)
    msg.add_attachment(
        pdf_path.read_bytes(),
        maintype="application",
        subtype="pdf",
        filename=pdf_path.name,
    )
    msg.add_attachment(
        ATTRACTIONS_MAP.read_bytes(),
        maintype="image",
        subtype="png",
        filename=ATTRACTIONS_MAP.name,
    )
    return msg


def _smtp_send(message: EmailMessage) -> None:
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    if not user or not password:
        raise RuntimeError("Konfiguracja SMTP niedostępna (brak SMTP_USER/PASSWORD).")
    context = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=25) as server:
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
        server.login(user, password)
        server.send_message(message)


async def _record_log(db, event: dict, *, status: str, recipient: str, message_id: str,
                      manual: bool, resend: bool, error: Optional[str] = None) -> None:
    await db.pre_event_email_logs.insert_one({
        "id": str(uuid.uuid4()),
        "event_id": event.get("id"),
        "owner_id": event.get("owner_id"),
        "recipient": recipient,
        "regulation_type": regulation_type_for_category(event.get("category")),
        "status": status,
        "message_id": message_id,
        "manual": manual,
        "resend": resend,
        "error": error,
        "created_at": now_utc().isoformat(),
    })


async def send_event_email(db, event: dict, *, manual: bool = False, resend: bool = False,
                           dry_run: bool = False) -> dict:
    if (event.get("status") or "") != "potwierdzona":
        raise ValueError("Wiadomość można wysłać tylko dla imprezy ze statusem Potwierdzona.")
    if event.get("pre_event_email_status") == "sent" and not resend:
        return {"sent": False, "reason": "already_sent", "event": event}

    regulation_type = regulation_type_for_category(event.get("category"))
    if not regulation_type:
        raise ValueError("Wybrany rodzaj imprezy nie ma przypisanego regulaminu.")
    recipient = (event.get("client_email") or "").strip().lower()
    if not recipient:
        raise ValueError(NO_EMAIL_MESSAGE)

    domain = (os.getenv("SMTP_USER") or "biesiadapodlasem.local").split("@")[-1]
    suffix = f"-resend-{uuid.uuid4().hex[:10]}" if resend else ""
    message_id = f"<pre-event-{event.get('id')}{suffix}@{domain}>"
    try:
        message = _build_message(event, message_id=message_id)
        attachments = list(message.iter_attachments())
        filenames = [item.get_filename() for item in attachments]
        expected_regulation = regulation_path(regulation_type).name
        if len(attachments) != 2 or filenames != [expected_regulation, ATTRACTIONS_MAP.name]:
            raise RuntimeError("Wiadomość musi zawierać jeden regulamin PDF i mapę PNG.")
        if not dry_run:
            await asyncio.to_thread(_smtp_send, message)
        sent_at = now_utc().isoformat()
        patch = {
            "pre_event_email_status": "sent",
            "pre_event_email_sent_at": sent_at,
            "pre_event_email_address": recipient,
            "pre_event_email_message_id": message_id,
            "pre_event_email_error": None,
            "pre_event_email_error_code": None,
            "pre_event_email_claimed_until": None,
            "regulation_type": regulation_type,
        }
        if resend:
            patch["pre_event_email_last_resent_at"] = sent_at
            patch["pre_event_email_resend_count"] = int(event.get("pre_event_email_resend_count") or 0) + 1
        if not dry_run:
            await db.events.update_one({"id": event.get("id")}, {"$set": patch})
            await _record_log(db, event, status="sent", recipient=recipient, message_id=message_id,
                              manual=manual, resend=resend)
        return {
            "sent": True,
            "dry_run": dry_run,
            "message_id": message_id,
            "recipient": recipient,
            "regulation_type": patch["regulation_type"],
            "attachment": attachments[0].get_filename(),
            "attachments": filenames,
            "subject": message["Subject"],
            "body": EMAIL_BODY,
            "patch": patch,
        }
    except Exception as exc:
        error = str(exc)[:500]
        if not dry_run:
            failure_patch = {
                "pre_event_email_claimed_until": None,
                "pre_event_email_error": error,
                "pre_event_email_error_code": "resend_failed" if resend else "send_failed",
            }
            if not resend:
                failure_patch["pre_event_email_status"] = "failed"
            await db.events.update_one({"id": event.get("id")}, {"$set": failure_patch})
            await _record_log(db, event, status="failed", recipient=recipient, message_id=message_id,
                              manual=manual, resend=resend, error=error)
        raise


async def claim_event_for_manual_send(db, event_id: str, owner_id: str) -> Optional[dict]:
    current = now_utc()
    return await db.events.find_one_and_update(
        {
            "id": event_id,
            "owner_id": owner_id,
            "status": "potwierdzona",
            "pre_event_email_status": {"$ne": "sent"},
            "$or": [
                {"pre_event_email_claimed_until": None},
                {"pre_event_email_claimed_until": {"$exists": False}},
                {"pre_event_email_claimed_until": {"$lte": current.isoformat()}},
            ],
        },
        {"$set": {"pre_event_email_claimed_until": (current + timedelta(minutes=10)).isoformat()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )


async def scan_and_send_due(db, at: Optional[datetime] = None, *, dry_run: bool = False) -> dict:
    """Rebuild schedules from MongoDB, then send due claimed events."""
    current = at or now_utc()
    candidates = await db.events.find(
        {
            "$or": [
                {"status": "potwierdzona"},
                {"pre_event_email_status": {"$in": ["scheduled", "failed"]}},
            ]
        },
        {"_id": 0},
    ).to_list(None)
    for event in candidates:
        await reconcile_event(db, event, current)

    sent = 0
    failed = 0
    processed_ids: list[str] = []
    due_before = current.isoformat()
    claim_until = (current + timedelta(minutes=10)).isoformat()
    while sent + failed < 50:
        event = await db.events.find_one_and_update(
            {
                "status": "potwierdzona",
                "pre_event_email_status": "scheduled",
                "pre_event_email_scheduled_at": {"$lte": due_before},
                "id": {"$nin": processed_ids},
                "$or": [
                    {"pre_event_email_claimed_until": None},
                    {"pre_event_email_claimed_until": {"$exists": False}},
                    {"pre_event_email_claimed_until": {"$lte": due_before}},
                ],
            },
            {"$set": {"pre_event_email_claimed_until": claim_until}},
            projection={"_id": 0},
            sort=[("pre_event_email_scheduled_at", 1)],
            return_document=ReturnDocument.AFTER,
        )
        if not event:
            break
        processed_ids.append(event.get("id"))
        try:
            result = await send_event_email(db, event, dry_run=dry_run)
            sent += 1 if result.get("sent") else 0
            if dry_run:
                await db.events.update_one(
                    {"id": event.get("id")},
                    {"$set": {"pre_event_email_claimed_until": None}},
                )
        except Exception:
            failed += 1
    return {"scanned": len(candidates), "sent": sent, "failed": failed, "dry_run": dry_run}


def status_payload(event: dict) -> dict:
    regulation_type = regulation_type_for_category(event.get("category"))
    return {
        "event_id": event.get("id"),
        "event_category": event.get("category") or "",
        "regulation_type": regulation_type,
        "regulation_label": "Dzieci" if regulation_type == "children" else "Dorośli" if regulation_type == "adults" else "Brak mapowania",
        "attachments": [
            {
                "kind": "regulation",
                "label": "Regulamin dzieci" if regulation_type == "children" else "Regulamin dorośli" if regulation_type == "adults" else "Regulamin",
                "filename": regulation_path(regulation_type).name if regulation_type else None,
            },
            {"kind": "map", "label": "Mapa Biesiady", "filename": ATTRACTIONS_MAP.name},
        ],
        "status": event.get("pre_event_email_status") or "not_scheduled",
        "scheduled_at": event.get("pre_event_email_scheduled_at"),
        "sent_at": event.get("pre_event_email_sent_at"),
        "address": event.get("pre_event_email_address") or (event.get("client_email") or "").strip().lower() or None,
        "message_id": event.get("pre_event_email_message_id"),
        "error": event.get("pre_event_email_error"),
        "error_code": event.get("pre_event_email_error_code"),
        "notice": NO_EMAIL_MESSAGE if event.get("pre_event_email_error_code") == "no_email" else None,
        "subject": subject_for_event(event),
        "body": EMAIL_BODY,
    }