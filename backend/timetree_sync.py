"""One-way, workspace-scoped TimeTree synchronization for MongoDB (also standalone).

All fetch/parse/preflight work precedes event writes. Only explicit calendar fields
are patched. Event changes and their audit outbox are one atomic MongoDB write;
outbox delivery is idempotent. A database lease serializes manual/scheduled imports.
"""
import asyncio
import hashlib
import logging
import os
import sys
import tempfile
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from icalendar import Calendar
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

log = logging.getLogger(__name__)
FIELDS = ('name', 'date', 'time_start', 'time_end', 'end_date', 'notes', 'venue', 'all_day')
LABELS = dict(zip(FIELDS, ('nazwa wydarzenia', 'data', 'godzina rozpoczęcia',
    'godzina zakończenia', 'data zakończenia', 'opis/notatka', 'lokalizacja', 'cały dzień')))
MAX_BYTES = 10 * 1024 * 1024
MAX_EVENTS = 20000
INTERVAL_SECONDS = 3600
LEASE_SECONDS = 900
RESERVED = {'external_source', 'external_id', 'external_last_modified', 'last_synced_at',
            'missing_in_timetree', 'imported_uid', 'owner_id', 'id', '_id', 'created_at',
            'created_by_id', 'created_by_name'}
MESSAGES = {
    'configuration': 'Nie skonfigurowano integracji TimeTree w zmiennych środowiskowych backendu.',
    'auth': 'TimeTree: logowanie nie powiodło się. Sprawdź dane logowania lub spróbuj później.',
    'calendar': 'TimeTree: nie znaleziono skonfigurowanego kalendarza na tym koncie.',
    'fetch': 'TimeTree jest niedostępne lub przekroczono czas pobierania. Wydarzenia pozostają bez zmian.',
    'invalid': 'Eksport ICS jest niepełny, nieprawidłowy lub zawiera niejednoznaczne UID. Nie zmieniono wydarzeń.',
    'duplicates': 'W bazie są powtórzone identyfikatory importu. Wymagają sprawdzenia przed synchronizacją; niczego nie usunięto.',
    'busy': 'Synchronizacja już trwa. Odśwież jej status za chwilę.',
    'database': 'Nie udało się zakończyć zapisu synchronizacji. Sprawdź bazę i ponów próbę; zapisane UID nie zostaną zduplikowane.',
}


class SyncError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(MESSAGES[code])


def now():
    return datetime.now(timezone.utc)


def configured(owner_id):
    return bool(owner_id and os.getenv('TIMETREE_OWNER_ID') == owner_id
                and all(os.getenv(k) for k in ('TIMETREE_EMAIL', 'TIMETREE_PASSWORD', 'TIMETREE_CALENDAR_ID')))


def use_worker():
    return os.getenv('TIMETREE_USE_WORKER', 'false').lower() == 'true'


def panel_configured(owner_id):
    if use_worker():
        return bool(owner_id and os.getenv('TIMETREE_OWNER_ID') == owner_id and os.getenv('TIMETREE_CALENDAR_ID'))
    return configured(owner_id)


def calendar_key():
    # The calendar ID itself is never persisted or returned to a browser.
    return hashlib.sha256(os.environ['TIMETREE_CALENDAR_ID'].encode()).hexdigest()


def sanitize_manual(updates):
    return {k: v for k, v in updates.items()
            if k not in RESERVED and not k.startswith('timetree_') and '.' not in k and not k.startswith('$')}


def manual_patch(prev, updates):
    """Track edits even if a user later reverts a value to the remote value."""
    patch = sanitize_manual(updates)
    if prev.get('external_source') == 'timetree':
        manual = set(prev.get('timetree_manual_fields', []))
        manual.update(k for k in FIELDS if k in patch and patch[k] != prev.get(k))
        patch['timetree_manual_fields'] = sorted(manual)
    return patch


def revision_filter(prev):
    return {'timetree_revision': prev['timetree_revision']} if 'timetree_revision' in prev else {'timetree_revision': {'$exists': False}}


async def ensure_indexes(db):
    """Idempotent migration: no deletion, merging, or blind legacy reclassification."""
    for field, condition in [
        ('external_id', {'external_source': 'timetree', 'external_id': {'$type': 'string'}}),
        ('imported_uid', {'imported_uid': {'$type': 'string'}}),
    ]:
        duplicates = await db.events.aggregate([
            {'$match': condition},
            {'$group': {'_id': {'owner': '$owner_id', 'uid': '$' + field}, 'n': {'$sum': 1}}},
            {'$match': {'n': {'$gt': 1}}}, {'$limit': 1},
        ]).to_list(1)
        if duplicates:
            raise SyncError('duplicates')
    await db.events.create_index([('owner_id', 1), ('external_source', 1), ('external_id', 1)],
        name='timetree_uid_unique', unique=True,
        partialFilterExpression={'external_source': 'timetree', 'external_id': {'$type': 'string'}})
    # Also serializes the old manual ICS importer against automatic sync.
    await db.events.create_index([('owner_id', 1), ('imported_uid', 1)],
        name='imported_uid_unique', unique=True, partialFilterExpression={'imported_uid': {'$type': 'string'}})
    await db.timetree_runs.create_index([('owner_id', 1), ('started_at', -1)])
    await db.events.create_index([('owner_id', 1), ('missing_in_timetree', 1)])


def parse_snapshot(content):
    try:
        if not isinstance(content, bytes) or len(content) > MAX_BYTES:
            raise ValueError()
        text = content.decode('utf-8-sig').strip()
        if not text.startswith('BEGIN:VCALENDAR') or not text.endswith('END:VCALENDAR'):
            raise ValueError()
        cal = Calendar.from_ical(text)
        if cal.name != 'VCALENDAR' or str(cal.get('X-BIESIADA-COMPLETE', '')).upper() != 'TRUE':
            raise ValueError()
        if any(c.errors for c in cal.walk()):
            raise ValueError()
        components = cal.walk('VEVENT')
        if len(components) > MAX_EVENTS:
            raise ValueError()
        rows = {}
        warsaw = ZoneInfo('Europe/Warsaw')

        def dt(component, key, optional=False):
            value = component.get(key)
            if value is None and optional:
                return None
            if value is None or isinstance(value, list):
                raise ValueError()
            decoded = component.decoded(key)
            if not isinstance(decoded, (date, datetime)):
                raise ValueError()
            if isinstance(decoded, datetime):
                # Floating times use the application's zone; unknown TZID is rejected.
                if value.params.get('TZID') and decoded.tzinfo is None:
                    raise ValueError()
                if decoded.tzinfo is None:
                    decoded = decoded.replace(tzinfo=warsaw)
                decoded = decoded.astimezone(warsaw)
            return decoded

        for component in components:
            uid = component.get('UID')
            if uid is None or isinstance(uid, list) or not str(uid).strip() or len(str(uid)) > 1000:
                raise ValueError()
            uid = str(uid)  # Exact case-sensitive UID, never a title/date hash.
            start = dt(component, 'DTSTART')
            end = dt(component, 'DTEND', True)
            all_day = not isinstance(start, datetime)
            if component.get('DURATION'):
                if end is not None:
                    raise ValueError()
                end = start + component.decoded('DURATION')
            if end is not None and (isinstance(end, datetime) != isinstance(start, datetime) or end < start):
                raise ValueError()
            modified = dt(component, 'LAST-MODIFIED', True)
            if modified is not None and not isinstance(modified, datetime):
                raise ValueError()
            data = {
                'name': str(component.get('SUMMARY', '')) or 'Wydarzenie TimeTree',
                'date': start.isoformat()[:10],
                'time_start': '' if all_day else start.strftime('%H:%M'),
                'time_end': '' if all_day or end is None else end.strftime('%H:%M'),
                'end_date': (end.isoformat()[:10] if end is not None else start.isoformat()[:10]),
                'notes': str(component.get('DESCRIPTION', '')),
                'venue': str(component.get('LOCATION', '')),
                'all_day': all_day,
            }
            if len(data['name']) > 1000 or len(data['notes']) > 100000 or len(data['venue']) > 5000:
                raise ValueError()
            if any(isinstance(component.get(k), list) for k in ('SUMMARY', 'DESCRIPTION', 'LOCATION')):
                raise ValueError()
            # Preserve series rules without inventing new UIDs or unbounded occurrences.
            recurrence = {k: component[k].to_ical().decode() for k in ('RRULE', 'RECURRENCE-ID', 'RDATE', 'EXDATE') if k in component}
            row = {'uid': uid, 'data': data, 'last_modified': modified.astimezone(timezone.utc).isoformat() if modified else None,
                   'recurrence': recurrence}
            if uid in rows and rows[uid] != row:
                raise ValueError()  # Never silently pick one of conflicting UID definitions.
            rows[uid] = row
        return {'name': str(cal.get('X-WR-CALNAME', 'TimeTree'))[:300], 'events': list(rows.values()),
                'fetched': len(components), 'duplicate_rows': len(components) - len(rows)}
    except Exception:
        raise SyncError('invalid') from None


async def fetch_ics():
    child_env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'SSL_CERT_FILE', 'SSL_CERT_DIR') if k in os.environ}
    child_env.update({k: os.environ[k] for k in ('TIMETREE_EMAIL', 'TIMETREE_PASSWORD', 'TIMETREE_CALENDAR_ID')})
    with tempfile.TemporaryDirectory(prefix='biesiada-timetree-') as directory:
        output = Path(directory) / 'calendar.ics'
        proc = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).with_name('timetree_export.py')),
            str(output), env=child_env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, cwd=directory)
        try:
            code = await asyncio.wait_for(proc.wait(), timeout=180)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            raise SyncError('fetch') from None
        if code:
            raise SyncError({10: 'auth', 11: 'calendar', 12: 'fetch'}.get(code, 'invalid'))
        if not output.is_file() or output.stat().st_size > MAX_BYTES:
            raise SyncError('invalid')
        return output.read_bytes()


async def acquire_lock(db, owner_id, trigger):
    stamp = now()
    token = str(uuid.uuid4())
    query = {'_id': owner_id, '$or': [{'expires_at': {'$lt': stamp}}, {'expires_at': {'$exists': False}}]}
    if trigger == 'scheduled':
        query['$and'] = [{'$or': [{'next_attempt_at': {'$lte': stamp}}, {'next_attempt_at': {'$exists': False}}]}]
    try:
        lock = await db.timetree_locks.find_one_and_update(query, {'$set': {'token': token,
            'expires_at': stamp + timedelta(seconds=LEASE_SECONDS), 'next_attempt_at': stamp + timedelta(seconds=INTERVAL_SECONDS - 5)}},
            upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        raise SyncError('busy') from None
    return lock['token']


async def assert_lock(db, owner_id, token):
    if not await db.timetree_locks.find_one({'_id': owner_id, 'token': token, 'expires_at': {'$gt': now()}}):
        raise SyncError('busy')


def audit(owner_id, event_id, at, summary, field=None, old=None, new=None):
    item = {'id': str(uuid.uuid4()), 'owner_id': owner_id, 'user_id': 'system / TimeTree',
            'user_name': 'system / TimeTree', 'action': 'update', 'entity_type': 'event',
            'entity_id': event_id, 'summary': summary, 'at': at}
    if field:
        item.update(kind='field', field=field, field_label=LABELS.get(field, field), old=old, new=new)
    return item


async def flush_audit(db, owner_id):
    async for doc in db.events.find({'owner_id': owner_id, 'timetree_outbox.0': {'$exists': True}}):
        for entry in doc['timetree_outbox']:
            # _id is unique without a migration of unrelated legacy audit records.
            await db.audit_log.update_one({'_id': 'timetree:' + entry['id']}, {'$setOnInsert': entry}, upsert=True)
            await db.events.update_one({'_id': doc['_id']}, {'$pull': {'timetree_outbox': {'id': entry['id']}}})


def change_summary(field, old, new, manual=False):
    if manual:
        return f'TimeTree: zmieniono {LABELS[field]} w źródle; zachowano wartość wpisaną ręcznie w Biesiadzie'
    if field in ('time_start', 'time_end'):
        return f'TimeTree: zmieniono {LABELS[field]} z {old or "—"} na {new or "—"}'
    return f'TimeTree: zmieniono {LABELS[field]}'


def plan_update(prev, row, owner_id, fingerprint, stamp):
    source = prev.get('timetree_source', {})
    adopting = prev.get('external_source') != 'timetree'
    manual = set(prev.get('timetree_manual_fields', []))
    patch = {}
    entries = []
    for field in FIELDS:
        remote = row['data'][field]
        # Three-way comparison also protects writes from old clients/other backend paths.
        if (adopting and prev.get(field, '') != remote) or (not adopting and prev.get(field) != source.get(field)):
            manual.add(field)
        if field not in manual and prev.get(field) != remote:
            patch[field] = remote
        if not adopting and source.get(field) != remote:
            entries.append(audit(owner_id, prev['id'], stamp,
                change_summary(field, source.get(field), remote, field in manual), field, source.get(field), remote))
    if adopting:
        entries.append(audit(owner_id, prev['id'], stamp, 'Import z TimeTree: powiązano wcześniej zaimportowane wydarzenie; zachowano dane Biesiady'))
    if prev.get('missing_in_timetree'):
        entries.append(audit(owner_id, prev['id'], stamp, 'TimeTree: wydarzenie ponownie występuje w kalendarzu'))
    metadata = {'external_source': 'timetree', 'external_id': row['uid'], 'imported_uid': row['uid'],
        'external_last_modified': row['last_modified'], 'timetree_source': row['data'],
        'timetree_recurrence': row['recurrence'], 'timetree_manual_fields': sorted(manual),
        'timetree_calendar_key': fingerprint, 'missing_in_timetree': False}
    patch.update({k: v for k, v in metadata.items() if prev.get(k) != v})
    if not patch:
        return {}, []
    if not entries:
        entries.append(audit(owner_id, prev['id'], stamp, 'TimeTree: zaktualizowano metadane synchronizacji'))
    patch['last_synced_at'] = stamp
    if 'time_start' in patch:
        patch['time'] = patch['time_start']
    return patch, entries


async def apply_row(db, owner_id, row, fingerprint, stamp, token):
    for _ in range(5):
        await assert_lock(db, owner_id, token)
        query = {'owner_id': owner_id, '$or': [
            {'external_source': 'timetree', 'external_id': row['uid']}, {'imported_uid': row['uid']}]}
        matches = await db.events.find(query).to_list(3)
        if len(matches) > 1:
            raise SyncError('duplicates')
        if not matches:
            event_id = str(uuid.uuid4())
            entry = audit(owner_id, event_id, stamp, 'Import z TimeTree')
            entry['action'] = 'create'
            doc = {**row['data'], 'id': event_id, 'owner_id': owner_id,
                'created_by_id': 'system / TimeTree', 'created_by_name': 'system / TimeTree',
                'created_at': stamp, 'time': row['data']['time_start'], 'category': '', 'people': 0,
                'revenue': 0.0, 'costs': [], 'shifts': [], 'image_url': '', 'status': '',
                'external_source': 'timetree', 'external_id': row['uid'], 'imported_uid': row['uid'],
                'external_last_modified': row['last_modified'], 'last_synced_at': stamp,
                'missing_in_timetree': False, 'timetree_source': row['data'],
                'timetree_recurrence': row['recurrence'], 'timetree_manual_fields': [],
                'timetree_calendar_key': fingerprint, 'timetree_revision': 1, 'timetree_outbox': [entry]}
            try:
                await db.events.insert_one(doc)
                return 'added'
            except DuplicateKeyError:
                continue
        prev = matches[0]
        if prev.get('external_source') not in (None, '', 'timetree'):
            raise SyncError('duplicates')
        patch, entries = plan_update(prev, row, owner_id, fingerprint, stamp)
        if not patch:
            return 'unchanged'
        # CAS over all relevant local fields protects manual writers without revisions too.
        cas = {'_id': prev['_id'], **revision_filter(prev)}
        cas.update({k: prev[k] if k in prev else {'$exists': False} for k in FIELDS})
        result = await db.events.update_one(cas, {'$set': patch, '$inc': {'timetree_revision': 1},
                                                '$push': {'timetree_outbox': {'$each': entries}}})
        if result.matched_count:
            return 'updated'
    raise SyncError('database')


async def run_sync(db, owner_id, trigger='manual', fetcher=None):
    if not configured(owner_id):
        raise SyncError('configuration')
    owner = await db.users.find_one({'id': owner_id})
    if not owner or owner.get('role') == 'staff' or owner_id != (owner.get('workspace_id') or owner_id):
        raise SyncError('configuration')
    token = await acquire_lock(db, owner_id, trigger)
    run_id = str(uuid.uuid4())
    stamp = now().isoformat()
    run = {'_id': run_id, 'id': run_id, 'owner_id': owner_id, 'started_at': stamp,
           'trigger': trigger, 'status': 'running', 'fetched': 0, 'added': 0, 'updated': 0,
           'unchanged': 0, 'skipped': 0, 'errors': 0, 'missing': 0}
    fingerprint = calendar_key()
    try:
        # Interrupted runs are visible, and may safely be retried.
        await db.timetree_runs.update_many({'owner_id': owner_id, 'status': 'running'}, {'$set': {
            'status': 'error', 'error': 'Poprzednia synchronizacja została przerwana. Można ponowić próbę.', 'errors': 1}})
        await db.timetree_runs.insert_one(run.copy())
        await db.timetree_status.update_one({'_id': owner_id}, {'$set': {'last_attempt_at': stamp, 'running': True}}, upsert=True)
        await ensure_indexes(db)
        content = await (fetcher or fetch_ics)()
        snapshot = parse_snapshot(content)
        run['fetched'] = snapshot['fetched']
        run['skipped'] = snapshot['duplicate_rows']
        # Preflight every UID before any writes; don't partially adopt ambiguous legacy data.
        for row in snapshot['events']:
            matches = await db.events.find({'owner_id': owner_id, '$or': [
                {'external_source': 'timetree', 'external_id': row['uid']}, {'imported_uid': row['uid']}]}).to_list(3)
            if len(matches) > 1 or any(d.get('external_source') not in (None, '', 'timetree') for d in matches):
                raise SyncError('duplicates')
        await assert_lock(db, owner_id, token)
        await flush_audit(db, owner_id)
        for row in snapshot['events']:
            result = await apply_row(db, owner_id, row, fingerprint, stamp, token)
            run[result] += 1
        uids = {r['uid'] for r in snapshot['events']}
        # Only this configured calendar, and only after a verified complete snapshot.
        async for prev in db.events.find({'owner_id': owner_id, 'external_source': 'timetree',
                'timetree_calendar_key': fingerprint, 'missing_in_timetree': {'$ne': True}}):
            if prev['external_id'] in uids:
                continue
            await assert_lock(db, owner_id, token)
            entry = audit(owner_id, prev['id'], stamp, 'TimeTree: wydarzenie nie występuje już w kalendarzu')
            result = await db.events.update_one({'_id': prev['_id'], **revision_filter(prev), 'missing_in_timetree': {'$ne': True}}, {
                '$set': {'missing_in_timetree': True, 'last_synced_at': stamp},
                '$inc': {'timetree_revision': 1}, '$push': {'timetree_outbox': entry}})
            run['missing'] += result.modified_count
        await flush_audit(db, owner_id)
        run.update(status='success', finished_at=now().isoformat())
        await assert_lock(db, owner_id, token)
        await db.timetree_status.update_one({'_id': owner_id}, {'$set': {
            'last_success_at': run['finished_at'], 'calendar_name': snapshot['name'],
            'calendar_key': fingerprint, 'error': None}})
    except (Exception, asyncio.CancelledError) as exc:
        code = exc.code if isinstance(exc, SyncError) else 'database'
        run.update(status='error', error=MESSAGES[code], errors=1, finished_at=now().isoformat())
        log.warning('TimeTree synchronization failed (%s)', code)  # Never raw exception text/traceback.
        if await db.timetree_locks.find_one({'_id': owner_id, 'token': token}):
            await db.timetree_status.update_one({'_id': owner_id}, {'$set': {'error': MESSAGES[code]}}, upsert=True)
    finally:
        try:
            await db.timetree_runs.update_one({'_id': run_id}, {'$set': {k: v for k, v in run.items() if k != '_id'}}, upsert=True)
            if await db.timetree_locks.find_one({'_id': owner_id, 'token': token}):
                await db.timetree_status.update_one({'_id': owner_id}, {'$set': {'running': False}})
        finally:
            await db.timetree_locks.update_one({'_id': owner_id, 'token': token}, {'$unset': {'expires_at': '', 'token': ''}})
    return {k: v for k, v in run.items() if k not in ('_id', 'owner_id')}


async def scheduled_sync(db):
    owner_id = os.getenv('TIMETREE_OWNER_ID', '')
    if not configured(owner_id):
        return
    try:
        await run_sync(db, owner_id, 'scheduled')
    except SyncError as exc:
        if exc.code != 'busy':
            log.warning('TimeTree scheduled synchronization failed (%s)', exc.code)
    except Exception:
        log.warning('TimeTree scheduled synchronization failed (database)')


async def status(db, owner_id):
    state = await db.timetree_status.find_one({'_id': owner_id}) or {}
    history = await db.timetree_runs.find({'owner_id': owner_id}, {'_id': 0, 'owner_id': 0}).sort('started_at', -1).to_list(30)
    lock = await db.timetree_locks.find_one({'_id': owner_id, 'expires_at': {'$gt': now()}})
    ready = panel_configured(owner_id)
    request = await db.timetree_requests.find_one({'_id': owner_id}) if use_worker() else None
    heartbeat = state.get('worker_seen_at')
    worker_running = bool(heartbeat and datetime.fromisoformat(heartbeat) > now() - timedelta(seconds=90))
    current_calendar = ready and state.get('calendar_key') == calendar_key()
    return {'status': 'Niepołączono' if not ready else 'Błąd' if state.get('error') else 'Połączono' if current_calendar and state.get('last_success_at') else 'Niepołączono',
        'configured': ready, 'calendar_name': state.get('calendar_name') if current_calendar else None,
        'last_success_at': state.get('last_success_at') if current_calendar else None,
        'last_attempt_at': state.get('last_attempt_at'), 'error': state.get('error') if ready else MESSAGES['configuration'],
        'running': bool(lock), 'queued': bool(request), 'use_worker': use_worker(),
        'worker_running': worker_running, 'worker_seen_at': heartbeat, 'interval_seconds': INTERVAL_SECONDS, 'history': history,
        'last_run': history[0] if history else None}
