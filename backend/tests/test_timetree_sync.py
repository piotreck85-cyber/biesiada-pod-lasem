"""Run: pytest tests/test_timetree_sync.py (no TimeTree credentials/network needed).
Set TIMETREE_TEST_MONGO_URL to run against an isolated real MongoDB instead of mock.
"""
import asyncio
import copy
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient, ASGITransport
from motor.motor_asyncio import AsyncIOMotorClient
from mongomock_motor import AsyncMongoMockClient
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import timetree_sync as tt
from timetree_api import routes

pytestmark = pytest.mark.asyncio


def event(uid='one', title='Przyjęcie', start='20260910T090000Z', end='20260910T100000Z', extra=''):
    return f'BEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:{title}\r\nDTSTART:{start}\r\nDTEND:{end}\r\nDESCRIPTION:Notatka\\nDruga linia\r\nLOCATION:Sala\r\n{extra}END:VEVENT\r\n'


def calendar(*events):
    return ('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tests//PL\r\nX-WR-CALNAME:Kalendarz testowy\r\nX-BIESIADA-COMPLETE:TRUE\r\n' + ''.join(events) + 'END:VCALENDAR\r\n').encode()


@pytest_asyncio.fixture
async def db(monkeypatch):
    for key, value in [('TIMETREE_OWNER_ID', 'owner'), ('TIMETREE_CALENDAR_ID', 'test-calendar'),
                       ('TIMETREE_EMAIL', 'test@example.invalid'), ('TIMETREE_PASSWORD', 'not-a-real-password')]:
        monkeypatch.setenv(key, value)
    uri = os.getenv('TIMETREE_TEST_MONGO_URL')
    client = AsyncIOMotorClient(uri) if uri else AsyncMongoMockClient()
    name = 'timetree_test_' + uuid.uuid4().hex
    database = client[name]
    await database.users.insert_one({'id': 'owner', 'role': 'admin'})
    yield database
    await client.drop_database(name)
    client.close()


async def sync(db, content, trigger='manual'):
    return await tt.run_sync(db, 'owner', trigger, fetcher=AsyncMock(return_value=content))


async def test_first_import_repeat_identical_no_event_or_audit_writes(db):
    data = calendar(event())
    result = await sync(db, data)
    assert (result['added'], result['updated'], result['errors']) == (1, 0, 0)
    before = await db.events.find_one({'owner_id': 'owner'})
    assert before['time_start'] == '11:00' and before['time_end'] == '12:00'
    assert before['external_source'] == 'timetree' and before['external_id'] == 'one'
    assert before['notes'] == 'Notatka\nDruga linia'
    assert before['timetree_outbox'] == []
    logs = await db.audit_log.find({}).to_list(None)
    for _ in range(3):
        result = await sync(db, data)
        assert result['unchanged'] == 1 and result['added'] == 0 and result['updated'] == 0
        assert await db.events.find_one({'owner_id': 'owner'}) == before
        assert await db.audit_log.find({}).to_list(None) == logs
    assert await db.events.count_documents({}) == 1
    assert await db.timetree_runs.count_documents({}) == 4


async def test_changed_source_preserves_business_data_and_has_audit(db):
    await sync(db, calendar(event()))
    extras = {'client_name': 'Klient', 'price_total': 4500, 'deposit_amount': 500,
              'costs': [{'label': 'Transport', 'amount': 90}], 'shifts': [{'staff_id': 'staff', 'hours': 8}],
              'dinner_items': {'soup': 20}, 'category': 'wesele', 'checklist_initialized': True,
              'automation_settings': {'enabled': True}, 'org': {'custom': 'value'}}
    await db.events.update_one({'external_id': 'one'}, {'$set': extras})
    result = await sync(db, calendar(event(title='Nowa nazwa', start='20260910T100000Z', end='20260910T110000Z')))
    assert result['updated'] == 1
    doc = await db.events.find_one({'external_id': 'one'})
    assert doc['time_start'] == '12:00' and doc['name'] == 'Nowa nazwa'
    assert all(doc[k] == value for k, value in extras.items())
    logs = await db.audit_log.find({}).to_list(None)
    assert all(x['user_name'] == 'system / TimeTree' for x in logs)
    assert any('z 11:00 na 12:00' in x.get('summary', '') for x in logs)


async def test_manual_changes_protected_even_if_legacy_writer_did_not_mark_them(db):
    await sync(db, calendar(event()))
    await db.events.update_one({'external_id': 'one'}, {'$set': {'name': 'Własna nazwa', 'notes': 'Prywatne', 'time_start': '14:00'}})
    result = await sync(db, calendar(event(title='Nowa nazwa')))
    assert result['updated'] == 1
    doc = await db.events.find_one({'external_id': 'one'})
    assert (doc['name'], doc['notes'], doc['time_start']) == ('Własna nazwa', 'Prywatne', '14:00')
    assert doc['timetree_source']['name'] == 'Nowa nazwa'
    assert {'name', 'notes', 'time_start'} <= set(doc['timetree_manual_fields'])
    assert any('zachowano' in x.get('summary', '') for x in await db.audit_log.find({}).to_list(None))
    before = copy.deepcopy(doc)
    result = await sync(db, calendar(event(title='Nowa nazwa')))
    assert result['unchanged'] == 1 and await db.events.find_one({'external_id': 'one'}) == before


async def test_legacy_uid_adopted_no_overwrite_no_duplicate(db):
    old = {'id': 'legacy', 'owner_id': 'owner', 'imported_uid': 'one', 'name': 'Rozbudowana impreza',
           'date': '2026-09-11', 'notes': 'Ustalenia', 'price_total': 7000}
    await db.events.insert_one(old.copy())
    result = await sync(db, calendar(event()))
    assert result['added'] == 0 and result['updated'] == 1
    doc = await db.events.find_one({'id': 'legacy'})
    assert all(doc[k] == v for k, v in old.items())
    assert doc['external_id'] == 'one' and doc['external_source'] == 'timetree'
    assert await db.events.count_documents({}) == 1


async def test_missing_marked_once_not_deleted_and_return_restores(db):
    await sync(db, calendar(event(), event('two')))
    result = await sync(db, calendar(event('two')))
    assert result['missing'] == 1 and await db.events.count_documents({}) == 2
    before = await db.events.find_one({'external_id': 'one'})
    assert before['missing_in_timetree'] is True
    logs_before = await db.audit_log.count_documents({})
    result = await sync(db, calendar(event('two')))
    assert result['missing'] == 0 and await db.audit_log.count_documents({}) == logs_before
    assert await db.events.find_one({'external_id': 'one'}) == before
    result = await sync(db, calendar(event(), event('two')))
    assert result['updated'] == 1 and not (await db.events.find_one({'external_id': 'one'}))['missing_in_timetree']


@pytest.mark.parametrize('code', ['auth', 'fetch', 'calendar'])
async def test_fetch_failure_never_changes_events_or_marks_missing(db, code):
    await sync(db, calendar(event()))
    before = await db.events.find({}).to_list(None)
    logs = await db.audit_log.find({}).to_list(None)
    result = await tt.run_sync(db, 'owner', fetcher=AsyncMock(side_effect=tt.SyncError(code)))
    assert result['status'] == 'error' and result['errors'] == 1
    assert await db.events.find({}).to_list(None) == before
    assert await db.audit_log.find({}).to_list(None) == logs
    state = await tt.status(db, 'owner')
    assert state['status'] == 'Błąd' and state['last_success_at'] and state['last_attempt_at']


@pytest.mark.parametrize('content', [b'<html>login</html>', calendar(event()).replace(b'END:VCALENDAR', b''),
    calendar(event()).replace(b'UID:one\r\n', b''), calendar(event(start='nonsense')),
    calendar(event(), event(title='Conflicting UID')), calendar(event()).replace(b'X-BIESIADA-COMPLETE:TRUE', b'X-BIESIADA-COMPLETE:FALSE'),
    calendar(event()).replace(b'DTSTART:20260910T090000Z', b'DTSTART;TZID=Unknown/Zone:20260910T090000')])
async def test_invalid_or_partial_snapshot_all_or_nothing(db, content):
    await sync(db, calendar(event('existing')))
    before = await db.events.find({}).to_list(None)
    result = await sync(db, content)
    assert result['status'] == 'error' and result['added'] == result['updated'] == result['missing'] == 0
    assert await db.events.find({}).to_list(None) == before


async def test_exact_duplicate_uid_in_one_file_and_case_sensitive_ids(db):
    result = await sync(db, calendar(event(), event(), event('ONE')))
    assert (result['fetched'], result['added'], result['skipped']) == (3, 2, 1)
    assert await db.events.count_documents({}) == 2


async def test_last_modified_ignored_dtstamp_and_timezone_all_day(db):
    first = calendar(event(extra='LAST-MODIFIED:20260901T110000Z\r\nDTSTAMP:20260901T110000Z\r\n'))
    await sync(db, first)
    result = await sync(db, first.replace(b'DTSTAMP:20260901T110000Z', b'DTSTAMP:20260902T120000Z'))
    assert result['unchanged'] == 1
    result = await sync(db, first.replace(b'LAST-MODIFIED:20260901T110000Z', b'LAST-MODIFIED:20260902T110000Z'))
    assert result['updated'] == 1
    assert (await db.events.find_one({'external_id': 'one'}))['external_last_modified'] == '2026-09-02T11:00:00+00:00'
    all_day = calendar('BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20260910\r\nDTEND;VALUE=DATE:20260912\r\nEND:VEVENT\r\n')
    await sync(db, all_day)
    doc = await db.events.find_one({'external_id': 'day'})
    assert doc['all_day'] and doc['date'] == '2026-09-10' and doc['end_date'] == '2026-09-12' and not doc['time_start']
    winter = tt.parse_snapshot(calendar(event(start='20261210T090000Z', end='20261210T100000Z')))
    assert winter['events'][0]['data']['time_start'] == '10:00'


async def test_calendar_and_workspace_isolation(db, monkeypatch):
    await db.events.insert_one({'id': 'foreign', 'owner_id': 'other', 'external_source': 'timetree', 'external_id': 'one', 'imported_uid': 'one'})
    await sync(db, calendar(event()))
    monkeypatch.setenv('TIMETREE_CALENDAR_ID', 'different-calendar')
    await sync(db, calendar())
    assert not (await db.events.find_one({'owner_id': 'owner'}))['missing_in_timetree']
    assert 'missing_in_timetree' not in await db.events.find_one({'owner_id': 'other'})
    with pytest.raises(tt.SyncError, match='skonfigurowano'):
        await tt.run_sync(db, 'other', fetcher=AsyncMock(return_value=calendar()))


async def test_unique_indexes_migration_is_idempotent(db):
    await tt.ensure_indexes(db)
    await tt.ensure_indexes(db)
    row = {'id': '1', 'owner_id': 'owner', 'external_source': 'timetree', 'external_id': 'uid'}
    await db.events.insert_one(row.copy())
    with pytest.raises(DuplicateKeyError):
        await db.events.insert_one(dict(row, id='2'))
    # Manual events without UID stay unrestricted.
    await db.events.insert_many([{'id': 'manual1', 'owner_id': 'owner'}, {'id': 'manual2', 'owner_id': 'owner'}])


async def test_migration_refuses_legacy_collisions_without_deleting(db):
    await db.events.insert_many([{'id': str(i), 'owner_id': 'owner', 'imported_uid': 'duplicate'} for i in range(2)])
    with pytest.raises(tt.SyncError, match='powtórzone'):
        await tt.ensure_indexes(db)
    assert await db.events.count_documents({}) == 2


async def test_overlapping_syncs_only_one_fetch_and_single_uid(db):
    entered, release = asyncio.Event(), asyncio.Event()
    async def delayed():
        entered.set()
        await release.wait()
        return calendar(event())
    first = asyncio.create_task(tt.run_sync(db, 'owner', fetcher=delayed))
    await entered.wait()
    second_fetch = AsyncMock(return_value=calendar(event()))
    with pytest.raises(tt.SyncError, match='już trwa'):
        await tt.run_sync(db, 'owner', fetcher=second_fetch)
    second_fetch.assert_not_called()
    release.set()
    assert (await first)['added'] == 1
    assert await db.events.count_documents({}) == 1


async def test_scheduled_replicas_do_not_fetch_twice_in_same_hour(db):
    await sync(db, calendar(event()), trigger='scheduled')
    with pytest.raises(tt.SyncError, match='już trwa'):
        await sync(db, calendar(event()), trigger='scheduled')
    # The manual button is allowed to override the hourly due time.
    assert (await sync(db, calendar(event())))['unchanged'] == 1


async def test_atomic_outbox_retry_no_audit_duplicate(db, monkeypatch):
    real = tt.flush_audit
    calls = 0
    async def fail_after_write(db, owner):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('private DB string must not leak')
        return await real(db, owner)
    monkeypatch.setattr(tt, 'flush_audit', fail_after_write)
    result = await sync(db, calendar(event()))
    assert result['status'] == 'error' and 'private DB' not in result['error']
    assert (await db.events.find_one({}))['timetree_outbox']
    monkeypatch.setattr(tt, 'flush_audit', real)
    result = await sync(db, calendar(event()))
    assert result['added'] == 0 and result['unchanged'] == 1
    await real(db, 'owner')
    assert await db.audit_log.count_documents({}) == 1


async def test_manual_metadata_spoofing_is_stripped():
    assert tt.sanitize_manual({'name': 'x', 'external_id': 'evil', 'timetree_source': {},
                              'timetree_revision': 99, 'timetree_source.name': 'evil', 'owner_id': 'other'}) == {'name': 'x'}
    prev = {'external_source': 'timetree', 'name': 'a', 'timetree_manual_fields': []}
    assert tt.manual_patch(prev, {'name': 'b'})['timetree_manual_fields'] == ['name']


@pytest.mark.parametrize('user', [None, {'id': 'employee', 'role': 'staff', 'workspace_id': 'owner'},
                                  {'id': 'partner', 'role': 'admin', 'workspace_id': 'owner'}])
async def test_routes_deny_nonowner_before_db_or_export(db, user):
    async def auth():
        if user is None:
            raise HTTPException(401)
        return user
    app = FastAPI()
    app.include_router(routes(db, auth, lambda: None), prefix='/api')
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        for method, path in [('GET', ''), ('POST', '/sync')]:
            response = await client.request(method, '/api/integrations/timetree' + path)
            assert response.status_code == (401 if user is None else 403)
    assert await db.timetree_runs.count_documents({}) == 0


async def test_owner_panel_no_secret_or_calendar_identifier(db):
    async def auth(): return {'id': 'owner', 'role': 'admin'}
    app = FastAPI()
    app.include_router(routes(db, auth, lambda: None), prefix='/api')
    await sync(db, calendar(event()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/integrations/timetree')
        assert response.status_code == 200
        assert response.json()['status'] == 'Połączono'
        for secret in ('not-a-real-password', 'test@example.invalid', 'test-calendar'):
            assert secret not in response.text


async def test_empty_verified_calendar_flags_all_without_deletion(db):
    await sync(db, calendar(event(), event('two')))
    result = await sync(db, calendar())
    assert result['missing'] == 2 and result['fetched'] == 0
    assert await db.events.count_documents({}) == 2
    assert await db.events.count_documents({'missing_in_timetree': True}) == 2


async def test_migration_failure_is_visible_in_history(db):
    await db.events.insert_many([{'id': str(i), 'owner_id': 'owner', 'imported_uid': 'same'} for i in range(2)])
    fetch = AsyncMock(return_value=calendar(event()))
    result = await tt.run_sync(db, 'owner', fetcher=fetch)
    fetch.assert_not_called()
    assert result['errors'] == 1 and 'powtórzone' in result['error']
    assert (await tt.status(db, 'owner'))['status'] == 'Błąd'


async def test_configured_workspace_must_really_be_owned(db):
    await db.users.update_one({'id': 'owner'}, {'$set': {'role': 'staff'}})
    fetch = AsyncMock()
    with pytest.raises(tt.SyncError):
        await tt.run_sync(db, 'owner', fetcher=fetch)
    fetch.assert_not_called()


async def test_no_secret_in_failure_logging(db, caplog):
    result = await tt.run_sync(db, 'owner', fetcher=AsyncMock(side_effect=ValueError('not-a-real-password test@example.invalid')))
    assert 'not-a-real-password' not in caplog.text and 'test@example.invalid' not in caplog.text
    assert 'not-a-real-password' not in str(result)


async def test_exporter_timeout_kills_child_and_does_not_capture_logs(monkeypatch):
    class Process:
        returncode = None
        killed = False
        async def wait(self):
            if not self.killed:
                raise asyncio.TimeoutError()
            return -9
        def kill(self): self.killed = True; self.returncode = -9
    process = Process()
    called = {}
    async def spawn(*args, **kwargs): called.update(args=args, kwargs=kwargs); return process
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    for key in ('TIMETREE_EMAIL', 'TIMETREE_PASSWORD', 'TIMETREE_CALENDAR_ID'):
        monkeypatch.setenv(key, 'secret-' + key)
    monkeypatch.setenv('MONGO_URL', 'not-for-child')
    with pytest.raises(tt.SyncError, match='niedostępne'):
        await tt.fetch_ics()
    assert process.killed
    assert all('secret-' not in str(arg) for arg in called['args'])
    assert 'MONGO_URL' not in called['kwargs']['env']
    assert called['kwargs']['stdout'] == asyncio.subprocess.DEVNULL
    assert called['kwargs']['stderr'] == asyncio.subprocess.DEVNULL


async def test_outbox_recovery_after_delivery_before_acknowledgment(db):
    await sync(db, calendar(event()))
    original = await db.audit_log.find_one({})
    entry = {k: v for k, v in original.items() if k != '_id'}
    await db.events.update_one({}, {'$push': {'timetree_outbox': entry}})
    await tt.flush_audit(db, 'owner')
    assert await db.audit_log.count_documents({}) == 1
    assert (await db.events.find_one({}))['timetree_outbox'] == []


async def test_recurrence_and_folded_unicode_lines_are_preserved():
    data = calendar(event(extra='RRULE:FREQ=WEEKLY;COUNT=5\r\n')).replace('Przyjęcie'.encode(), 'Zażółć\r\n  gęślą'.encode())
    parsed = tt.parse_snapshot(data)
    assert parsed['events'][0]['data']['name'] == 'Zażółć gęślą'
    assert parsed['events'][0]['recurrence']['RRULE'] == 'FREQ=WEEKLY;COUNT=5'


async def test_actual_update_route_preserves_metadata_and_rejects_stale_form(db):
    # Execute the actual existing route body without importing unrelated mail/AI SDKs.
    import ast
    from types import SimpleNamespace
    tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'update_event')
    node.decorator_list = []
    node.args.defaults = [ast.Constant(value=None)]
    node.returns = None
    for arg in node.args.args: arg.annotation = None
    env = {'db': db, 'event_finance': __import__('event_finance'), 'timetree': tt, 'ws': lambda u: u['id'], 'is_staff': lambda u: False,
           'HTTPException': HTTPException, 'now_utc': tt.now, '_TRACKED_STATUSES': set(),
           '_availability_conflicts': AsyncMock(return_value=[]),
           '_availability_block_msg': lambda _: '',
           'pre_email': SimpleNamespace(reconcile_event=AsyncMock(side_effect=lambda db, ev: ev)),
           'log_change': AsyncMock(), 'log_field_diffs': AsyncMock(),
           '_sync_event_for_workspace': AsyncMock(), 'compute_event_summary': AsyncMock(side_effect=lambda ev: ev)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), 'server.py', 'exec'), env)
    await sync(db, calendar(event()))
    previous = await db.events.find_one({})
    payload = {'name': 'Ręczna nazwa', 'date': previous['date'], 'time_start': '14:00',
               'timetree_expected_revision': previous['timetree_revision'], 'external_id': 'evil',
               'timetree_source': {'name': 'forged'}, 'price_total': 3500}
    body = SimpleNamespace(dict=lambda: payload)
    result = await env['update_event'](previous['id'], body, {'id': 'owner'})
    assert result['external_id'] == 'one' and result['timetree_source']['name'] == 'Przyjęcie'
    assert result['name'] == 'Ręczna nazwa' and 'name' in result['timetree_manual_fields']
    with pytest.raises(HTTPException) as failure:
        await env['update_event'](previous['id'], body, {'id': 'owner'})
    assert failure.value.status_code == 409
    await sync(db, calendar(event(title='Nowa z TimeTree')))
    result = await db.events.find_one({})
    assert result['name'] == 'Ręczna nazwa' and result['price_total'] == 3500


async def test_worker_mode_button_queues_without_backend_credentials_or_subprocess(db, monkeypatch):
    import timetree_worker
    monkeypatch.setenv('TIMETREE_USE_WORKER', 'true')
    monkeypatch.delenv('TIMETREE_EMAIL')
    monkeypatch.delenv('TIMETREE_PASSWORD')
    async def auth(): return {'id': 'owner', 'role': 'admin'}
    app = FastAPI()
    app.include_router(routes(db, auth, lambda: None), prefix='/api')
    run = AsyncMock(return_value={'status': 'success'})
    monkeypatch.setattr(tt, 'run_sync', run)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/api/integrations/timetree/sync')
        assert response.status_code == 202
        # Repeated clicks cannot enqueue duplicate jobs.
        await client.post('/api/integrations/timetree/sync')
        state = (await client.get('/api/integrations/timetree')).json()
        assert state['queued'] and state['configured']
    run.assert_not_called()
    assert await db.timetree_requests.count_documents({}) == 1
    monkeypatch.setenv('TIMETREE_EMAIL', 'worker@example.invalid')
    monkeypatch.setenv('TIMETREE_PASSWORD', 'worker-password')
    await timetree_worker.worker_tick(db)
    run.assert_awaited_once_with(db, 'owner', 'manual')
    assert await db.timetree_requests.count_documents({}) == 0
    assert (await tt.status(db, 'owner'))['worker_running']


async def test_worker_keeps_request_while_another_sync_has_lease(db, monkeypatch):
    import timetree_worker
    await db.timetree_requests.insert_one({'_id': 'owner', 'id': 'request'})
    monkeypatch.setattr(tt, 'run_sync', AsyncMock(side_effect=tt.SyncError('busy')))
    await timetree_worker.worker_tick(db)
    assert await db.timetree_requests.count_documents({}) == 1


async def test_existing_scheduler_registers_hourly_job_and_executes_it(db, monkeypatch):
    import ast
    import logging
    from types import SimpleNamespace
    from datetime import datetime, timedelta, timezone
    monkeypatch.setenv('TIMETREE_SCHEDULER_ENABLED', 'true')
    monkeypatch.setenv('TIMETREE_USE_WORKER', 'false')
    completed = asyncio.Event()
    async def callback(database):
        await sync(database, calendar(event()), trigger='scheduled')
        completed.set()
    monkeypatch.setattr(tt, 'scheduled_sync', callback)
    async def noop(*args): pass
    tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_startup')
    node.decorator_list = []
    env = {'db': db, 'timetree': tt, 'os': os, 'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
           'logger': logging.getLogger('test-scheduler'), '_scheduler': None, 'scan_and_create_alerts': noop,
           'pre_email': SimpleNamespace(scan_and_send_due=noop), '_creplies': SimpleNamespace(scan_client_replies=noop)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), 'server.py', 'exec'), env)
    await env['_startup']()
    scheduler = env['_scheduler']
    try:
        job = scheduler.get_job('timetree_sync')
        assert job.trigger.interval.total_seconds() == 3600 and job.max_instances == 1 and job.coalesce
        job.modify(next_run_time=tt.now())
        await asyncio.wait_for(completed.wait(), timeout=10)
        assert await db.events.count_documents({'external_id': 'one'}) == 1
        assert (await db.timetree_runs.find_one({}))['trigger'] == 'scheduled'
    finally:
        scheduler.shutdown(wait=False)


async def test_actual_update_route_recalculates_prices_and_sync_preserves_them(db):
    # Execute the actual existing route body without importing unrelated mail/AI SDKs.
    import ast
    from types import SimpleNamespace
    tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'update_event')
    node.decorator_list = []
    node.args.defaults = [ast.Constant(value=None)]
    node.returns = None
    for arg in node.args.args: arg.annotation = None
    env = {'db': db, 'event_finance': __import__('event_finance'), 'timetree': tt, 'ws': lambda u: u['id'], 'is_staff': lambda u: False,
           'HTTPException': HTTPException, 'now_utc': tt.now, '_TRACKED_STATUSES': set(),
           '_availability_conflicts': AsyncMock(return_value=[]),
           '_availability_block_msg': lambda _: '',
           'pre_email': SimpleNamespace(reconcile_event=AsyncMock(side_effect=lambda db, ev: ev)),
           'log_change': AsyncMock(), 'log_field_diffs': AsyncMock(),
           '_sync_event_for_workspace': AsyncMock(), 'compute_event_summary': AsyncMock(side_effect=lambda ev: ev)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), 'server.py', 'exec'), env)
    await sync(db, calendar(event()))
    previous = await db.events.find_one({})
    payload = dict(name=previous['name'], date=previous['date'], pricing_mode='per_person_v1',
        price_per_person=90, paying_people=35, free_carers=4, discount_pct=12,
        price_total=1, revenue=1, costs=[{'label':'Koszty','amount':900}], client_name='Szkoła nr 2')
    body = SimpleNamespace(dict=lambda: payload.copy())
    result = await env['update_event'](previous['id'], body, {'id':'owner'})
    assert result['price_total'] == 2772 and result['revenue'] == 2772
    assert result['people'] == 39 and result['free_carers'] == 4
    env['log_field_diffs'].assert_awaited()
    await sync(db, calendar(event(title='Nowy termin')))
    result = await db.events.find_one({'id':previous['id']})
    assert result['price_total'] == 2772 and result['client_name'] == 'Szkoła nr 2'
    assert result['costs'] == payload['costs']
    payload['discount_pct'] = 101
    with pytest.raises(HTTPException) as failure:
        await env['update_event'](previous['id'], body, {'id':'owner'})
    assert failure.value.status_code == 422
    assert (await db.events.find_one({'id':previous['id']})) == result
