"""Automatic ingestion of client replies to the 48h pre-event email.

Flow:
1. `scan_client_replies(db)` runs on APScheduler (every 5 min). For every connected
   Gmail account it lists recent inbox replies and matches them to events using the
   RFC-2822 threading headers (In-Reply-To / References), which contain our own
   Message-ID of the form ``<pre-event-{event_id}...@domain>`` — never by email
   address alone. Gmail threadId is stored as a secondary reference.
2. AI (existing Emergent LLM setup) extracts organizational facts from the reply.
   Uncertain values are kept verbatim as text ("Planowana liczba osób: 30–35"),
   never guessed.
3. A suggestion document (collection ``client_reply_suggestions``) with status
   ``pending`` is created + an in-app alert for the owner. NOTHING is written to
   the event itself until owner/admin/partner approves it on the event card.
4. On approve, the summary goes to ``client_update_text`` (visible to staff in
   Moja praca) and structured fields are merged into ``event.org`` / ``people``.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import httpx

import gmail_client as gc

log = logging.getLogger("client_replies")

# Our pre-event Message-IDs embed the event id: <pre-event-{uuid}[-resend-...]@domain>
_EVENT_MSGID_RE = re.compile(r"pre-event-([0-9a-fA-F-]{36})")

REPLY_ALERT_MESSAGE = "Nowa odpowiedź klienta przed imprezą – sprawdź informacje."


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _headers_all(payload: dict) -> dict:
    """All headers lower-cased (gmail_client.parse_headers skips References/In-Reply-To)."""
    out = {}
    for h in (payload.get("headers") or []):
        out[(h.get("name") or "").lower()] = h.get("value") or ""
    return out


def _strip_quoted(text: str) -> str:
    """Remove quoted previous messages from a reply body (best-effort)."""
    lines = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if s.startswith(">"):
            continue
        # Polish/English "On ... wrote:" markers end the new content
        if re.match(r"^(W dniu|Dnia|On)\b.*(napisał|napisała|wrote)", s, re.IGNORECASE):
            break
        if re.match(r"^-{2,}\s*(Original Message|Wiadomość oryginalna)", s, re.IGNORECASE):
            break
        lines.append(ln)
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# AI extraction
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "Jesteś asystentem sali imprezowej 'Biesiada pod Lasem'. Otrzymasz treść "
    "odpowiedzi klienta na maila wysłanego 2 dni przed imprezą. Wyciągnij TYLKO "
    "informacje organizacyjne, które klient faktycznie podał. NIGDY nie zgaduj i "
    "nie wymyślaj wartości. Jeżeli klient podaje zakres lub przybliżenie (np. "
    "'około 30–35 osób'), NIE wpisuj liczby do people_final — zapisz tekst w "
    "people_note (np. 'Planowana liczba osób: 30–35'). Odpowiedz WYŁĄCZNIE czystym "
    "JSON (bez markdown) o strukturze:\n"
    "{\n"
    '  "has_org_info": true/false,\n'
    '  "people_final": liczba lub null,\n'
    '  "people_note": "tekst" lub null,\n'
    '  "kids_count": liczba lub null,\n'
    '  "adults_count": liczba lub null,\n'
    '  "cakes": "ciasta/tort" lub null,\n'
    '  "snacks": "przekąski" lub null,\n'
    '  "drinks": "napoje" lub null,\n'
    '  "provisions": "inny prowiant" lub null,\n'
    '  "catering": "catering" lub null,\n'
    '  "own_decorations": true/false/null,\n'
    '  "early_arrival": true/false/null,\n'
    '  "early_arrival_time": "HH:MM" lub null,\n'
    '  "extra_requirements": "dodatkowe wymagania" lub null,\n'
    '  "org_changes": "zmiany organizacyjne" lub null,\n'
    '  "other": "inne ważne informacje" lub null,\n'
    '  "summary_lines": ["krótka linia po polsku", ...]\n'
    "}\n"
    "summary_lines to zwięzłe punkty w formacie 'Etykieta: wartość' (np. 'Liczba osób: 34', "
    "'Prowiant: tort + 2 ciasta', 'Wcześniejszy przyjazd: TAK, ok. 15:30'). "
    "Jeżeli mail nie zawiera żadnych informacji organizacyjnych, zwróć has_org_info=false "
    "i pustą listę summary_lines."
)


async def extract_reply_info(text: str) -> dict | None:
    """Run AI extraction. Returns parsed dict or None when AI is unavailable/failed."""
    key = os.environ.get("EMERGENT_LLM_KEY") or ""
    if not key:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return None
    try:
        chat = LlmChat(
            api_key=key,
            session_id=f"client-reply-{uuid.uuid4()}",
            system_message=_EXTRACT_SYSTEM,
        ).with_model("openai", "gpt-5.6-terra")
        raw = await chat.send_message(UserMessage(text=f"Odpowiedź klienta:\n{text[:6000]}"))
        m = re.search(r"\{.*\}", str(raw), re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group(0))
        if not isinstance(data, dict):
            return None
        data.setdefault("summary_lines", [])
        return data
    except Exception as e:
        log.warning(f"AI extraction failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Gmail scanning
# ---------------------------------------------------------------------------

async def _list_recent_inbox(access_token: str, limit: int = 30) -> list[dict]:
    """Recent inbox messages (last 3 days) — replies to our pre-event mails live here."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(
            f"{gc.GMAIL_API}/users/me/messages",
            params={"q": "in:inbox -in:spam -in:trash newer_than:3d", "maxResults": limit},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.is_error:
        raise RuntimeError(f"list recent inbox failed: {r.status_code}")
    return r.json().get("messages", []) or []


async def scan_client_replies(db) -> dict:
    """Scan all connected Gmail accounts for replies to pre-event emails."""
    processed = 0
    created = 0
    conns = await db.gmail_connections.find({}, {"_id": 0}).to_list(20)
    for conn in conns:
        try:
            enc = conn.get("refresh_token_encrypted")
            if not enc:
                continue
            refresh = gc.decrypt_token(enc)
            token = await gc.refresh_access_token(refresh)
            if not token:
                continue
            owner_id = conn.get("workspace_id") or conn.get("user_id")
            msgs = await _list_recent_inbox(token)
            for m in msgs:
                gm_id = m.get("id")
                if not gm_id:
                    continue
                seen = await db.client_reply_suggestions.find_one({"gmail_message_id": gm_id}, {"_id": 1})
                if seen:
                    continue
                processed += 1
                full = await gc.get_message_full(token, gm_id)
                payload = full.get("payload") or {}
                headers = _headers_all(payload)
                ref = f"{headers.get('in-reply-to','')} {headers.get('references','')}"
                match = _EVENT_MSGID_RE.search(ref)
                if not match:
                    continue  # not a reply to our pre-event email
                event_id = match.group(1).lower()
                ev = await db.events.find_one({"id": event_id}, {"_id": 0})
                if not ev:
                    continue
                ev_owner = ev.get("owner_id") or owner_id
                frm = gc.parse_from(headers.get("from", ""))
                bodies = gc._extract_body_parts(payload)
                body_text = _strip_quoted(bodies.get("text") or "")
                if not body_text and bodies.get("html"):
                    body_text = _strip_quoted(re.sub(r"<[^>]+>", " ", bodies["html"]))
                body_text = (body_text or full.get("snippet") or "").strip()
                if not body_text:
                    continue
                extracted = await extract_reply_info(body_text)
                await create_suggestion(
                    db, ev_owner, ev,
                    gmail_message_id=gm_id,
                    thread_id=full.get("threadId") or "",
                    from_email=frm.get("email", ""),
                    from_name=frm.get("name", ""),
                    client_text=body_text[:4000],
                    extracted=extracted,
                )
                created += 1
        except Exception as e:
            log.warning(f"client reply scan failed for connection {conn.get('email')}: {e}")
    if created:
        log.info(f"client_reply_scan: processed={processed} created={created}")
    return {"processed": processed, "created": created}


async def create_suggestion(db, owner_id: str, ev: dict, *, gmail_message_id: str,
                            thread_id: str, from_email: str, from_name: str,
                            client_text: str, extracted: dict | None) -> dict:
    """Insert a pending suggestion + owner alert + audit log entry."""
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "event_id": ev["id"],
        "event_name": ev.get("name") or "",
        "event_date": ev.get("date") or "",
        "gmail_message_id": gmail_message_id,
        "thread_id": thread_id,
        "from_email": from_email,
        "from_name": from_name,
        "client_text": client_text,
        "extracted": extracted,
        "summary_lines": (extracted or {}).get("summary_lines") or [],
        "has_org_info": bool((extracted or {}).get("has_org_info")) if extracted else None,
        "status": "pending",
        "created_at": _now_iso(),
    }
    await db.client_reply_suggestions.insert_one(dict(doc))
    try:
        await db.alerts.insert_one({
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "event_id": ev["id"],
            "event_name": ev.get("name") or "",
            "event_date": ev.get("date") or "",
            "kind": "client_reply",
            "message": REPLY_ALERT_MESSAGE,
            "comment_text": client_text[:200],
            "created_at": _now_iso(),
            "dismissed": False,
            "emailed": True,
        })
    except Exception:
        pass
    try:
        await db.audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "user_id": None,
            "user_name": "System (Gmail)",
            "action": "create",
            "entity_type": "client_reply",
            "entity_id": ev["id"],
            "summary": f"Odebrano odpowiedź klienta ({from_email}) do imprezy: {ev.get('name','')}",
            "at": _now_iso(),
        })
    except Exception:
        pass
    return doc


# ---------------------------------------------------------------------------
# Applying an approved suggestion to the event
# ---------------------------------------------------------------------------

def _merge_org_text(org: dict, key: str, value: str | None):
    """Set org[key] or append on a new line when a different value already exists."""
    if not value:
        return
    cur = (org.get(key) or "").strip()
    if not cur:
        org[key] = value
    elif value.lower() not in cur.lower():
        org[key] = f"{cur}\nZ odpowiedzi klienta: {value}"


def build_event_updates(ev: dict, extracted: dict | None, approved_text: str,
                        decided_by: str) -> dict:
    """Build a $set dict applying the approved suggestion to the event document."""
    updates: dict = {
        "client_update_text": approved_text,
        "client_update_at": _now_iso(),
        "client_update_by": decided_by,
    }
    ex = extracted or {}
    org = dict(ev.get("org") or {})
    if isinstance(ex.get("people_final"), (int, float)) and ex["people_final"]:
        updates["people"] = int(ex["people_final"])
    if isinstance(ex.get("kids_count"), (int, float)) and ex["kids_count"] is not None:
        org["kids_count"] = int(ex["kids_count"])
    if isinstance(ex.get("adults_count"), (int, float)) and ex["adults_count"] is not None:
        org["adults_count"] = int(ex["adults_count"])
    _merge_org_text(org, "cakes", ex.get("cakes"))
    if ex.get("snacks"):
        _merge_org_text(org, "cakes", ex.get("snacks"))
    _merge_org_text(org, "drinks", ex.get("drinks"))
    _merge_org_text(org, "client_provisions", ex.get("provisions"))
    if ex.get("catering"):
        _merge_org_text(org, "client_provisions", ex.get("catering"))
    if ex.get("own_decorations") is not None:
        org["client_own_decorations"] = bool(ex["own_decorations"])
    if ex.get("early_arrival") is not None:
        org["early_arrival"] = bool(ex["early_arrival"])
    if ex.get("early_arrival_time"):
        org["early_arrival_time"] = str(ex["early_arrival_time"])
        org.setdefault("early_arrival", True)
    _merge_org_text(org, "special_requests", ex.get("extra_requirements"))
    _merge_org_text(org, "org_notes", ex.get("org_changes"))
    _merge_org_text(org, "org_notes", ex.get("other"))
    updates["org"] = org
    return updates
