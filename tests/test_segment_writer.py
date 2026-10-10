import copy
import tempfile
import unittest
from unittest.mock import patch, Mock
from editor import server, scene_writer
from editor.store import Store
from test_scene_writer import script

class SegmentWriterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(self.tmp.name)
        self.p=next(iter(self.store.data['projects'].values()))
        self.seg=self.p['scenes'][0]['segments'][0]
        self.store.data['assets'].update(old=dict(kind='image'),new=dict(kind='image'),audio=dict(kind='audio'))
        self.seg.update(refs=['old','audio'],prompt='Original',duration=5,seed=123)
        self.body=dict(project_id=self.p['id'],version=self.p['version'],segment_id=self.seg['id'],approval_id='a'*32,script=script(1),refs=['new'])
        self.patcher=patch.object(server,'store',self.store);self.patcher.start();self.addCleanup(self.patcher.stop)

    def test_updates_only_target_prompt_and_images_and_retry_is_idempotent(self):
        result=server.writer_approve(self.body)
        scenes=result['project']['scenes'];self.assertEqual(len(scenes),1)
        self.assertEqual(len(scenes[0]['segments']),1)
        updated=scenes[0]['segments'][0]
        self.assertEqual(updated['id'],self.seg['id'])
        self.assertEqual(updated['refs'],['new','audio'])
        self.assertNotEqual(updated['prompt'],'Original')
        for key in ['duration','seed','main','takes','connected','overlap']:
            self.assertEqual(updated[key],self.seg[key])
        again=server.writer_approve(self.body)
        self.assertEqual(again['project']['version'],result['project']['version'])
        self.assertEqual(again['segment_id'],self.seg['id'])

    def test_missing_target_does_not_mutate_project(self):
        before=copy.deepcopy(self.store.data['projects'])
        for body in [{**self.body,'segment_id':'missing'}]:
            with self.assertRaises(ValueError):server.writer_approve(body)
            self.assertEqual(self.store.data['projects'],before)

    def test_generation_requests_one_segment(self):
        response=Mock(status_code=200)
        response.json.return_value={'choices':[{'message':{'content':script(1)}}]}
        with patch('editor.scene_writer.requests.post',return_value=response) as post:
            scene_writer.generate(dict(endpoint='http://localhost:1234',model='test'),dict(request='A tracking shot',segment_id=self.seg['id']),self.store)
        self.assertIn('exactly one [SEGMENT 1]',post.call_args.kwargs['json']['messages'][1]['content'])

    def test_multiple_prompt_blocks_populate_only_the_target_segment(self):
        result=server.writer_approve({**self.body,'script':script(2)})
        segments=result['project']['scenes'][0]['segments']
        self.assertEqual(len(segments),1)
        self.assertIn('[SHOT 1]',segments[0]['prompt'])
        self.assertIn('[SHOT 2]',segments[0]['prompt'])
