"""Etap 3 — dokumenty PDF imprezy (reportlab).

Two builders:
- build_confirmation_pdf(ev)  — elegant client-facing event confirmation (with payments)
- build_staff_card_pdf(ev, staff_map, checklist) — internal staff card (NO finances)

Both use the V2.0 forest-green branding consistent with offer_email.py and register
Liberation Sans for full Polish diacritics support.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from offer_email import _find_set, find_extra

# ---------- Fonts (Polish diacritics) ----------
FONT, FONT_BOLD = "Helvetica", "Helvetica-Bold"
try:
    pdfmetrics.registerFont(TTFont("PLSans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("PLSans-Bold", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"))
    FONT, FONT_BOLD = "PLSans", "PLSans-Bold"
except Exception:
    pass

# ---------- V2.0 palette ----------
FOREST_DEEP = colors.HexColor("#1B3122")
FOREST = colors.HexColor("#285338")
MOSS = colors.HexColor("#437A56")
MINT = colors.HexColor("#E2EFE7")
GOLD = colors.HexColor("#D4AF37")
DARK = colors.HexColor("#1A2E20")
MUTED = colors.HexColor("#5A6B5F")
BORDER = colors.HexColor("#C2D1C5")
CARD = colors.HexColor("#F9FBF9")
RED = colors.HexColor("#B91C1C")
RED_BG = colors.HexColor("#FEE2E2")

_WEEKDAYS = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]
_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
           "lipca", "sierpnia", "września", "października", "listopada", "grudnia"]

CATEGORY_LABELS = {
    "dorosli/firmowe": "Dorośli · Firmowe",
    "dorosli/okolicznosciowe": "Dorośli · Okolicznościowe",
    "dzieci/urodzinki/start": "Urodzinki · Start",
    "dzieci/urodzinki/standard": "Urodzinki · Standard",
    "dzieci/urodzinki/tematyczne": "Urodzinki · Tematyczne",
    "dzieci/urodzinki/konie": "Urodzinki · Konie",
    "dzieci/urodzinki/gady": "Urodzinki · Gady",
    "dzieci/wycieczki": "Dzieci · Wycieczki szkolne",
    "dzieci/wycieczki_rodzice": "Dzieci · Wycieczki z rodzicami",
    "warsztaty/przyrodnicze": "Warsztaty · Przyrodnicze",
    "warsztaty/sezonowe": "Warsztaty · Sezonowe (jesień)",
    "warsztaty": "Warsztaty · Inne",
}

ORG_LABELS = [
    ("tables_setup", "Ustawienie stołów"),
    ("tables_plan", "Plan / układ stołów"),
    ("menu_details", "Menu (szczegóły dla obsługi)"),
    ("grill", "Grill / ognisko"),
    ("drinks", "Napoje"),
    ("cakes", "Ciasta i przekąski"),
    ("client_provisions", "Dodatkowy prowiant klienta"),
    ("decorations", "Dekoracje"),
    ("client_own_decorations", "Dekoracje własne klienta"),
    ("early_arrival", "Wcześniejszy przyjazd"),
    ("early_arrival_time", "Godzina wcześniejszego przyjazdu"),
    ("attractions", "Atrakcje"),
    ("extra_orders", "Dodatkowe zamówienia"),
    ("org_notes", "Informacje organizacyjne"),
    ("special_requests", "Specjalne wymagania klienta"),
    ("allergies", "Alergie / wymagania żywieniowe"),
    ("setup_info", "Przygotowanie miejsca"),
]

STATUS_LABELS = {
    "wstepne": "Wstępne zapytanie",
    "rezerwacja": "Rezerwacja",
    "potwierdzona": "POTWIERDZONA",
    "zakonczona": "Zakończona",
    "anulowana": "Anulowana",
}


def _pln(v) -> str:
    try:
        return f"{float(v):,.2f}".replace(",", " ").replace(".", ",") + " zł"
    except Exception:
        return "—"


def _date_pl(iso: str) -> str:
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        return f"{_WEEKDAYS[d.weekday()]}, {d.day} {_MONTHS[d.month - 1]} {d.year}"
    except Exception:
        return iso or "—"


def _styles():
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=FONT_BOLD,
                             fontSize=21, leading=25, textColor=FOREST, spaceAfter=2),
        "tag": ParagraphStyle("tag", parent=base["Normal"], fontName=FONT,
                              fontSize=9.5, textColor=GOLD, spaceAfter=10),
        "title": ParagraphStyle("title", parent=base["Normal"], fontName=FONT_BOLD,
                                fontSize=13, leading=17, textColor=colors.white),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=FONT_BOLD,
                             fontSize=12.5, leading=16, textColor=FOREST, spaceBefore=12, spaceAfter=5),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName=FONT,
                               fontSize=10.5, leading=15, textColor=DARK),
        "body_b": ParagraphStyle("body_b", parent=base["Normal"], fontName=FONT_BOLD,
                                 fontSize=10.5, leading=15, textColor=DARK),
        "muted": ParagraphStyle("muted", parent=base["Normal"], fontName=FONT,
                                fontSize=9, leading=13, textColor=MUTED),
        "warn": ParagraphStyle("warn", parent=base["Normal"], fontName=FONT_BOLD,
                               fontSize=10.5, leading=15, textColor=RED),
    }


def _header(story, st, title_text: str, subtitle: str = ""):
    story.append(Paragraph("Biesiada pod Lasem", st["h1"]))
    story.append(Paragraph("KIELCE  ·  DOLINA PRZYGÓD  ·  IMPREZY PLENEROWE", st["tag"]))
    bar = Table([[Paragraph(title_text, st["title"])]], colWidths=[174 * mm])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FOREST_DEEP),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(bar)
    if subtitle:
        story.append(Spacer(1, 4))
        story.append(Paragraph(subtitle, st["muted"]))
    story.append(Spacer(1, 8))


def _kv_table(rows, st, label_w=52):
    data = [[Paragraph(f"<b>{k}</b>", st["body_b"]), Paragraph(str(v), st["body"])] for k, v in rows]
    t = Table(data, colWidths=[label_w * mm, (174 - label_w) * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _doc(buf, title):
    return SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=title, author="Biesiada pod Lasem",
    )


def _event_time(ev) -> str:
    ts, te = ev.get("time_start") or "", ev.get("time_end") or ""
    if ts and te:
        return f"{ts} – {te}"
    return ts or ev.get("time") or "—"


def _people_line(ev) -> str:
    parts = []
    if ev.get("people"):
        parts.append(f"{ev['people']} osób")
    org = ev.get("org") or {}
    sub = []
    if org.get("adults_count"):
        sub.append(f"{org['adults_count']} dorosłych")
    if org.get("kids_count"):
        sub.append(f"{org['kids_count']} dzieci")
    if sub:
        parts.append("(" + ", ".join(sub) + ")")
    return " ".join(parts) or "—"


# ===========================================================================
# 1. POTWIERDZENIE IMPREZY (dla klienta)
# ===========================================================================
def build_confirmation_pdf(ev: dict, dinner_names: Optional[dict] = None) -> bytes:
    st = _styles()
    buf = BytesIO()
    doc = _doc(buf, "Potwierdzenie imprezy — Biesiada pod Lasem")
    story = []

    status = (ev.get("status") or "").strip()
    _header(story, st, "POTWIERDZENIE REZERWACJI IMPREZY",
            f"Status: {STATUS_LABELS.get(status, status or '—')}  ·  wygenerowano {datetime.now().strftime('%d.%m.%Y')}")

    who = (ev.get("client_name") or "").strip()
    story.append(Paragraph(f"Szanowni Państwo{(' ' + who) if who else ''},", st["body_b"]))
    story.append(Paragraph(
        "z przyjemnością potwierdzamy szczegóły Państwa rezerwacji w Biesiadzie pod Lasem. "
        "Prosimy o sprawdzenie poniższych informacji — w razie zmian prosimy o kontakt.",
        st["body"],
    ))
    story.append(Spacer(1, 6))

    # --- Szczegóły imprezy
    story.append(Paragraph("Szczegóły imprezy", st["h2"]))
    rows = [
        ("Nazwa imprezy", ev.get("name") or "—"),
        ("Data", _date_pl(ev.get("date") or "")),
        ("Godziny", _event_time(ev)),
        ("Liczba gości", _people_line(ev)),
    ]
    cat = ev.get("category") or ""
    if cat:
        rows.append(("Rodzaj imprezy", CATEGORY_LABELS.get(cat, cat)))
    chosen = _find_set(ev.get("package_set") or None)
    if chosen:
        rows.append(("Wybrany zestaw", f"{chosen['name']}  ·  {_pln(chosen['price'])}/os."))
    if ev.get("venue"):
        rows.append(("Miejsce", ev["venue"]))
    story.append(_kv_table(rows, st))

    # --- Menu obiadowe (jeśli wybrane)
    dinner = {k: v for k, v in (ev.get("dinner_items") or {}).items() if v}
    if dinner:
        story.append(Paragraph("Menu obiadowe", st["h2"]))
        data = [[Paragraph("<b>Pozycja</b>", st["body_b"]), Paragraph("<b>Porcje</b>", st["body_b"])]]
        for did, qty in dinner.items():
            name = (dinner_names or {}).get(did, did)
            data.append([Paragraph(name, st["body"]), Paragraph(f"{qty:g}", st["body"])])
        t = Table(data, colWidths=[140 * mm, 34 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), FOREST),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARD]),
        ]))
        story.append(t)

    # --- Dodatki (extras)
    extras = {k: v for k, v in (ev.get("extras_qty") or {}).items() if v}
    if extras:
        story.append(Paragraph("Dodatki", st["h2"]))
        lines = []
        for eid, qty in extras.items():
            ex = find_extra(eid)
            name = ex["name"] if ex else eid
            unit = (ex or {}).get("unit") or ""
            if unit == "kwota":
                lines.append(f"• {name} — {_pln(qty)}")
            else:
                lines.append(f"• {name} × {qty:g}")
        story.append(Paragraph("<br/>".join(lines), st["body"]))

    # --- Płatności
    price = float(ev.get("price_after_discount") or 0) or float(ev.get("price_total") or 0)
    deposit = float(ev.get("deposit_amount") or 0)
    deposit_paid = bool(ev.get("deposit_paid"))
    if price > 0 or deposit > 0:
        story.append(Paragraph("Płatności", st["h2"]))
        pay_rows = []
        if float(ev.get("discount_pct") or 0) > 0 and float(ev.get("price_total") or 0) > 0:
            pay_rows.append(("Cena przed rabatem", _pln(ev.get("price_total"))))
            pay_rows.append(("Rabat", f"{float(ev.get('discount_pct')):g}%"))
        applied = ev.get("applied_discount") or {}
        if applied.get("code"):
            pay_rows.append(("Kod rabatowy", f"{applied.get('code')}  (−{_pln(applied.get('amount_zl') or 0)})"))
        pay_rows.append(("Cena całkowita", _pln(price) if price > 0 else "—"))
        if deposit > 0:
            dep_txt = _pln(deposit)
            if deposit_paid:
                dep_txt += "  ·  wpłacona" + (f" dnia {ev.get('deposit_date')}" if ev.get("deposit_date") else "")
            else:
                dep_txt += "  ·  oczekujemy na wpłatę"
            pay_rows.append(("Zaliczka", dep_txt))
            if price > 0 and deposit_paid:
                pay_rows.append(("Pozostało do zapłaty", _pln(max(price - deposit, 0))))
        t = _kv_table(pay_rows, st)
        story.append(t)

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        "Dziękujemy za wybór Biesiady pod Lasem! Na dwa dni przed imprezą otrzymają Państwo "
        "wiadomość z regulaminem i mapą dojazdu. W razie pytań prosimy o wiadomość zwrotną.",
        st["body"],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Do zobaczenia pod lasem! 🌲", st["body_b"]))
    story.append(Spacer(1, 16))
    story.append(Paragraph("Biesiada pod Lasem  ·  Kielce — Dolina Przygód  ·  imprezy plenerowe", st["muted"]))

    doc.build(story)
    return buf.getvalue()


# ===========================================================================
# 2. KARTA IMPREZY — DLA OBSŁUGI (wewnętrzna, BEZ finansów)
# ===========================================================================
def build_staff_card_pdf(ev: dict, staff_map: Optional[dict] = None,
                         checklist: Optional[list] = None) -> bytes:
    st = _styles()
    buf = BytesIO()
    doc = _doc(buf, "Karta imprezy dla obsługi — Biesiada pod Lasem")
    story = []

    _header(story, st, "KARTA IMPREZY — DLA OBSŁUGI",
            "Dokument wewnętrzny · nie zawiera danych finansowych ani kontaktowych klienta")

    # --- Podstawowe informacje
    story.append(Paragraph("Podstawowe informacje", st["h2"]))
    rows = [
        ("Impreza", ev.get("name") or "—"),
        ("Data", _date_pl(ev.get("date") or "")),
        ("Godziny", _event_time(ev)),
        ("Goście", _people_line(ev)),
    ]
    cat = ev.get("category") or ""
    if cat:
        rows.append(("Kategoria", CATEGORY_LABELS.get(cat, cat)))
    if ev.get("venue"):
        rows.append(("Miejsce", ev["venue"]))
    story.append(_kv_table(rows, st))

    # --- Zespół (bez stawek!)
    shifts = ev.get("shifts") or []
    if shifts:
        story.append(Paragraph("Zespół na zmianie", st["h2"]))
        data = [[Paragraph("<b>Pracownik</b>", st["body_b"]),
                 Paragraph("<b>Rola</b>", st["body_b"]),
                 Paragraph("<b>Godziny</b>", st["body_b"]),
                 Paragraph("<b>Notatka</b>", st["body_b"])]]
        for sh in shifts:
            s_doc = (staff_map or {}).get(sh.get("staff_id")) or {}
            hours = ""
            if sh.get("time_start"):
                hours = f"{sh['time_start']}–{sh.get('time_end') or ''}"
            elif sh.get("hours"):
                hours = f"{float(sh['hours']):g} h"
            data.append([
                Paragraph(s_doc.get("name") or "?", st["body"]),
                Paragraph(sh.get("role") or s_doc.get("role") or "—", st["body"]),
                Paragraph(hours or "—", st["body"]),
                Paragraph(sh.get("note") or "", st["body"]),
            ])
        t = Table(data, colWidths=[50 * mm, 40 * mm, 34 * mm, 50 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), FOREST),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CARD]),
        ]))
        story.append(t)

    # --- Organizacja
    org = ev.get("org") or {}
    org_rows = [(label, org.get(key)) for key, label in ORG_LABELS if str(org.get(key) or "").strip()]
    if org_rows:
        story.append(Paragraph("Organizacja", st["h2"]))
        story.append(_kv_table(org_rows, st, label_w=58))

    # --- Najnowsze informacje od klienta
    if str(ev.get("client_update_text") or "").strip():
        story.append(Paragraph("Najnowsze informacje od klienta", st["h2"]))
        story.append(Paragraph(ev["client_update_text"], st["body"]))

    # --- Informacje dla obsługi (service_infos)
    infos = ev.get("service_infos") or []
    if infos:
        story.append(Paragraph("Informacje dla obsługi", st["h2"]))
        for info in infos:
            txt = str(info.get("text") or "").strip()
            if not txt:
                continue
            if info.get("important"):
                p = Table([[Paragraph(f"⚠ WAŻNE: {txt}", st["warn"])]], colWidths=[174 * mm])
                p.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), RED_BG),
                    ("BOX", (0, 0), (-1, -1), 0.6, RED),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(p)
                story.append(Spacer(1, 3))
            else:
                story.append(Paragraph(f"• {txt}", st["body"]))

    # --- Checklista zadań
    if checklist:
        story.append(Paragraph("Zadania (checklista)", st["h2"]))
        for item in checklist:
            mark = "☑" if item.get("done") else "☐"
            line = f"{mark}  {item.get('title') or ''}"
            if item.get("done") and item.get("done_by_name"):
                line += f"  <font color='#5A6B5F' size='8'>({item['done_by_name']})</font>"
            story.append(Paragraph(line, st["body"]))

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        f"Biesiada pod Lasem · dokument wewnętrzny · wygenerowano {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        st["muted"],
    ))

    doc.build(story)
    return buf.getvalue()
