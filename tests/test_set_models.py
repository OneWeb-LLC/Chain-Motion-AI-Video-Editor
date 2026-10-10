import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI, UploadFile
from editor.store import Store
from editor.set_studio import install, validate_set
from editor.set_models import validate_glb

class ModelTests(unittest.TestCase):
    def test_import_save_reopen_and_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);app=FastAPI();install(app,store,None,None)
            route=lambda path:next(r.endpoint for r in app.routes if r.path==path)
            data=Path('static/models/quaternius/mannequin.glb').read_bytes()
            model=route('/api/set-studio/models/import')(UploadFile(filename='Character.glb',file=io.BytesIO(data)))
            obj=dict(id='character',name='Character',type='model',model_id=model['id'],position=[1,2,3],rotation=[0,1,0],scale=[2,2,2])
            doc=dict(name='GLB scene',objects=[obj],version=0)
            saved=route('/api/set-studio/sets/{sid}')('a'*32,doc)
            loaded=Store(tmp).snapshot();self.assertEqual(loaded['sets']['a'*32]['objects'][0],obj)
            self.assertEqual(route('/api/set-studio')()['models'][0]['id'],model['id'])
            self.assertEqual(Path(route('/api/set-studio/models/{mid}/file.glb')(model['id']).path).read_bytes(),data)
            with self.assertRaises(ValueError):validate_set(doc,{}, {})

    def test_glb_parenting_persists_and_validates_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);store.data['set_models']={'mesh':dict(id='mesh')}
            app=FastAPI();install(app,store,None,None)
            save=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/sets/{sid}')
            person=dict(id='person',type='mannequin',name='Person',position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])
            prop=dict(id='prop',type='model',name='Prop',model_id='mesh',parent='person',part='rightHand',position=[.1,0,0],rotation=[0,1,0],scale=[2,2,2])
            doc=dict(name='Attached model',objects=[person,prop],version=0)
            save('b'*32,doc)
            self.assertEqual(Store(tmp).snapshot()['sets']['b'*32]['objects'][1],prop)
            for parent,part in [('missing','rightHand'),('prop','rightHand'),('person','invalid')]:
                prop.update(parent=parent,part=part)
                with self.assertRaises(ValueError):validate_set(doc,{},store.data['set_models'])
            prop.update(parent=None,part='rightHand')
            validate_set(doc,{},store.data['set_models'])

    def test_invalid_import_cleans_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);app=FastAPI();install(app,store,None,None)
            upload=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/models/import')
            with self.assertRaises(ValueError):upload(UploadFile(filename='bad.glb',file=io.BytesIO(b'bad')))
            self.assertEqual(list((store.root/'assets').glob('*.glb')),[])
            self.assertFalse(store.snapshot().get('set_models'))

    def test_reject_external_resources_and_compression(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'test.glb'
            for extra in [dict(buffers=[dict(uri='https://example.com/model.bin')]),dict(images=[dict(uri='../texture.png')]),dict(extensionsRequired=['KHR_draco_mesh_compression'])]:
                chunk=json.dumps(dict(asset={'version':'2.0'},meshes=[{}],**extra)).encode();chunk+=b' '*((-len(chunk))%4)
                path.write_bytes(struct.pack('<5I',0x46546c67,2,20+len(chunk),len(chunk),0x4e4f534a)+chunk)
                with self.assertRaises(ValueError):validate_glb(path)
