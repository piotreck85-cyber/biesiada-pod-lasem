"""Iteration 19: strict contract checks for pre-event email content and attachments."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
import os
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pre_event_email as module

os.environ.setdefault("SMTP_USER", "dry-run@example.com")


# Module: pre-event email copy and attachment contract
EXPECTED_SUBJECT = "Do zobaczenia za 2 dni – Biesiada pod Lasem 🌲"
EXPECTED_BODY = """Dzień dobry,

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


def _event(category: str, status: str = "potwierdzona", include_prev_status: bool = False) -> dict:
    payload = {
        "id": "TEST_ITER19_EVENT",
        "owner_id": "TEST_OWNER",
        "name": "TEST Event",
        "date": "2026-09-10",
        "time_start": "18:00",
        "status": status,
        "category": category,
        "client_email": "test-iter19@example.com",
    }
    if include_prev_status:
        payload["pre_event_email_status"] = "scheduled"
    return payload


def test_subject_is_exact_contract_value():
    assert module.EMAIL_SUBJECT == EXPECTED_SUBJECT
    assert module.subject_for_event(_event("dorosli/firmowe")) == EXPECTED_SUBJECT


def test_body_is_exact_contract_value_without_legacy_date_text():
    assert module.EMAIL_BODY == EXPECTED_BODY
    assert "48" not in module.EMAIL_BODY
    assert "dd.mm.rrrr" not in module.EMAIL_BODY.lower()
    assert "{{" not in module.EMAIL_BODY


@pytest.mark.parametrize(
    "category,expected",
    [
        ("dzieci/urodzinki/standard", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
        ("warsztaty/przyrodnicze", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
        ("dzieci/wycieczki", "Regulamin_Biesiada_pod_Lasem_DZIECI.pdf"),
        ("dorosli/okolicznosciowe", "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"),
        ("dorosli/firmowe", "Regulamin_Biesiada_pod_Lasem_DOROSLI.pdf"),
    ],
)
def test_dry_run_has_exactly_one_regulation_plus_map(category: str, expected: str):
    result = asyncio.run(module.send_event_email(None, _event(category), dry_run=True))
    assert result["attachments"] == [expected, "kolorowa_mapa_atrakcji_pod_lasem.png"]


def test_schedule_patch_confirms_confirmed_only_and_exact_48h():
    now = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    patch_ok = module.schedule_patch(_event("dorosli/firmowe", status="potwierdzona"), now)
    assert patch_ok["pre_event_email_status"] == "scheduled"
    assert patch_ok["pre_event_email_scheduled_at"] == datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc).isoformat()

    patch_not_ok = module.schedule_patch(_event("dorosli/firmowe", status="rezerwacja", include_prev_status=False), now)
    assert patch_not_ok["pre_event_email_status"] == "not_scheduled"


def test_map_file_exists_with_png_signature_and_exact_filename():
    assert module.ATTRACTIONS_MAP.name == "kolorowa_mapa_atrakcji_pod_lasem.png"
    assert module.ATTRACTIONS_MAP.is_file()
    signature = module.ATTRACTIONS_MAP.read_bytes()[:8]
    assert signature == b"\x89PNG\r\n\x1a\n"
