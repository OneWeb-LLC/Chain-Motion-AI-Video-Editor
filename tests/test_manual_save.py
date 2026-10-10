import copy
import tempfile
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from editor import server
from editor.store import Store

class ManualSaveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(self.tmp.name)
        self.p=next(iter(self.store.data['projects'].values()))
        self.pid=self.p['id']
        self.original=copy.deepcopy(self.p)
        self.patcher=patch.object(server,'store',self.store);self.patcher.start();self.addCleanup(self.patcher.stop)

    def edit(self):
        p=copy.deepcopy(self.store.data['projects'][self.pid])
        p['scenes'][0]['segments'][0]['prompt']='Unfinished edit'
        return server.save_project(self.pid,p)

    def test_recovery_survives_restart_without_overwriting_saved_project(self):
        draft=self.edit()
        reopened=Store(self.tmp.name)
        self.assertEqual(reopened.data['projects'][self.pid],draft)
        self.assertEqual(reopened.data['saved_projects'][self.pid],self.original)

    def test_manual_save_is_only_commit_and_later_edits_stay_unfinalized(self):
        draft=self.edit()
        saved=server.commit_project(self.pid,dict(version=draft['version']))
        self.assertEqual(self.store.data['saved_projects'][self.pid],draft)
        next_edit=copy.deepcopy(draft);next_edit['name']='Unfinished rename'
        server.save_project(self.pid,next_edit)
        self.assertEqual(self.store.data['saved_projects'][self.pid],saved)
        with self.assertRaises(HTTPException):server.commit_project(self.pid,dict(version=draft['version']))

    def test_save_as_preserves_original_saved_and_recovery_versions(self):
        draft=self.edit()
        saved=server.commit_project(self.pid,dict(version=draft['version'],name='Named copy'))
        self.assertNotEqual(saved['id'],self.pid)
        self.assertEqual(saved['name'],'Named copy')
        self.assertEqual(saved['scenes'],draft['scenes'])
        self.assertEqual(self.store.data['saved_projects'][self.pid],self.original)
        self.assertEqual(self.store.data['projects'][self.pid],draft)
        self.assertEqual(self.store.data['saved_projects'][saved['id']],saved)
        self.assertEqual(self.store.data['projects'][saved['id']],saved)

    def test_discard_recovery_restores_saved_and_rejects_active_jobs(self):
        draft=self.edit()
        self.store.data['jobs']=[dict(project_id=self.pid,status='running')]
        with self.assertRaises(ValueError):server.discard_project_recovery(self.pid,dict(version=draft['version']))
        self.store.data['jobs']=[]
        restored=server.discard_project_recovery(self.pid,dict(version=draft['version']))
        self.assertEqual(restored['scenes'],self.original['scenes'])
        self.assertGreater(restored['version'],draft['version'])

    def test_existing_library_migrates_saved_baseline_once(self):
        self.store.data.pop('saved_projects');self.store.save()
        migrated=Store(self.tmp.name)
        self.assertEqual(migrated.data['saved_projects'][self.pid],self.original)
        migrated.data['projects'][self.pid]['name']='Recovery edit';migrated.save()
        self.assertEqual(Store(self.tmp.name).data['saved_projects'][self.pid],self.original)
