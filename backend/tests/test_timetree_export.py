"""Adapter contract tests use the installed real exporter, with HTTP mocked."""
import json
import logging
import sys
from pathlib import Path
import pytest
import requests
from icalendar import Calendar
from timetree_exporter.api import auth
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from timetree_export import export_to


def raw(uid):
    return {'uuid': uid, 'title': 'Spotkanie', 'created_at': 1789000000000, 'updated_at': 1789000000000,
            'start_at': 1789000000000, 'end_at': 1789003600000, 'start_timezone': 'Europe/Warsaw',
            'end_timezone': 'Europe/Warsaw', 'all_day': False, 'note': 'Opis', 'location': 'Sala',
            'url': '', 'alerts': [], 'recurrences': [], 'type': 0, 'category': 1}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for key, value in [('TIMETREE_EMAIL', 'fake@example.invalid'), ('TIMETREE_PASSWORD', 'fake-pass'), ('TIMETREE_CALENDAR_ID', 'chosen')]:
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(auth, 'login', lambda email, password: 'fake-session')
    yield
    logging.disable(logging.NOTSET)


def mock_http(monkeypatch, pages, code='chosen'):
    calls = []
    def request(session, method, url, **kwargs):
        calls.append((url, kwargs.get('timeout')))
        if '/calendars?' in url:
            payload, status = {'calendars': [{'id': 99, 'alias_code': code, 'name': 'Mój kalendarz', 'deactivated_at': None}]}, 200
        else:
            status, payload = pages.pop(0)
        response = requests.Response()
        response.status_code = status
        response._content = json.dumps(payload).encode()
        return response
    monkeypatch.setattr(requests.Session, 'request', request)
    return calls


def test_complete_pagination_and_upstream_formatter(monkeypatch, tmp_path):
    calls = mock_http(monkeypatch, [(200, {'events': [raw('one')], 'chunk': True, 'since': 12}),
                                   (200, {'events': [raw('two')], 'chunk': False})])
    file = tmp_path / 'calendar.ics'
    assert export_to(file) == 0
    cal = Calendar.from_ical(file.read_bytes())
    assert [str(e['UID']) for e in cal.walk('VEVENT')] == ['one', 'two']
    assert str(cal['X-WR-CALNAME']) == 'Mój kalendarz'
    assert str(cal['X-BIESIADA-COMPLETE']) == 'TRUE'
    assert '/events/sync?since=0' in calls[1][0]
    assert all(timeout == (10, 30) for _, timeout in calls)


def test_second_page_http_error_never_writes_partial_file(monkeypatch, tmp_path):
    mock_http(monkeypatch, [(200, {'events': [raw('one')], 'chunk': True, 'since': 12}),
                           (503, {'events': [], 'chunk': False})])
    file = tmp_path / 'calendar.ics'
    assert export_to(file) == 12 and not file.exists()


def test_wrong_calendar_does_not_fall_back_to_first(monkeypatch, tmp_path):
    mock_http(monkeypatch, [], code='different')
    file = tmp_path / 'calendar.ics'
    assert export_to(file) == 11 and not file.exists()


def test_incomplete_snapshot_never_written(monkeypatch, tmp_path):
    mock_http(monkeypatch, [(200, {'events': [raw('one')]})])
    file = tmp_path / 'calendar.ics'
    with pytest.raises(ValueError): export_to(file)
    assert not file.exists()


def test_deactivated_events_excluded_from_complete_export(monkeypatch, tmp_path):
    mock_http(monkeypatch, [(200, {'events': [raw('one'), dict(raw('removed'), deactivated_at=1)], 'chunk': False})])
    file = tmp_path / 'calendar.ics'
    assert export_to(file) == 0
    assert len(Calendar.from_ical(file.read_bytes()).walk('VEVENT')) == 1


def test_authentication_failure_is_safe_code(monkeypatch, tmp_path):
    def failure(email, password): raise auth.InvalidCredentialsError(password)
    monkeypatch.setattr(auth, 'login', failure)
    file = tmp_path / 'calendar.ics'
    assert export_to(file) == 10 and not file.exists()
