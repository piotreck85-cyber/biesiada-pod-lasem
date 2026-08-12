"""Offer PDF generation and email sending via Gmail SMTP.

Uses reportlab for PDF and stdlib smtplib for sending.
Credentials are read from environment variables (see /app/backend/.env).
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from io import BytesIO
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER  # noqa: F401

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Brand palette (matches app dark-forest theme, but printed on white for readability)
FOREST_GREEN = colors.HexColor("#1F3A2E")
GOLD = colors.HexColor("#D4AF37")
DARK_TEXT = colors.HexColor("#111827")
MUTED = colors.HexColor("#4B5563")
CARD_BG = colors.HexColor("#F8F5EE")


# ---------- Static offer data (mirrors /app/frontend/src/offers.ts) ----------
ADULT_SETS = [
    {
        "name": "Zestaw nr 1",
        "price": 150,
        "items": [
            "Kiełbaska z rusztu",
            "Karkówka w ziołach",
            "Kaszanka z cebulką",
            "Pieczone ziemniaczki ziołowo-maślane",
        ],
        "addons": [
            "Pieczywo",
            "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
            "Ogóreczki kiszone",
            "Smalczyk wiejski",
            "Kawa, herbata",
        ],
    },
    {
        "name": "Zestaw nr 2",
        "price": 180,
        "items": [
            "Kiełbaska z rusztu (tradycyjna oraz biała)",
            "Karkówka w ziołach",
            "Kaszanka z cebulką",
            "Pieczone ziemniaczki ziołowo-maślane",
            "Pieczarka w boczku",
            "Żurek z kiełbaską i jajkiem",
        ],
        "addons": [
            "Pieczywo",
            "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
            "Ogóreczki kiszone",
            "Smalczyk Góralski",
            "Kawa, herbata",
        ],
    },
    {
        "name": "Zestaw nr 3",
        "price": 200,
        "items": [
            "Kiełbaska z rusztu (tradycyjna oraz biała)",
            "Karkówka w ziołach",
            "Kaszanka z cebulką",
            "Pieczone ziemniaczki ziołowo-maślane",
            "Pieczarka w boczku",
            "Warzywa grillowane",
            "Sałatka Grecka",
            "Żurek z kiełbaską i jajkiem",
        ],
        "addons": [
            "Pieczywo",
            "Sosy: musztarda, ketchup, chrzan, sos czosnkowy",
            "Ogóreczki kiszone",
            "Smalczyk Góralski",
            "Kawa, herbata",
        ],
    },
]

ADULT_EXTRAS = [
    {"id": "napoje", "name": "Napoje (cola, soki)", "unit": "os.", "price": 20},
    {"id": "taca_mies", "name": "Półmisek mięs (5–6 os.)", "unit": "szt.", "price": 200},
    {"id": "taca_mix", "name": "Taca przystawek mix (5–6 os.)", "unit": "szt.", "price": 180},
    {"id": "salatka", "name": "Sałatka (Farfalle, Gyros, Grecka, Cezar...)", "unit": "porcja", "price": 13},
]


def _fmt_pln(v: float) -> str:
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} zł"


def _find_set(set_id: Optional[str]) -> Optional[dict]:
    if not set_id:
        return None
    mapping = {"set1": 0, "set2": 1, "set3": 2}
    idx = mapping.get(set_id)
    if idx is None:
        return None
    return ADULT_SETS[idx]


# ---------- PDF generation ----------
def build_offer_pdf(
    *,
    client_name: Optional[str] = None,
    event_date: Optional[str] = None,
    people_count: Optional[int] = None,
    package_set_id: Optional[str] = None,
    extras: Optional[List[dict]] = None,
    custom_note: Optional[str] = None,
) -> bytes:
    """Return a PDF (bytes) with the personalized offer."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Oferta — Biesiada pod Lasem",
        author="Biesiada pod Lasem",
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "h1", parent=styles["Heading1"], fontName="Helvetica-Bold",
        fontSize=22, leading=26, textColor=FOREST_GREEN, spaceAfter=4,
    )
    tagline = ParagraphStyle(
        "tag", parent=styles["Normal"], fontName="Helvetica",
        fontSize=10, textColor=GOLD, spaceAfter=14,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], fontName="Helvetica-Bold",
        fontSize=14, leading=18, textColor=FOREST_GREEN, spaceBefore=14, spaceAfter=6,
    )
    body = ParagraphStyle(
        "body", parent=styles["Normal"], fontName="Helvetica",
        fontSize=10.5, leading=15, textColor=DARK_TEXT,
    )
    body_muted = ParagraphStyle(
        "body_m", parent=body, textColor=MUTED, fontSize=9.5,
    )
    hero_greeting = ParagraphStyle(
        "hero", parent=body, fontSize=12, leading=17, spaceAfter=4,
    )

    story = []

    # --- Header
    story.append(Paragraph("Biesiada pod Lasem", h1))
    story.append(Paragraph("KIELCE  ·  DOLINA PRZYGÓD  ·  IMPREZY PLENEROWE", tagline))
    story.append(Spacer(1, 4))

    # --- Personalized greeting
    greeting_parts = ["Szanowni Państwo"]
    if client_name and client_name.strip():
        greeting_parts = [f"Szanowni Państwo {client_name.strip()}"]
    story.append(Paragraph(", ".join(greeting_parts) + ",", hero_greeting))
    story.append(Paragraph(
        "Serdecznie dziękujemy za zainteresowanie naszą ofertą. "
        "Poniżej przedstawiamy propozycję dopasowaną do Państwa wydarzenia. "
        "Chętnie odpowiemy na wszystkie pytania i wprowadzimy modyfikacje.",
        body,
    ))

    # --- Event summary card (if data provided)
    if event_date or people_count:
        summary_rows = []
        if event_date:
            summary_rows.append(["Data wydarzenia", event_date])
        if people_count:
            summary_rows.append(["Liczba osób", f"{people_count}"])
        chosen = _find_set(package_set_id)
        if chosen:
            summary_rows.append(["Wybrany zestaw", f"{chosen['name']}  ·  {_fmt_pln(chosen['price'])}/os."])
        if summary_rows:
            t = Table(summary_rows, colWidths=[45 * mm, 120 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, GOLD),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E5D9B5")),
                ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
                ("FONT", (1, 0), (1, -1), "Helvetica", 10),
                ("TEXTCOLOR", (0, 0), (0, -1), FOREST_GREEN),
                ("TEXTCOLOR", (1, 0), (1, -1), DARK_TEXT),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(Spacer(1, 8))
            story.append(t)

    # --- Chosen set details + calculation (recommendation card)
    chosen = _find_set(package_set_id)
    if chosen and people_count:
        story.append(Paragraph("Nasza propozycja dla Państwa", h2))
        story.append(Paragraph(
            f"Na podstawie przekazanych informacji proponujemy <b>{chosen['name']}</b> "
            f"dla <b>{people_count} osób</b>. Poniżej wyliczenie orientacyjne — pełny wybór "
            f"znajdą Państwo w dalszej części oferty.",
            body,
        ))

        # Cost calc
        base_total = chosen["price"] * people_count
        extras_total = 0.0
        extras_rows = []
        if extras:
            for e in extras:
                eid = e.get("id")
                qty = float(e.get("qty") or 0)
                custom_amount = float(e.get("amount") or 0)
                if eid == "ciasto":
                    if custom_amount <= 0:
                        continue
                    price_each = custom_amount
                    line_total = custom_amount
                    label = "Ciasto (własne)"
                    qty_label = "kwota"
                else:
                    src = next((x for x in ADULT_EXTRAS if x["id"] == eid), None)
                    if not src or qty <= 0:
                        continue
                    price_each = src["price"]
                    line_total = qty * price_each
                    label = src["name"]
                    qty_label = f"{int(qty) if qty.is_integer() else qty} × {src['unit']}"
                extras_total += line_total
                extras_rows.append([label, qty_label, _fmt_pln(price_each), _fmt_pln(line_total)])

        calc_rows = [
            [f"{chosen['name']}", f"{people_count} × os.", _fmt_pln(chosen["price"]), _fmt_pln(base_total)],
            *extras_rows,
        ]
        grand = base_total + extras_total
        calc_rows.append(["", "", "RAZEM", _fmt_pln(grand)])

        t2 = Table(calc_rows, colWidths=[75 * mm, 30 * mm, 30 * mm, 30 * mm])
        t2.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CARD_BG),
            ("BACKGROUND", (0, -1), (-1, -1), FOREST_GREEN),
            ("TEXTCOLOR", (0, -1), (-1, -1), GOLD),
            ("FONT", (0, 0), (-1, -2), "Helvetica", 9.5),
            ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 11),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#E5D9B5")),
        ]))
        story.append(t2)
        story.append(Paragraph(
            "Wyliczenie jest orientacyjne. Poniżej pełny katalog zestawów i dodatków — "
            "mogą Państwo wybrać dowolną konfigurację, którą dopasujemy do wydarzenia.",
            body_muted,
        ))

    # --- Full catalog: ALL sets with full details
    story.append(Paragraph("Pełna oferta — Zestawy Grill Menu", h2))
    story.append(Paragraph(
        "Wszystkie ceny za osobę. Dodatki w cenie każdego zestawu.",
        body_muted,
    ))
    for zs in ADULT_SETS:
        # Set header row
        head_data = [[Paragraph(f"<b>{zs['name']}</b>", body), Paragraph(f"<b>{_fmt_pln(zs['price'])} / os.</b>", body)]]
        thead = Table(head_data, colWidths=[125 * mm, 40 * mm])
        thead.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), FOREST_GREEN),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(Spacer(1, 8))
        story.append(thead)

        # Items + addons in a single card
        item_paras = [Paragraph("<b>W zestawie:</b>", body)]
        for it in zs["items"]:
            item_paras.append(Paragraph(f"•  {it}", body))
        item_paras.append(Spacer(1, 4))
        item_paras.append(Paragraph("<b>Dodatki w cenie:</b>", body))
        for a in zs["addons"]:
            item_paras.append(Paragraph(f"•  {a}", body_muted))

        card = Table([[item_paras]], colWidths=[165 * mm])
        card.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, GOLD),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(card)

    # --- Extras (with full description)
    story.append(Paragraph("Dodatki à la carte", h2))
    story.append(Paragraph(
        "Możliwość rozszerzenia dowolnego zestawu.",
        body_muted,
    ))
    extras_all_rows = [["Dodatek", "Cena"]]
    for e in ADULT_EXTRAS:
        extras_all_rows.append([e["name"], f"{_fmt_pln(e['price'])} / {e['unit']}"])
    extras_all_rows.append(["Ciasto (własne)", "wg wyceny"])
    t4 = Table(extras_all_rows, colWidths=[125 * mm, 40 * mm])
    t4.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), FOREST_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 10),
        ("BACKGROUND", (0, 1), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, GOLD),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E5D9B5")),
        ("ALIGN", (1, 1), (1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t4)

    # --- Call to action / how to choose
    story.append(Spacer(1, 10))
    cta = Table([[Paragraph(
        "<b>Jak wybrać?</b>  Wystarczy wskazać zestaw (1, 2 lub 3), liczbę osób i ewentualne "
        "dodatki. Chętnie pomożemy dopasować ofertę do Państwa oczekiwań — prosimy o kontakt "
        "mailowy lub telefoniczny.",
        body,
    )]], colWidths=[165 * mm])
    cta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8E1")),
        ("BOX", (0, 0), (-1, -1), 0.5, GOLD),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(cta)

    # --- Custom note
    if custom_note and custom_note.strip():
        story.append(Paragraph("Uwagi", h2))
        story.append(Paragraph(custom_note.strip().replace("\n", "<br/>"), body))

    # --- Footer
    story.append(Spacer(1, 18))
    story.append(Paragraph(
        "<b>Biesiada pod Lasem</b> · Dolina Przygód, Kielce<br/>"
        "www.dolinaprzygod.pl · biesiadapodlasem@gmail.com",
        body_muted,
    ))
    story.append(Paragraph(
        "Cieszymy się na możliwość organizacji Państwa wydarzenia. Do zobaczenia pod lasem! 🌲",
        body_muted,
    ))

    doc.build(story)
    return buf.getvalue()


# ---------- Email sending ----------
def send_offer_email(
    *,
    to_email: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    pdf_filename: str = "Oferta-Biesiada-pod-Lasem.pdf",
    reply_to: Optional[str] = None,
) -> None:
    """Send an email with an optional PDF attachment via Gmail SMTP.

    Raises RuntimeError with a Polish-friendly message on failure.
    """
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    from_name = os.getenv("SMTP_FROM_NAME", "Biesiada pod Lasem")

    if not user or not password:
        raise RuntimeError("Konfiguracja SMTP niedostępna (brak SMTP_USER/PASSWORD w .env).")

    msg = EmailMessage()
    msg["From"] = f"{from_name} <{user}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    if pdf_bytes:
        msg.add_attachment(
            pdf_bytes,
            maintype="application",
            subtype="pdf",
            filename=pdf_filename,
        )

    context = ssl.create_default_context()
    try:
        with smtplib.SMTP(host, port, timeout=25) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(user, password)
            server.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        raise RuntimeError(
            "Nie udało się zalogować do Gmaila. Sprawdź hasło aplikacji i włącz 2-Step Verification."
        ) from exc
    except smtplib.SMTPRecipientsRefused as exc:
        raise RuntimeError(f"Adres odbiorcy odrzucony: {to_email}") from exc
    except smtplib.SMTPException as exc:
        raise RuntimeError(f"Błąd SMTP: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(f"Błąd sieci przy wysyłce maila: {exc}") from exc
