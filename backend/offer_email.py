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

# ---------- Birthday packages (kids) ----------
BIRTHDAY_PACKAGES = [
    {
        "name": "START",
        "duration": "2 h",
        "capacity": "do 15 osób",
        "features": [
            "Dmuchaniec",
            "Karmienie i spacer z alpakami",
            "Ognisko i grill",
            "Zastawa urodzinowa",
            "Kawa i herbata dla dorosłych",
            "Teren na wyłączność",
        ],
        "price_weekday": 800,
        "price_weekend": None,
    },
    {
        "name": "STANDARD",
        "duration": "3 h",
        "capacity": "do 20 osób",
        "features": [
            "Dmuchaniec",
            "Karmienie i spacer z alpakami",
            "Ognisko i grill",
            "Bańki mydlane",
            "Prezent dla solenizanta",
            "Zastawa urodzinowa",
            "Kawa i herbata dla dorosłych",
            "Teren na wyłączność",
        ],
        "price_weekday": 1150,
        "price_weekend": 1450,
    },
    {
        "name": "GADY",
        "duration": "3 h",
        "capacity": "do 20 osób",
        "features": [
            "Wszystko ze STANDARD",
            "Spotkanie z wężem",
            "Gekon i jaszczurka",
            "Edukacja o gadach",
        ],
        "price_weekday": 1450,
        "price_weekend": 1850,
    },
    {
        "name": "KONIE",
        "duration": "4 h",
        "capacity": "do 20 osób",
        "features": [
            "Wszystko ze STANDARD",
            "Przejażdżka na koniu dla każdego dziecka",
        ],
        "price_weekday": 1950,
        "price_weekend": 2150,
    },
    {
        "name": "TEMATYCZNY",
        "duration": "3 h",
        "capacity": "do 20 osób",
        "features": [
            "Wszystko ze STANDARD",
            "Animacje tematyczne",
            "Motywy: Dziki Zachód, Psi Patrol, K-pop, Harry Potter i inne",
        ],
        "price_weekday": 1450,
        "price_weekend": 1750,
    },
]
BIRTHDAY_ABOVE_LIMIT = "Powyżej limitu: +30 zł/os. (pon–czw) · +40 zł/os. (pt–nd)"

# ---------- Workshops (educational) ----------
WORKSHOPS = [
    {"name": "Skarby Przyrody", "season": "Przyrodnicze", "price": 85},
    {"name": "Owady i Kwiaty", "season": "Przyrodnicze", "price": 85},
    {"name": "Moja Własna Roślina", "season": "Przyrodnicze", "price": 85},
    {"name": "Las w Słoiku", "season": "Przyrodnicze", "price": 95},
    {"name": "Ptaki Wokół Nas", "season": "Przyrodnicze", "price": 85},
    {"name": "Dom dla Owada", "season": "Przyrodnicze", "price": 95},
    {"name": "Jesień pod Lasem", "season": "Jesień 2026", "price": 90},
    {"name": "Jabłkowe Szaleństwo", "season": "Jesień 2026", "price": 90},
    {"name": "Wielka Ziemniaczana Przygoda", "season": "Jesień 2026", "price": 90},
    {"name": "Wielka Przygoda Przedszkolaka", "season": "Jesień 2026", "price": 90},
    {"name": "Dyniowa Przygoda w Lesie", "season": "Jesień 2026", "price": 90},
    {"name": "Halloween w Lesie", "season": "Jesień 2026", "price": 90},
]
WORKSHOPS_INFO = "3–4 h · Opiekunowie i nauczyciele gratis · Kiełbaska i napoje w cenie"


# ---------- Event type templates ----------
# event_type in {"okolicznosciowe", "firmowe", "urodziny", "warsztaty"} — determines
# both the email intro text and which sections appear in the PDF.

EVENT_TYPE_LABELS = {
    "okolicznosciowe": "impreza okolicznościowa",
    "firmowe": "impreza firmowa",
    "urodziny": "urodziny dziecka",
    "warsztaty": "warsztaty edukacyjne",
}

# The exact wording provided by the owner for occasional and corporate events.
_INTRO_ADULT = (
    "zgodnie z ustaleniami przesyłam ofertę Biesiady pod Lasem.\n\n"
    "W ramach organizacji przyjęcia zapewniamy:\n"
    "•  obiekt na wyłączność na czas trwania imprezy,\n"
    "•  przygotowanie i wystrój miejsca,\n"
    "•  obsługę grilla,\n"
    "•  obsługę ogniska,\n"
    "•  przygotowanie przestrzeni przed przyjęciem oraz bieżącą obsługę podczas wydarzenia.\n\n"
    "Godzina rozpoczęcia imprezy jest do indywidualnego ustalenia, natomiast przyjęcie "
    "trwa do godziny 22:00.\n\n"
    "Ze względu na charakter i położenie Biesiady pod Lasem, podczas imprezy muzyka "
    "będzie odtwarzana na umiarkowanym poziomie głośności.\n\n"
    "Istnieje możliwość przedłużenia przyjęcia maksymalnie o 1 godzinę, do godz. 23:00, "
    "za dodatkową opłatą 600 zł. Po godz. 22:00 muzyka będzie odtwarzana wyłącznie w tle, "
    "na obniżonym poziomie głośności.\n\n"
    "W razie pytań pozostajemy do dyspozycji."
)

_INTRO_BIRTHDAY = (
    "zgodnie z ustaleniami przesyłam ofertę urodzinową Biesiady pod Lasem.\n\n"
    "W ramach urodzinek zapewniamy:\n"
    "•  teren na wyłączność w trakcie przyjęcia,\n"
    "•  dmuchaniec dla dzieci,\n"
    "•  karmienie i spacer z alpakami,\n"
    "•  ognisko z kiełbaskami i grillowanym ziemniakiem,\n"
    "•  zastawę urodzinową, kawę i herbatę dla dorosłych,\n"
    "•  bieżącą obsługę i opiekę animacyjną.\n\n"
    "Do wyboru mamy pięć wariantów: START, STANDARD, GADY, KONIE i TEMATYCZNY — "
    "szczegóły znajdą Państwo w załączonym PDF.\n\n"
    "W razie pytań pozostajemy do dyspozycji."
)

_INTRO_WORKSHOPS = (
    "serdecznie zapraszamy do zapoznania się z naszą ofertą warsztatów jesiennych "
    "dla dzieci, przygotowaną z myślą o szkołach i przedszkolach.\n\n"
    "W załączniku przesyłamy szczegółową ofertę. Mamy nadzieję, że przygotowane przez nas "
    "propozycje spotkają się z Państwa zainteresowaniem i będą okazją do spędzenia przez "
    "dzieci czasu w ciekawy, kreatywny i pełen jesiennej atmosfery sposób.\n\n"
    "W przypadku pytań lub chęci rezerwacji terminu zapraszamy do kontaktu:\n\n"
    "📞 518 029 217 lub 510 558 592\n"
    "📧 biesiadapodlasem@gmail.com\n"
    "🌐 dolinaprzygod.pl\n"
    "📍 ul. Zastawie 4, Kielce\n\n"
    "Będzie nam bardzo miło gościć Państwa w Biesiadzie pod lasem!"
)

# Custom sign-off overrides per event type. If ``None`` the default footer is used.
EVENT_TYPE_SIGNOFFS = {
    "warsztaty": "Serdecznie pozdrawiamy\nBiesiada Pod Lasem",
}

EVENT_TYPE_INTROS = {
    "okolicznosciowe": _INTRO_ADULT,
    "firmowe": _INTRO_ADULT,
    "urodziny": _INTRO_BIRTHDAY,
    "warsztaty": _INTRO_WORKSHOPS,
}


def build_intro_text(event_type: Optional[str]) -> str:
    """Return the Polish intro paragraph for the given event type.

    Falls back to a generic short intro if the type is unknown.
    """
    if event_type and event_type in EVENT_TYPE_INTROS:
        return EVENT_TYPE_INTROS[event_type]
    return (
        "przesyłam ofertę Biesiady pod Lasem — szczegóły w załączonym PDF. "
        "W razie pytań pozostajemy do dyspozycji."
    )


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
    event_type: Optional[str] = None,  # okolicznosciowe | firmowe | urodziny | warsztaty
) -> bytes:
    """Return a PDF (bytes) with the personalized offer.

    The catalog section is chosen by ``event_type``:
      * okolicznosciowe/firmowe → Grill menu (Zestawy 1/2/3 + dodatki)
      * urodziny → Birthday packages (START/STANDARD/GADY/KONIE/TEMATYCZNY)
      * warsztaty → Workshops list
      * None/unknown → Grill menu (default, backwards compatible)
    """
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

    # Which catalog to show?
    is_adult = event_type in (None, "okolicznosciowe", "firmowe")
    is_birthday = event_type == "urodziny"
    is_workshops = event_type == "warsztaty"

    # --- Chosen set details + calculation (recommendation card) — adult only
    chosen = _find_set(package_set_id) if is_adult else None
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

    # --- Full catalog: content depends on event_type
    if is_adult:
        story.append(Paragraph("Pełna oferta — Zestawy Grill Menu", h2))
        story.append(Paragraph(
            "Wszystkie ceny za osobę. Dodatki w cenie każdego zestawu.",
            body_muted,
        ))
        for zs in ADULT_SETS:
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

        # Extras
        story.append(Paragraph("Dodatki à la carte", h2))
        story.append(Paragraph("Możliwość rozszerzenia dowolnego zestawu.", body_muted))
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

    elif is_birthday:
        # --- Birthday packages catalog
        story.append(Paragraph("Pełna oferta — Pakiety urodzinowe", h2))
        story.append(Paragraph(
            "Cena za cały pakiet (nie za osobę). " + BIRTHDAY_ABOVE_LIMIT,
            body_muted,
        ))
        for p in BIRTHDAY_PACKAGES:
            # Header
            price_str_parts = []
            if p.get("price_weekday") is not None:
                price_str_parts.append(f"Pon–Czw: <b>{_fmt_pln(p['price_weekday'])}</b>")
            if p.get("price_weekend") is not None:
                price_str_parts.append(f"Pt–Nd: <b>{_fmt_pln(p['price_weekend'])}</b>")
            price_str = "  ·  ".join(price_str_parts) if price_str_parts else "cena na zapytanie"

            head_data = [[
                Paragraph(f"<b>{p['name']}</b>  <font size=9>({p['duration']} · {p['capacity']})</font>", body),
                Paragraph(price_str, body),
            ]]
            thead = Table(head_data, colWidths=[85 * mm, 80 * mm])
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

            # Features card
            feats = [Paragraph("<b>W pakiecie:</b>", body)]
            for f in p["features"]:
                feats.append(Paragraph(f"•  {f}", body))
            card = Table([[feats]], colWidths=[165 * mm])
            card.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, GOLD),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]))
            story.append(card)

    elif is_workshops:
        # --- Workshops catalog
        story.append(Paragraph("Pełna oferta — Warsztaty", h2))
        story.append(Paragraph(WORKSHOPS_INFO, body_muted))
        # Group by season
        by_season: dict = {}
        for w in WORKSHOPS:
            by_season.setdefault(w["season"], []).append(w)
        for season, group in by_season.items():
            story.append(Spacer(1, 8))
            story.append(Paragraph(f"<b>{season}</b>", body))
            rows = [["Warsztaty", "Cena za dziecko"]]
            for w in group:
                rows.append([w["name"], _fmt_pln(w["price"])])
            tw = Table(rows, colWidths=[125 * mm, 40 * mm])
            tw.setStyle(TableStyle([
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
            story.append(tw)

    # --- Call to action / how to choose (type-specific)
    story.append(Spacer(1, 10))
    if is_birthday:
        cta_text = ("<b>Jak wybrać?</b>  Wystarczy wskazać pakiet (START, STANDARD, GADY, "
                    "KONIE lub TEMATYCZNY) oraz przewidywaną liczbę dzieci. Chętnie pomożemy "
                    "dopasować urodziny do wieku i zainteresowań solenizanta.")
    elif is_workshops:
        cta_text = ("<b>Jak zapisać grupę?</b>  Prosimy o kontakt z podaniem preferowanego "
                    "terminu, tematu warsztatów i liczby dzieci. Warsztaty dostosowujemy do "
                    "wieku grupy (od przedszkola do klasy VIII).")
    else:
        cta_text = ("<b>Jak wybrać?</b>  Wystarczy wskazać zestaw (1, 2 lub 3), liczbę osób i "
                    "ewentualne dodatki. Chętnie pomożemy dopasować ofertę do Państwa oczekiwań "
                    "— prosimy o kontakt mailowy lub telefoniczny.")
    cta = Table([[Paragraph(cta_text, body)]], colWidths=[165 * mm])
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
    extra_attachments: Optional[List[dict]] = None,  # [{path, filename?, mime?}]
    reply_to: Optional[str] = None,
) -> None:
    """Send an email with an optional PDF attachment + extra files via Gmail SMTP.

    ``extra_attachments`` is a list of ``{"path": "/abs/path", "filename": "...", "mime": "application/..."}``
    entries; ``filename`` and ``mime`` are optional (defaults are derived from the path).

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

    # Extra attachments (e.g. original DOCX menus)
    for att in extra_attachments or []:
        path = att.get("path")
        if not path or not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        filename = att.get("filename") or os.path.basename(path)
        mime = att.get("mime")
        if not mime:
            # naive extension → mime mapping
            ext = os.path.splitext(filename)[1].lower()
            mime_map = {
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".doc": "application/msword",
                ".pdf": "application/pdf",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
            }
            mime = mime_map.get(ext, "application/octet-stream")
        maintype, _, subtype = mime.partition("/")
        msg.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=filename)

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
