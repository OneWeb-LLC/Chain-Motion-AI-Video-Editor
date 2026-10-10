import copy
import tempfile
import unittest
from unittest.mock import Mock,patch
from editor.store import Store,segment,check_project
from editor.comfy import JobRunner

class SegmentAudioTrimTests(unittest.TestCase):
    def test_shared_reference_trim_is_segment_specific_and_snapshotted(self):
        from editor import server,cloud
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);p=next(iter(s.data['projects'].values()));sc=p['scenes'][0];first=sc['segments'][0]
            second=segment();sc['segments'].append(second);sc['refs']=['audio']
            first.update(prompt='First',audio_trims={'audio':{'start':1,'end':2}});second['prompt']='Second'
            s.data['assets']['audio']=dict(id='audio',kind='audio',duration=4)
            cloud.save_config(tmp,{'api_key':'test'})
            with patch.object(server,'store',s):
                for target in ['local','cloud']:
                    jobs=server.queue(dict(project_id=p['id'],segment_ids=[first['id'],second['id']],inference=target))
                    self.assertEqual(jobs[0]['spec']['audio_trims']['audio'],dict(start=1,end=2))
                    self.assertNotIn('audio_trims',jobs[1]['spec'])
                    self.assertEqual(jobs[0]['spec']['refs'],['audio'])
            first['audio_trims']['audio']['end']=3
            self.assertEqual(jobs[0]['spec']['audio_trims']['audio']['end'],2)
            for trim in [dict(start=-1,end=2),dict(start=2,end=2),dict(start=0,end=5),dict(start=0,end=float('nan'))]:
                first['audio_trims']['audio']=trim
                with self.assertRaises(ValueError):check_project(p,s.data['assets'])

    def test_upload_uses_trimmed_copy_and_cleans_it_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);s.data['jobs']=[dict(id='job',status='preparing')]
            path=s.root/'assets'/'original.wav';path.write_bytes(b'original')
            a=dict(id='audio',kind='audio',duration=4)
            c=Mock();c.upload.return_value='remote.wav'
            spec=dict(audio_trims={'audio':dict(start=1,end=2)})
            def trim(src,dest,start,end):dest.write_bytes(b'trimmed')
            def upload(p):self.assertEqual(p.read_bytes(),b'trimmed');return 'remote.wav'
            c.upload.side_effect=upload
            with patch('editor.comfy.media.trim_audio',side_effect=trim) as run:
                result=JobRunner(s,Mock()).upload_audio_reference(c,a,path,spec,'job')
            self.assertEqual(result,'remote.wav')
            self.assertEqual(run.call_args.args[-2:],(1,2))
            self.assertFalse(c.upload.call_args.args[0].exists())
            self.assertEqual(path.read_bytes(),b'original')
