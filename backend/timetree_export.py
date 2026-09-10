"""Isolated, noninteractive adapter for timetree-exporter 0.8.0.

No stdout/stderr, raw HTTP dumps, credentials on argv, or persistent ICS files.
Uses the exporter's authentication, pagination and ICS formatter.
"""
import logging
import os
import sys
from pathlib import Path


def export_to(path):
    # The upstream library logs response bodies on failed authentication.
    logging.disable(logging.CRITICAL)
    import requests
    from timetree_exporter.api.auth import login, AuthenticationError
    from timetree_exporter.api.calendar import TimeTreeCalendar
    from timetree_exporter.event import TimeTreeEventType, TimeTreeEventCategory
    from timetree_exporter.exporter import build_single_calendar
    from timetree_exporter.utils import add_bounded_timezones_before_events

    email = os.environ['TIMETREE_EMAIL']
    password = os.environ['TIMETREE_PASSWORD']
    code = os.environ['TIMETREE_CALENDAR_ID']
    try:
        session = login(email, password)
    except AuthenticationError:
        return 10
    except requests.RequestException:
        return 12
    if not session:
        return 10
    api = TimeTreeCalendar(session, capture_raw_responses=False)
    original_request = api.session.request
    seen_pages = set()

    def strict_request(method, url, **kwargs):
        kwargs['timeout'] = (10, 30)
        response = original_request(method, url, **kwargs)
        response.raise_for_status()
        if '/events/sync' in url:
            payload = response.json()
            if (not isinstance(payload.get('events'), list)
                    or not isinstance(payload.get('chunk'), bool)):
                raise ValueError('Incomplete snapshot')
            if payload['chunk']:
                cursor = payload.get('since')
                if cursor is None or str(cursor) in seen_pages:
                    raise ValueError('Invalid pagination')
                seen_pages.add(str(cursor))
        return response

    api.session.request = strict_request
    try:
        matches = [m for m in api.get_metadata()
                   if m.get('alias_code') == code and not m.get('deactivated_at')]
        if len(matches) != 1:
            return 11
        metadata = matches[0]
        # Explicit since=0 is a full snapshot, never an incremental delta.
        raw = api.get_events_recur(metadata['id'], 0)
        active = [e for e in raw if not e.get('deactivated_at')
                  and e.get('type') != TimeTreeEventType.BIRTHDAY
                  and e.get('category') != TimeTreeEventCategory.MEMO]
        if any(not e.get('uuid') for e in active):
            return 13
        cal = build_single_calendar(active, {})
        if len(cal.walk('VEVENT')) != len(active):
            return 13
        cal.add('x-wr-calname', metadata.get('name') or 'TimeTree')
        cal.add('x-biesiada-complete', 'TRUE')
        add_bounded_timezones_before_events(cal)
        content = cal.to_ical()
        if len(content) > 10 * 1024 * 1024:
            return 13
        Path(path).write_bytes(content)
        return 0
    except requests.RequestException:
        return 12
    finally:
        api.session.close()


if __name__ == '__main__':
    try:
        result = export_to(sys.argv[1])
    except Exception:
        result = 13
    sys.exit(result)
