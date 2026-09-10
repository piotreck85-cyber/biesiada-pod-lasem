"""Execute actual FastAPI event routes against an isolated Mongo mock.
Only unrelated email/calendar integrations and authentication are substituted.
"""
import ast
import sys
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import pytest_asyncio
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from httpx import AsyncClient, ASGITransport
from mongomock_motor import AsyncMongoMockClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import timetree_sync as timetree
import event_finance

@pytest_asyncio.fixture
async def service():
    db=AsyncMongoMockClient()['permissions_test']
    owner={'id':'owner','role':'admin','workspace_id':'owner'}
    staff={'id':'worker','role':'staff','workspace_id':'owner','staff_id':'s1','permissions':{}}
    await db.users.insert_many([owner.copy(),staff.copy()])
    async def auth(x_user: str = Header(default='worker')):
        user=await db.users.find_one({'id':x_user},{'_id':0})
        if not user: raise HTTPException(401)
        return user
    async def admin(user=Depends(auth)):
        if user.get('role')=='staff': raise HTTPException(403)
        return user
    router=APIRouter()
    env=dict(db=db,api=router,BaseModel=BaseModel,Optional=Optional,List=List,Dict=Dict,
        Depends=Depends,HTTPException=HTTPException,current_user=auth,require_admin=admin,uuid=uuid,_status_label=lambda s:s,
        is_staff=lambda u:u.get('role')=='staff', is_admin=lambda u:u.get('role')!='staff',
        ws=lambda u:u.get('workspace_id') or u['id'],_is_partner=AsyncMock(return_value=False),
        now_utc=lambda:datetime.now(timezone.utc),event_finance=event_finance,timetree=timetree,
        _availability_conflicts=AsyncMock(return_value=[]),_availability_block_msg=lambda x:'Konflikt',
        _TRACKED_STATUSES=set(),pre_email=SimpleNamespace(reconcile_event=AsyncMock(side_effect=lambda db,ev:ev)),
        log_change=AsyncMock(),log_field_diffs=AsyncMock(),record_activity=AsyncMock(),
        _sync_event_for_workspace=AsyncMock(),_create_activity_alert=AsyncMock(),
        compute_event_summary=AsyncMock(side_effect=lambda ev:ev))
    names={'CostItem','StaffShift','EventIn','DEFAULT_STAFF_PERMISSIONS','MODULE_PERMISSION_KEYS',
        'PERMISSION_LABELS','EVENT_PRICE_FIELDS','EVENT_FINANCE_FIELDS','EVENT_PRIVATE_FIELDS',
        'STAFF_SAFE_EVENT_FIELDS','staff_safe_event','staff_module_permissions','require_module_perm',
        '_staff_allowed_event_fields','event_for_permitted_staff','list_events','create_event',
        'get_event','update_event','delete_event','BulkEventStatusIn','bulk_update_event_status',
        'ModulePermissionsIn','set_staff_module_permissions'}
    tree=ast.parse((Path(__file__).resolve().parents[1]/'server.py').read_text())
    nodes=[n for n in tree.body if getattr(n,'name',None) in names or
        isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'server.py','exec'),env)
    app=FastAPI();app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
        yield db,client,env

async def grant(db,**perms):
    await db.users.update_one({'id':'worker'},{'$set':{'permissions':perms}})

async def seed(db,owner='owner'):
    ev=dict(id=str(uuid.uuid4()),owner_id=owner,name='Impreza',date='2026-10-01',time_start='11:00',
        time_end='13:00',price_total=2772,revenue=2772,client_name='Szkoła',notes='Prywatne',
        costs=[{'label':'Koszt','amount':900}],shifts=[],status='potwierdzona',org={'menu':'stare'})
    await db.events.insert_one(ev.copy());return ev

@pytest.mark.asyncio
async def test_staff_crud_is_immediate_without_owner_approval(service):
    db,client,env=service
    await grant(db,event_create=True,event_edit=True,event_delete=True)
    response=await client.post('/events',json={'name':'Wycieczka','date':'2026-10-02','org':{'kids_count':35},'price_total':999,'notes':'hidden'})
    assert response.status_code==200,response.text
    ev=response.json();eid=ev['id']
    assert (await db.events.find_one({'id':eid}))['name']=='Wycieczka'
    assert 'price_total' not in ev and 'notes' not in ev
    assert (await client.get('/events')).json()[0]['id']==eid
    response=await client.put('/events/'+eid,json={'name':'Nowa nazwa','date':'2026-10-03','org':{'kids_count':40}})
    assert response.status_code==200,response.text
    assert response.json()['date']=='2026-10-03'
    assert response.json()['org']['kids_count']==40
    assert (await client.delete('/events/'+eid)).status_code==200
    assert await db.events.count_documents({'id':eid})==0
    assert [call.args[1] for call in env['log_change'].await_args_list]==['create','update','delete']

@pytest.mark.asyncio
@pytest.mark.parametrize('permission',['event_create','event_edit','event_delete','event_org_edit','event_status'])
async def test_calendar_is_available_for_event_permissions(service,permission):
    db,client,_=service
    ev=await seed(db);await seed(db,'foreign')
    await grant(db,**{permission:True})
    rows=(await client.get('/events')).json()
    assert [row['id'] for row in rows]==[ev['id']]
    assert (await client.get('/events/'+ev['id'])).status_code==200

@pytest.mark.asyncio
async def test_read_only_permissions_do_not_allow_mutations(service):
    db,client,_=service;ev=await seed(db)
    await grant(db,calendar_view=True)
    payload={'name':'Hacked','date':'2026-10-05'}
    assert (await client.post('/events',json=payload)).status_code==403
    assert (await client.put('/events/'+ev['id'],json=payload)).status_code==403
    assert (await client.delete('/events/'+ev['id'])).status_code==403
    assert (await db.events.find_one({'id':ev['id']}))['name']=='Impreza'

@pytest.mark.asyncio
async def test_edit_preserves_protected_fields_and_revocation_applies_immediately(service):
    db,client,_=service;ev=await seed(db)
    await grant(db,event_edit=True)
    payload={'name':'Zmieniona','date':'2026-10-04','price_total':1,'revenue':1,'costs':[],
        'notes':'overwrite','status':'anulowana','shifts':[{'staff_id':'x'}]}
    response=await client.put('/events/'+ev['id'],json=payload)
    assert response.status_code==200,response.text
    saved=await db.events.find_one({'id':ev['id']})
    for field in ['price_total','revenue','costs','notes','status','shifts']: assert saved[field]==ev[field]
    assert saved['name']=='Zmieniona'
    assert (await client.delete('/events/'+ev['id'])).status_code==403
    await grant(db)
    assert (await client.put('/events/'+ev['id'],json=payload)).status_code==403

@pytest.mark.asyncio
async def test_cross_workspace_mutations_forbidden(service):
    db,client,_=service;ev=await seed(db,'foreign')
    await grant(db,event_edit=True,event_delete=True)
    assert (await client.put('/events/'+ev['id'],json={'name':'X','date':'2026-10-05'})).status_code==404
    assert (await client.delete('/events/'+ev['id'])).status_code==404
    assert await db.events.count_documents({'id':ev['id']})==1

@pytest.mark.asyncio
async def test_owner_permission_save_takes_effect_without_employee_relogin(service):
    db,client,_=service
    await db.staff.insert_one({'id':'s1','owner_id':'owner','name':'Pracownik'})
    payload={'name':'Nowa','date':'2026-10-04'}
    assert (await client.post('/events',json=payload)).status_code==403
    response=await client.put('/staff/s1/permissions',headers={'x-user':'owner'},json={'permissions':{'event_create':True,'event_edit':True,'event_delete':True}})
    assert response.status_code==200,response.text
    assert (await client.post('/events',json=payload)).status_code==200
    assert (await client.put('/staff/s1/permissions',json={'permissions':{'event_delete':True}})).status_code==403

@pytest.mark.asyncio
async def test_calendar_status_saved_immediately_and_stale_form_cannot_overwrite(service):
    db,client,_=service;ev=await seed(db)
    await grant(db,event_status=True)
    response=await client.patch('/events/bulk-status',json={'event_ids':[ev['id']],'status':'rezerwacja'})
    assert response.status_code==200,response.text
    saved=await db.events.find_one({'id':ev['id']})
    assert saved['status']=='rezerwacja' and saved['timetree_revision']==1
    response=await client.put('/events/'+ev['id'],json={'name':ev['name'],'date':ev['date'],'status':'potwierdzona','timetree_expected_revision':0})
    assert response.status_code==409
    await grant(db,calendar_view=True)
    assert (await client.patch('/events/bulk-status',json={'event_ids':[ev['id']],'status':'anulowana'})).status_code==403

@pytest.mark.asyncio
async def test_changing_date_checks_existing_staff_availability(service):
    db,client,env=service;ev=await seed(db)
    shifts=[{'staff_id':'assigned','hours':2}]
    await db.events.update_one({'id':ev['id']},{'$set':{'shifts':shifts}})
    await grant(db,event_edit=True)
    env['_availability_conflicts'].return_value=[{'staff_id':'assigned'}]
    response=await client.put('/events/'+ev['id'],json={'name':ev['name'],'date':'2026-10-09'})
    assert response.status_code==400
    assert env['_availability_conflicts'].await_args.args[2]==shifts
    assert (await db.events.find_one({'id':ev['id']}))['date']==ev['date']
