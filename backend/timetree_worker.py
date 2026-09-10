"""Optional standalone service / cron entry point; no publicly exposed HTTP endpoint."""
import argparse
import asyncio
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import timetree_sync as sync


async def main(once=False):
    load_dotenv(Path(__file__).with_name('.env'))
    client = AsyncIOMotorClient(os.environ['MONGO_URL'], serverSelectionTimeoutMS=10000)
    try:
        db = client[os.environ['DB_NAME']]
        await sync.ensure_indexes(db)
        if once:
            result = await sync.run_sync(db, os.environ['TIMETREE_OWNER_ID'], 'worker')
            print('TimeTree:', result['status'], 'pobrano:', result['fetched'],
                  'dodano:', result['added'], 'zaktualizowano:', result['updated'], 'błędy:', result['errors'])
            return 0 if result['status'] == 'success' else 1
        while True:
            await worker_tick(db)
            await asyncio.sleep(10)
    finally:
        client.close()


async def worker_tick(db):
    owner_id = os.getenv('TIMETREE_OWNER_ID', '')
    if not sync.configured(owner_id):
        raise sync.SyncError('configuration')
    await db.timetree_status.update_one({'_id': owner_id}, {'$set': {
        'worker_seen_at': sync.now().isoformat()}}, upsert=True)
    request = await db.timetree_requests.find_one({'_id': owner_id})
    if request:
        try:
            await sync.run_sync(db, owner_id, 'manual')
        except sync.SyncError as exc:
            if exc.code == 'busy':
                return
            raise
        # Only acknowledge this exact request, never a later owner's request.
        await db.timetree_requests.delete_one({'_id': owner_id, 'id': request['id']})
    else:
        await sync.scheduled_sync(db)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    try:
        raise SystemExit(asyncio.run(main(args.once)))
    except Exception:
        logging.error('TimeTree worker failed: check configuration and database connectivity.')
        raise SystemExit(1) from None
