"""Owner-only routes; TimeTree credentials and calendar ID never enter HTTP payloads."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import uuid
import timetree_sync as sync


def routes(db, current_user, get_scheduler):
    router = APIRouter(prefix='/integrations/timetree')

    async def owner(user=Depends(current_user)):
        if not user.get('id') or user.get('role') == 'staff' or user['id'] != (user.get('workspace_id') or user['id']):
            raise HTTPException(403, 'Integracja TimeTree jest dostępna tylko dla właściciela.')
        return user['id']

    @router.get('')
    async def get_status(owner_id=Depends(owner)):
        try:
            result = await sync.status(db, owner_id)
            scheduler = get_scheduler()
            job = scheduler.get_job('timetree_sync') if scheduler else None
            result['scheduler_running'] = bool(scheduler and scheduler.running and job)
            result['next_scheduled_at'] = job.next_run_time.isoformat() if job and job.next_run_time else None
            result['workspace_id'] = owner_id
            return result
        except Exception:
            raise HTTPException(503, 'Nie udało się odczytać statusu integracji z bazy.') from None

    @router.post('/sync')
    async def synchronize(owner_id=Depends(owner)):
        try:
            if sync.use_worker():
                if not sync.panel_configured(owner_id):
                    raise sync.SyncError('configuration')
                await db.timetree_requests.update_one({'_id': owner_id}, {'$setOnInsert': {
                    'id': str(uuid.uuid4()), 'requested_at': sync.now().isoformat()}}, upsert=True)
                return JSONResponse({'status': 'queued'}, status_code=202)
            return await sync.run_sync(db, owner_id)
        except sync.SyncError as exc:
            raise HTTPException(409 if exc.code == 'busy' else 503, str(exc)) from None
        except Exception:
            raise HTTPException(503, sync.MESSAGES['database']) from None

    return router
