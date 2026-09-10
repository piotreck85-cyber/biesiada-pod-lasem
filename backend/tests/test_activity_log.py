import sys, unittest
from types import SimpleNamespace
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import activity_log as activity

class Cursor:
    def __init__(self, rows): self.rows = rows
    def sort(self, key, order): self.rows.sort(key=lambda r:r.get(key,''), reverse=order < 0); return self
    async def to_list(self, count): return self.rows[:count]
class Collection:
    def __init__(self): self.rows=[]; self.queries=[]
    async def insert_one(self, row): self.rows.append(dict(row))
    def find(self, query, projection):
        self.queries.append(query)
        rows=[r for r in self.rows if all((r.get(k) in v['$in'] if '$in' in v else r.get(k,'') >= v['$gte']) if isinstance(v,dict) else r.get(k)==v for k,v in query.items())]
        keys=[k for k,v in projection.items() if v==1]
        return Cursor([{k:v for k,v in row.items() if (k in keys if keys else k!='_id')} for row in rows])
class ActivityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db=SimpleNamespace(activity_log=Collection(), audit_log=Collection())
        self.owner={'id':'owner','role':'admin'}
        self.staff={'id':'staff','workspace_id':'owner','role':'staff','name':'Anna'}
    async def test_only_actual_owner_can_read(self):
        for user in [self.staff, {'id':'partner','workspace_id':'owner','role':'admin'}, {'id':'staff','role':'staff'}]:
            with self.assertRaises(PermissionError): await activity.read_activity(self.db,user)
        self.assertEqual(self.db.activity_log.queries, [])
    async def test_separate_workspaces_and_actor_from_authenticated_user(self):
        await activity.record(self.db,self.staff,'visit','grafik')
        await activity.record(self.db,dict(self.staff,id='foreign',workspace_id='elsewhere'),'visit','finanse')
        result=await activity.read_activity(self.db,self.owner)
        self.assertEqual([r['user_id'] for r in result['items']], ['staff'])
        self.assertEqual(result['items'][0]['summary'], 'Wejście: Moja praca')
    async def test_arbitrary_paths_and_payloads_rejected(self):
        for path in ['https://secret.example','grafik?token=secret','unknown']:
            with self.assertRaises(ValueError): await activity.record(self.db,self.staff,'visit',path)
        self.assertEqual(self.db.activity_log.rows, [])
    async def test_saved_change_values_not_returned(self):
        await self.db.audit_log.insert_one({'id':'change','owner_id':'owner','user_id':'staff','at':'2099-01-01','old':'private','new':'private','summary':'Zmieniono imprezę'})
        row=(await activity.read_activity(self.db,self.owner))['items'][0]
        self.assertNotIn('old',row); self.assertNotIn('new',row)
    async def test_limit_and_filter(self):
        for n in range(205): await activity.record(self.db,self.staff,'login')
        result=await activity.read_activity(self.db,self.owner,user_id='staff')
        self.assertEqual(len(result['items']),200); self.assertTrue(result['truncated'])
        self.assertEqual((await activity.read_activity(self.db,self.owner,user_id='other'))['items'],[])
    async def test_owner_not_monitored_and_period_validation(self):
        await activity.record(self.db,self.owner,'login')
        self.assertEqual(self.db.activity_log.rows,[])
        with self.assertRaises(ValueError): await activity.read_activity(self.db,self.owner,days=36500)
    async def test_login_and_browsing_filters_apply_before_limit(self):
        await activity.record(self.db,self.staff,'login')
        for _ in range(205): await activity.record(self.db,self.staff,'visit','imprezy')
        login=await activity.read_activity(self.db,self.owner,kind='login')
        self.assertEqual(len(login['items']),1)
        self.assertEqual(login['items'][0]['action'],'login')
        self.assertFalse(login['truncated'])
        await activity.record(self.db,self.staff,'view_event','event','event-id')
        browsing=await activity.read_activity(self.db,self.owner,kind='browsing')
        self.assertTrue(browsing['truncated'])
        self.assertEqual({row['action'] for row in browsing['items']}, {'visit','view_event'})
        self.assertEqual(self.db.audit_log.queries, [])
    async def test_every_filter_denies_staff_before_reading(self):
        for kind in ['all','login','browsing']:
            with self.assertRaises(PermissionError):
                await activity.read_activity(self.db,self.staff,kind=kind)
        self.assertEqual(self.db.activity_log.queries, [])
        self.assertEqual(self.db.audit_log.queries, [])
    async def test_unknown_filter_rejected(self):
        with self.assertRaises(ValueError):
            await activity.read_activity(self.db,self.owner,kind='arbitrary')
    async def test_actual_api_route_returns_403_to_employee(self):
        import ast
        from fastapi import HTTPException
        tree=ast.parse((Path(__file__).resolve().parents[1]/'server.py').read_text())
        node=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='activity_history')
        node.decorator_list=[]
        node.args.defaults[-1]=ast.Constant(value=None)
        env={'activity':activity,'db':self.db,'HTTPException':HTTPException}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'server.py','exec'),env)
        for kind in ['all','login','browsing']:
            with self.assertRaises(HTTPException) as failure:
                await env['activity_history'](kind=kind,user=self.staff)
            self.assertEqual(failure.exception.status_code,403)
        result=await env['activity_history'](kind='login',user=self.owner)
        self.assertEqual(result['items'],[])
if __name__=='__main__': unittest.main()

