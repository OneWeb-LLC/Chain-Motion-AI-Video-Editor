import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI, UploadFile, HTTPException
from editor.store import Store
from editor.set_studio import install, splat_graph, ply_info, validate_ply, validate_set, register_splat

class SetStudioTests(unittest.TestCase):
    def test_supplied_workflow_links_and_widgets(self):
        schema=json.loads((Path(__file__).parent/'fixtures/worldmirror_schema.json').read_text())
        graph=splat_graph('uploaded.png','test',schema)
        self.assertEqual(graph['8']['inputs']['image'],'uploaded.png')
        self.assertEqual(graph['5']['inputs']['filename'],'frameforge-set-test')
        self.assertEqual(graph['5']['inputs']['ply_data'],['14',0])
        self.assertEqual(graph['12']['inputs']['ply_path'],['5',0])
        self.assertEqual(graph['14']['inputs']['images'],['8',0])
        self.assertEqual(graph['14']['inputs']['splat_upsample_max_points'],9000000)
        self.assertEqual(graph['14']['inputs']['splat_camera_source'],'camera_inputs')
        with self.assertRaisesRegex(ValueError,'missing node'):splat_graph('x','x',{})

    def test_download_metadata_and_missing_output(self):
        self.assertEqual(ply_info({'outputs':{'12':{'filename':['a.ply'],'subfolder':['output'],'type':['output']}}}),dict(filename='a.ply',subfolder='output',type='output'))
        with self.assertRaisesRegex(ValueError,'downloadable PLY'):ply_info({'outputs':{}})

    def test_saved_pose_attachment_and_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);app=FastAPI();install(app,store,None,None)
            save=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/sets/{sid}')
            person=dict(id='person',name='Person',type='mannequin',position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],pose={'rightElbow':[0,0,1]})
            prop=dict(person,id='prop',name='Prop',type='box',parent='person',part='rightHand',pose={})
            doc=dict(name='Set',objects=[person,prop],version=0)
            saved=save('a'*32,doc)
            self.assertEqual(saved['version'],1)
            self.assertEqual(Store(tmp).snapshot()['sets']['a'*32]['objects'][1]['parent'],'person')
            with self.assertRaises(HTTPException) as ctx:save('a'*32,doc)
            self.assertEqual(ctx.exception.status_code,409)
            self.assertEqual(save('a'*32,saved)['version'],2)
            for field,value in [('pose',{'badJoint':[0,0,0]}),('scale',[0,1,1]),('position',[float('nan'),0,0]),('id','bad"id')]:
                bad=copy.deepcopy(doc);bad['objects'][0][field]=value
                with self.assertRaises(ValueError):validate_set(bad,{})
            bad=copy.deepcopy(doc);bad['objects'][1]['part']='invalid'
            with self.assertRaises(ValueError):validate_set(bad,{})

    def test_ply_registration_and_failed_import_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);path=Path(tmp)/'assets/test.ply'
            path.write_bytes(b'ply\nformat ascii 1.0\nelement vertex 0\n'+b''.join(b'property float '+k+b'\n' for k in (b'x',b'y',b'z',b'scale_0',b'rot_0',b'opacity'))+b'end_header\n')
            item=register_splat(store,path,'Test','image')
            self.assertEqual(store.asset_path(item),path)
            app=FastAPI();install(app,store,None,None)
            upload=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/import')
            with self.assertRaises(ValueError):upload(UploadFile(filename='bad.ply',file=io.BytesIO(b'not a ply')))
            self.assertEqual(list((Path(tmp)/'assets').iterdir()),[path])
            path.write_bytes(b'ply\nproperty float x\nend_header\n')
            with self.assertRaisesRegex(ValueError,'point cloud'):validate_ply(path)

    def test_completed_job_saves_ply_and_cancelled_download_is_discarded(self):
        from unittest.mock import Mock, patch
        from editor.comfy import JobRunner
        from editor.store import uid
        for cancel in (False,True):
            with self.subTest(cancel=cancel),tempfile.TemporaryDirectory() as tmp:
                store=Store(tmp)
                job=dict(id=uid(),kind='splat',name='Set',status='recovering',prompt_id='remote',spec={'image_id':'image'})
                store.data['jobs'].append(job)
                client=Mock()
                def download(info,path):
                    path.write_bytes(b'ply\nelement vertex 0\n'+b''.join(b'property float '+k+b'\n' for k in (b'x',b'y',b'z',b'scale_0',b'rot_0',b'opacity'))+b'end_header\n')
                    if cancel:store.update_job(job['id'],status='cancelled')
                client.download.side_effect=download
                runner=JobRunner(store,Mock())
                with patch.object(runner,'client',return_value=client),patch.object(runner,'open_ws',return_value=None),patch.object(runner,'monitor',return_value={'outputs':{'12':{'filename':['scene.ply']}}}):runner.run(job)
                final=store.snapshot()['jobs'][0]
                self.assertEqual(final['status'],'cancelled' if cancel else 'completed')
                self.assertEqual(len(store.data.get('splats',{})),0 if cancel else 1)
                self.assertEqual(len(list((Path(tmp)/'assets').glob('*.ply'))),0 if cancel else 1)
