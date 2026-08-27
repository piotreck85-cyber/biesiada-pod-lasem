"""Post-event thank-you email + discount code system.

Rules:
- Sends a thank-you email with a one-time 10% discount code when an event is marked "Zakończone".
- Each event can trigger the auto-email ONLY ONCE (idempotency guard via `thanks_email_logs`).
- Manual resend uses the same code (no new code, no new log — updates existing log's resent_at).
- Discount code is one-time, valid 12 months, applies to package_price only (not extras/dinner).
- Retroactive events (completed BEFORE feature activation) do NOT trigger auto-email.
- Client matching for existing discounts: by lowercase email address only.
"""
from __future__ import annotations

import os
import re
import random
import string
from datetime import datetime, timezone, timedelta
from typing import Optional


CODE_PREFIX = "POWROT10"
CODE_LEN = 4  # tail length e.g. A7K2
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no confusing chars
DISCOUNT_PCT_DEFAULT = 10.0
DISCOUNT_VALID_MONTHS_DEFAULT = 12


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rand_code_tail(length: int = CODE_LEN) -> str:
    rng = random.SystemRandom()
    return "".join(rng.choice(CODE_ALPHABET) for _ in range(length))


async def generate_unique_code(db, owner_id: str) -> str:
    """Generate a unique POWROT10-XXXX code for the workspace."""
    for _ in range(20):
        code = f"{CODE_PREFIX}-{_rand_code_tail()}"
        exists = await db.discount_codes.find_one({"owner_id": owner_id, "code": code}, {"_id": 1})
        if not exists:
            return code
    # fallback with more entropy
    return f"{CODE_PREFIX}-{_rand_code_tail(6)}"


def norm_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


DEFAULT_SUBJECT = "Dziękujemy za wspólny czas – 10% rabatu na kolejną imprezę"

DEFAULT_BODY_TEMPLATE = """Dzień dobry {{client_name}},

serdecznie dziękujemy za wspólnie spędzony czas w Biesiadzie pod Lasem – Dolinie Przygód. Mamy nadzieję, że przyjęcie pozostawiło Państwu wiele pięknych wspomnień.

W ramach podziękowania przyznajemy 10% rabatu na organizację kolejnej imprezy.

Kod rabatowy: {{discount_code}}
Ważny do: {{discount_expiry}}

Będzie nam również bardzo miło, jeżeli podzielą się Państwo swoją opinią:
{{google_review_url}}

Do zobaczenia ponownie!
Biesiada pod Lasem – Dolina Przygód
"""

DEFAULT_GOOGLE_REVIEW_URL = "https://g.page/r/CWTSbZ43izysEAE/review"


async def get_thank_you_settings(db, owner_id: str) -> dict:
    """Return effective thank-you email settings (subject, body, google url, rules)."""
    ws = await db.workspace_settings.find_one({"owner_id": owner_id}, {"_id": 0}) or {}
    cfg = ws.get("thank_you_email") or {}
    return {
        "enabled": cfg.get("enabled", True),
        "subject": cfg.get("subject") or DEFAULT_SUBJECT,
        "body_template": cfg.get("body_template") or DEFAULT_BODY_TEMPLATE,
        "google_review_url": cfg.get("google_review_url") or DEFAULT_GOOGLE_REVIEW_URL,
        "discount_pct": float(cfg.get("discount_pct") or DISCOUNT_PCT_DEFAULT),
        "valid_months": int(cfg.get("valid_months") or DISCOUNT_VALID_MONTHS_DEFAULT),
        # cutoff — feature must be "activated" first; retroactive events skip
        "activated_at": cfg.get("activated_at") or None,
    }


async def save_thank_you_settings(db, owner_id: str, patch: dict) -> dict:
    """Update thank-you email settings. Any unknown fields are ignored."""
    allowed = {"enabled", "subject", "body_template", "google_review_url", "discount_pct", "valid_months"}
    clean = {k: v for k, v in (patch or {}).items() if k in allowed}
    # Save under workspace_settings.thank_you_email.*
    set_ops = {f"thank_you_email.{k}": v for k, v in clean.items()}
    await db.workspace_settings.update_one(
        {"owner_id": owner_id},
        {"$set": {"owner_id": owner_id, **set_ops}},
        upsert=True,
    )
    return await get_thank_you_settings(db, owner_id)


async def ensure_feature_activated(db, owner_id: str) -> str:
    """Mark feature as activated (first use). Retroactive events (with date<activated_at date) are skipped."""
    settings = await get_thank_you_settings(db, owner_id)
    if settings.get("activated_at"):
        return settings["activated_at"]
    stamp = now_iso()
    await db.workspace_settings.update_one(
        {"owner_id": owner_id},
        {"$set": {"owner_id": owner_id, "thank_you_email.activated_at": stamp}},
        upsert=True,
    )
    return stamp


def render_template(tpl: str, ctx: dict) -> str:
    out = tpl or ""
    for k, v in (ctx or {}).items():
        out = out.replace("{{" + k + "}}", str(v if v is not None else ""))
    return out


def compute_expiry_date(months: int = DISCOUNT_VALID_MONTHS_DEFAULT) -> str:
    """Return ISO date (yyyy-mm-dd) for expiry N months from now."""
    now = datetime.now(timezone.utc)
    # Simple month arithmetic (approximate)
    m = now.month + months
    y = now.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    day = min(now.day, 28)  # avoid month-length edge cases
    return f"{y:04d}-{m:02d}-{day:02d}"


def format_expiry_pl(iso_date: str) -> str:
    try:
        d = datetime.strptime(iso_date, "%Y-%m-%d")
        return d.strftime("%d.%m.%Y")
    except Exception:
        return iso_date


def get_package_price_for_discount(event: dict) -> float:
    """Base package price used for 10% discount computation.

    Priority:
    1. event.package_price (if pre-computed)
    2. event.price_total minus known extras/dinner
    3. event.price_total (fallback)
    """
    pkg = event.get("package_price")
    if pkg and pkg > 0:
        return float(pkg)
    total = float(event.get("price_total") or event.get("revenue") or 0)
    if total <= 0:
        return 0.0
    # Try to subtract dinner revenue & extras
    dinner_rev = float(event.get("dinner_revenue") or 0)
    extras_total = 0.0
    extras = event.get("extras_qty") or {}
    if isinstance(extras, dict):
        # Best-effort — cannot know unit prices without offers table.
        # We accept event.extras_amount if provided.
        pass
    if event.get("extras_amount") is not None:
        try:
            extras_total = float(event["extras_amount"])
        except Exception:
            extras_total = 0.0
    base = total - dinner_rev - extras_total
    return round(max(0.0, base), 2)


def compute_discount_amount(package_price: float, pct: float) -> float:
    """Compute discount amount from package price (pct = 10 => 10%)."""
    if package_price <= 0:
        return 0.0
    return round(package_price * (float(pct) / 100.0), 2)


def build_email_context(event: dict, code: str, expiry_iso: str, google_review_url: str) -> dict:
    return {
        "client_name": (event.get("client_name") or "").strip() or "Państwo",
        "discount_code": code,
        "discount_expiry": format_expiry_pl(expiry_iso),
        "google_review_url": google_review_url,
        "event_name": event.get("name") or "",
        "event_date": event.get("date") or "",
    }
