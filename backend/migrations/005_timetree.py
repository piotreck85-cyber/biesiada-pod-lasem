"""Idempotent TimeTree indexes; stop on collisions, never delete events.
Run from backend: python migrations/005_timetree.py
Existing imported_uid records are linked lazily on their first verified sync.
"""
import asyncio
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from timetree_sync import ensure_indexes, SyncError


async def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    client = AsyncIOMotorClient(os.environ['MONGO_URL'], serverSelectionTimeoutMS=10000)
    try:
        await ensure_indexes(client[os.environ['DB_NAME']])
        print('Migracja 005 TimeTree: indeksy gotowe. Nie usunięto ani nie nadpisano wydarzeń.')
    finally:
        client.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except SyncError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Migracja nie powiodła się. Sprawdź połączenie i uprawnienia bazy.', file=sys.stderr)
        sys.exit(1)
