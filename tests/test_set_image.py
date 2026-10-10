import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from fastapi import FastAPI
from editor.store import Store,uid
from editor.set_image import image_graph
from editor.set_studio import install
from editor.comfy import JobRunner
from editor.workflows import validate_graph

class SetImageTests(unittest.TestCase):
    def test_numbered_references_and_supplied_defaults(self):
        g=image_graph([f'{i}.png' for i in range(10)],'Use image 1',12,'set/test')
        self.assertEqual(g['image_1']['inputs']['image'],'0.png')
        self.assertEqual(g['encode']['inputs']['images.image_10'],['image_10',0])
        self.assertEqual(g['sample']['inputs']['steps'],25)
        self.assertEqual(g['sample']['inputs']['latent_image'],['encode',2])
        self.assertEqual(g['encode']['inputs']['resolution'],0)
        with self.assertRaises(ValueError):image_graph(['x']*11,'',0,'x')
        with self.assertRaises(ValueError):image_graph([],'',0,'x')
        one=image_graph(['frame.png'],'x',1,'x')
        self.assertNotIn('images.image_2',one['encode']['inputs'])

    def test_queue_validates_images_and_snapshots_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);store.data['assets']={'frame':dict(kind='image'),'ref':dict(kind='image'),'audio':dict(kind='audio')}
            app=FastAPI();factory=lambda kind,name,spec,snap,**extras:dict(id=uid(),kind=kind,spec=copy.deepcopy(spec),**extras)
            install(app,store,None,factory);queue=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/edit-image')
            body=dict(image_id='frame',refs=['ref'],prompt='Edit',seed=123,randomize_seed=False)
            j=queue(body);body['refs'].clear();self.assertEqual(j['spec']['refs'],['ref']);self.assertEqual(j['spec']['seed'],123)
            for change in [dict(refs=['ref']*10),dict(refs=['audio']),dict(prompt=' '),dict(seed=-1),dict(image_id='missing')]:
                with self.assertRaises(ValueError):queue({**body,**change})

    def test_png_result_saved_by_queue_runner(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp);job=dict(id=uid(),kind='set-image',name='Edit',status='recovering',prompt_id='remote',spec={},workflow='qwen-image-2.1-set');store.data['jobs'].append(job)
            client=Mock();client.download.side_effect=lambda info,path:path.write_bytes(b'png-fixture')
            def add(path,name,source):
                a=dict(id=uid(),kind='image',file=str(path.relative_to(store.root)));store.data['assets'][a['id']]=a;return a
            runner=JobRunner(store,add)
            with patch.object(runner,'client',return_value=client),patch.object(runner,'open_ws',return_value=None),patch.object(runner,'monitor',return_value={'outputs':{'save':{'images':[dict(filename='image.png',type='output',subfolder='')]}}}):runner.run(job)
            final=store.snapshot()['jobs'][0];self.assertEqual(final['status'],'completed');self.assertEqual(len(final['results']),1);self.assertEqual(store.data['assets'][final['results'][0]]['workflow'],'qwen-image-2.1-set')

    def test_autogrow_validation_rejects_broken_references(self):
        schema={'Encoder':{'input':{'required':{'images':['COMFY_AUTOGROW_V3',{'template':{'names':['image_1'],'min':1}}]}}},'LoadImage':{'input':{'required':{'image':['STRING',{}]}}}}
        graph={'encoder':dict(class_type='Encoder',inputs={'images.image_1':['image',0]}),'image':dict(class_type='LoadImage',inputs={'image':'x'})}
        validate_graph(graph,schema)
        graph['encoder']['inputs']['images.image_1']=['missing',0]
        with self.assertRaises(ValueError):validate_graph(graph,schema)
