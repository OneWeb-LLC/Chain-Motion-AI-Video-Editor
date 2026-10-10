import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from editor import cloud
from editor.comfy import JobRunner
from editor.store import Store,segment

class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        cloud.save_config(self.root,{'api_key':'test-secret'})
        self.c=cloud.CloudComfy(self.root)

    def test_credentials_private_and_clearable(self):
        self.assertEqual(cloud.save_config(self.root,{}),{'has_api_key':True})
        self.assertEqual((self.root/'comfy-cloud.json').stat().st_mode & 0o777,0o600)
        cloud.save_config(self.root,{'clear_key':True})
        with self.assertRaisesRegex(ValueError,'API key'):cloud.CloudComfy(self.root)

    def test_requests_authenticated_without_redirects(self):
        response=Mock(ok=True,is_redirect=False,content=b'{}');response.json.return_value={}
        with patch('editor.cloud.requests.request',return_value=response) as request:
            self.c.request('/prompt',{'prompt':{}},timeout=120)
        self.assertEqual(request.call_args.args,('POST',cloud.CLOUD_URL+'/prompt'))
        self.assertEqual(request.call_args.kwargs['headers'],{'X-API-Key':'test-secret'})
        self.assertFalse(request.call_args.kwargs['allow_redirects'])

    def test_storage_redirect_never_receives_key(self):
        redirect=Mock(is_redirect=True,headers={'Location':'https://storage.example/signed'})
        download=Mock();download.__enter__=Mock(return_value=download);download.__exit__=Mock(return_value=False)
        download.iter_content.return_value=[b'video']
        with patch('editor.cloud.requests.get',side_effect=[redirect,download]) as get:
            self.c.download({'filename':'take.mp4'},self.root/'take.mp4')
        self.assertNotIn('headers',get.call_args_list[1].kwargs)
        self.assertFalse(get.call_args_list[0].kwargs['allow_redirects'])
        self.assertEqual((self.root/'take.mp4').read_bytes(),b'video')

    def test_cloud_queue_routes_encoding_dependencies_without_keys(self):
        from editor import server
        s=Store(self.root);p=next(iter(s.data['projects'].values()));first=p['scenes'][0]['segments'][0]
        first.update(type='video',main='video',duration=3)
        s.data['assets']['video']=dict(id='video',kind='video',duration=4,name='Video')
        nxt=segment();nxt.update(prompt='Continue',connected=True);p['scenes'][0]['segments'].append(nxt)
        settings=copy.deepcopy(s.data['settings'])
        with patch.object(server,'store',s):
            jobs=server.queue(dict(project_id=p['id'],segment_ids=[nxt['id']],inference='cloud'))
        self.assertEqual([j['kind'] for j in jobs],['segment'])
        self.assertEqual(jobs[0]['guide_source']['asset_id'],'video')
        self.assertEqual(jobs[0]['workflow'],'h3-cloud-add-guide')
        self.assertTrue(all(j['inference']=='cloud' and j['comfy_url']==cloud.CLOUD_URL for j in jobs))
        self.assertNotIn('test-secret',str(s.snapshot()))
        self.assertEqual(s.data['settings'],settings)

    def test_cloud_terminal_states_and_cancellation(self):
        for status in ['completed','failed','cancelled']:
            with self.subTest(status=status):
                s=Store(self.root);j=dict(id='job',status='running',inference='cloud',prompt_id='owned',comfy_url=cloud.CLOUD_URL)
                s.data['jobs']=[j];runner=JobRunner(s,Mock());runner.stop=Mock();runner.stop.is_set.return_value=False
                c=Mock();c.request.return_value=dict(status=status,outputs={'video':{}},execution_error={'exception_message':'Invalid workflow'})
                if status=='failed':
                    with self.assertRaisesRegex(RuntimeError,'Invalid workflow'):runner.monitor(j,c,None)
                elif status=='completed':self.assertEqual(runner.monitor(j,c,None),{'outputs':{'video':{}}})
                else:
                    self.assertIsNone(runner.monitor(j,c,None));self.assertEqual(s.data['jobs'][0]['status'],'cancelled')
        s.data['jobs']=[{**j,'status':'running'}]
        with patch.object(runner,'client',return_value=c):runner.cancel('job')
        self.assertEqual(c.request.call_args.args,('/queue',{'delete':['owned']}))
        self.assertEqual(s.data['jobs'][0]['status'],'cancelled')

    def test_missing_cloud_nodes_fail_before_upload(self):
        s=Store(self.root);p=next(iter(s.data['projects'].values()));spec=p['scenes'][0]['segments'][0]
        spec['prompt']='Test'
        j=dict(id='job',status='preparing',kind='segment',inference='cloud',spec=spec,models=s.data['settings']['models'])
        s.data['jobs']=[j];c=Mock();c.request.return_value={}
        with self.assertRaisesRegex(ValueError,'Required nodes unavailable'):
            JobRunner(s,Mock()).prepare(j,c)
        c.upload.assert_not_called()

    def test_native_cloud_graph_and_chained_queue(self):
        from editor.workflows import h3_cloud_graph,DEFAULT_MODELS
        from editor import server
        s=Store(self.root);p=next(iter(s.data['projects'].values()));first=p['scenes'][0]['segments'][0];first['prompt']='First'
        nxt=segment();nxt.update(prompt='Next',connected=True);p['scenes'][0]['segments'].append(nxt)
        with patch.object(server,'store',s):
            jobs=server.queue(dict(project_id=p['id'],segment_ids=[first['id'],nxt['id']],inference='cloud'))
        self.assertEqual(jobs[1]['dependency'],jobs[0]['id'])
        for overlap in [22,39,56]:
            nxt['overlap']=overlap
            g=h3_cloud_graph(nxt,[],DEFAULT_MODELS,'test','tail.mp4')
            self.assertFalse(any('MotionContext' in n['class_type'] for n in g.values()))
            self.assertEqual(g['guide']['class_type'],'MiniMaxH3AddGuide')
            self.assertEqual(g['guide']['inputs']['frame_idx'],0)
            self.assertEqual(g['guide']['inputs']['audio'],['guide_parts',1])
            self.assertEqual(g['video']['inputs']['images'],['decode',0])
        g=h3_cloud_graph(first,[],DEFAULT_MODELS,'test')
        self.assertNotIn('guide',g)
        self.assertEqual(g['guider']['inputs']['conditioning'],['reference',0])

    def test_cloud_tail_uses_source_in_point_and_duration(self):
        from editor import server
        s=Store(self.root);p=next(iter(s.data['projects'].values()));spec=p['scenes'][0]['segments'][0];spec.update(prompt='Next',overlap=39)
        s.data['assets']['video']=dict(id='video',kind='video',duration=10,file='assets/test.mp4')
        j=dict(id='job',status='preparing',spec=spec,models=s.data['settings']['models'],guide_source=dict(asset_id='video',trim_in=2,duration=4))
        s.data['jobs']=[j];c=Mock();c.upload.return_value='tail.mp4'
        with patch('editor.comfy.validate_graph'),patch('editor.comfy.media.normalize_video') as normalize:
            graph,latent=JobRunner(s,Mock()).prepare_cloud(j,c,s.snapshot(),{})
        self.assertEqual(normalize.call_args.args[-2:],(39/24,6-39/24))
        self.assertIsNone(latent)
        self.assertEqual(graph['guide_video']['inputs']['file'],'tail.mp4')
