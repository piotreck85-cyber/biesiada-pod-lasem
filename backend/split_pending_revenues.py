import asyncio, os, json, uuid
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

async def main():
    c = AsyncIOMotorClient(os.getenv('MONGO_URL'))
    db = c[os.getenv('DB_NAME','forest_events')]
    ws = '18ea076f-3ff4-4ac4-b17b-1ef2f44aadfc'

    pending = []
    async for p in db.pending_revenue_assignments.find({'owner_id': ws}):
        pending.append(p)
    print(f'Processing {len(pending)} pending revenues')

    backup_dir = f'/app/backend/backups/pending_revenue_split_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    os.makedirs(backup_dir, exist_ok=True)
    with open(f'{backup_dir}/pending_before.json', 'w') as f:
        json.dump([{k:str(v) for k,v in p.items() if k != '_id'} for p in pending], f, indent=2, default=str)
    print(f'Backup saved to {backup_dir}')

    created_payments = []
    processed_ids = []
    for p in pending:
        d = p.get('date')
        amt = float(p.get('amount', 0))
        desc = p.get('description') or p.get('note') or ''
        events_same_date = []
        async for e in db.events.find({'owner_id': ws, 'date': d}):
            events_same_date.append(e)
        if not events_same_date:
            print(f'  SKIP {d} {amt}zl - no events on date')
            continue
        share = round(amt / len(events_same_date), 2)
        remainder = round(amt - share * len(events_same_date), 2)
        for i, e in enumerate(events_same_date):
            pay_amt = share + (remainder if i == 0 else 0)
            payment = {
                'id': str(uuid.uuid4()),
                'owner_id': ws,
                'event_id': e['id'],
                'amount': pay_amt,
                'date': d,
                'method': 'gotowka',
                'kind': 'payment',
                'description': f'WhatsApp import (auto-split): {desc}',
                'source': 'whatsapp_pending_split',
                'created_at': datetime.utcnow().isoformat(),
            }
            await db.event_payments.insert_one(payment)
            created_payments.append({'id': payment['id'], 'event_id': e['id'], 'event_name': e.get('name',''), 'amount': pay_amt, 'date': d, 'source_pending': p.get('id')})
            print(f'  + {d} {pay_amt:.2f}zl -> {e.get("name","?")[:40]}')
        processed_ids.append(p.get('id'))

    with open(f'{backup_dir}/payments_created.json', 'w') as f:
        json.dump(created_payments, f, indent=2, default=str)
    if processed_ids:
        result = await db.pending_revenue_assignments.delete_many({'id': {'$in': processed_ids}, 'owner_id': ws})
        print(f'Removed {result.deleted_count} pending records')
    print(f'\nTOTAL: {len(created_payments)} payments created, {len(processed_ids)} pending processed')

asyncio.run(main())
