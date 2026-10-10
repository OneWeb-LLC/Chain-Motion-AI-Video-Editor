import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from fastapi import HTTPException
from PIL import Image
from editor import scene_writer as writer
from editor.store import Store


def script(count=2):
    text=f'''[SCENE START]
SEGMENT: 1
SHOT_COUNT: {count}
[STYLE]
LOOK: Warm daylight.
[CHARACTERS]
CHAR_1: the woman in blue | adult | brown hair | blue coat | freckles
[SETTING]
PLACE: A station.
TIME: Morning.
DETAILS: A wooden bench.
'''
    for n in range(1,count+1):
        text+=f'''[SHOT {n}]
STYLE: Warm daylight.
CAST: CHAR_1: the woman in blue | adult | brown hair | blue coat | freckles
SETTING: A station. Morning. A wooden bench.
CAMERA: Close framing, slow push in.
ACTION: The woman in blue lifts a bag.
EMOTION: A tight jaw.
'''
        if n==1:
            text+='''[DIALOGUE 1]
SPEAKER: CHAR_1, the woman in blue, left
TONE: Quiet.
LINE: "Time to go."
[SOUND 1]
AMBIENT: Wind.
EFFECTS: Bag rustles.
'''
        text+=f'''[CONTINUITY {n}]
CHARACTERS: CHAR_1: the woman in blue | adult | brown hair | blue coat | freckles
SETTING: A station. Morning. A wooden bench.
STATE: The woman holds a bag.
LAST_FRAME: A hand grips the bag.
THREAD: The train approaches.
NEXT: {f'SHOT {n+1}' if n<count else 'SEGMENT END'}
'''
    return text+'[TRANSITION]\nOUT: Cut to black.\n[SCENE END]'


class ParserTests(unittest.TestCase):
    def test_numbered_shots_and_optional_blocks(self):
        out=writer.parse_script(script())
        self.assertEqual(out['shot_count'],2)
        self.assertIn('Time to go.',out['shots'][0]['prompt'])
        self.assertIn('[SOUND 1]',out['shots'][0]['prompt'])
        for shot in out['shots']:
            self.assertNotIn('[CONTINUITY ',shot['prompt'])
            self.assertIn(f'[CONTINUITY {shot["number"]}]',shot['continuity'])
        self.assertNotIn('DIALOGUE',out['shots'][1]['prompt'])
        self.assertIn('CONTINUITY 2',out['carryover'])
    def test_rejects_bad_numbering_and_incomplete_candidates(self):
        bad=[script().replace('[SHOT 2]','[SHOT 3]'),script().replace('[DIALOGUE 1]','[DIALOGUE 2]'),script().replace('SHOT_COUNT: 2','SHOT_COUNT: 3'),script().replace('[CONTINUITY 2]','[CONTINUITY 1]'),script().replace('[SCENE END]',''),script().replace('NEXT: SHOT 2','NEXT: SHOT 4')]
        for value in bad:
            with self.subTest(value=value[-40:]),self.assertRaises(ValueError):writer.parse_script(value)
    def test_fenced_candidate(self):
        self.assertEqual(writer.parse_script('```text\n'+script()+'\n```')['shot_count'],2)


class EndpointTests(unittest.TestCase):
    def test_output_limit_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=dict(endpoint='http://localhost:1234',model='test')
            self.assertIsNone(writer.save_config(tmp,config)['max_tokens'])
            self.assertEqual(writer.save_config(tmp,{**config,'max_tokens':24000})['max_tokens'],24000)
            self.assertEqual(writer.save_config(tmp,config)['max_tokens'],24000)
            self.assertIsNone(writer.save_config(tmp,{**config,'max_tokens':None})['max_tokens'])
            for invalid in [0,-1,1.5,True,'24000',1000001]:
                with self.subTest(limit=invalid),self.assertRaises(ValueError):
                    writer.save_config(tmp,{**config,'max_tokens':invalid})

    def test_default_and_custom_request_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            response=Mock(status_code=200)
            response.json.return_value={'choices':[{'message':{'content':script()},'finish_reason':'stop'}]}
            for extra in [{},{'max_tokens':None},{'max_tokens':24000}]:
                with self.subTest(config=extra),patch('editor.scene_writer.requests.post',return_value=response) as post:
                    writer.generate(dict(endpoint='http://localhost:1234',model='test',**extra),dict(request='Test'),Store(tmp))
                    payload=post.call_args.kwargs['json']
                    if extra.get('max_tokens') is None:self.assertNotIn('max_tokens',payload)
                    else:self.assertEqual(payload['max_tokens'],24000)
                    self.assertEqual(post.call_args.kwargs['timeout'],(10,900))

    def test_length_finish_preserves_valid_candidate_and_rejects_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            for candidate in [script(),script().replace('[SCENE END]','')]:
                response=Mock(status_code=200)
                response.json.return_value={'choices':[{'message':{'content':candidate},'finish_reason':'length'}]}
                with patch('editor.scene_writer.requests.post',return_value=response):
                    out=writer.generate(dict(endpoint='http://localhost:1234',model='test'),dict(request='Test'),Store(tmp))
                self.assertEqual(out['script'],candidate)
                if candidate.endswith('[SCENE END]'):
                    self.assertNotIn('parse_error',out)
                    self.assertIn('length limit',out['parsed']['warnings'][0])
                else:
                    self.assertNotIn('parsed',out)
                    self.assertIn('length limit',out['parse_error'])

    def test_endpoint_normalization(self):
        for value in ['http://localhost:1234','http://localhost:1234/v1/','http://localhost:1234/v1/chat/completions']:
            self.assertEqual(writer.endpoint_url(value),'http://localhost:1234/v1/chat/completions')
        with self.assertRaises(ValueError):writer.endpoint_url('file:///etc/passwd')
    def test_secret_is_not_returned_or_reused_for_new_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            public=writer.save_config(tmp,dict(endpoint='http://localhost:1234',model='vision',api_key='test-secret'))
            self.assertNotIn('api_key',public)
            self.assertTrue(public['has_api_key'])
            writer.save_config(tmp,dict(endpoint='http://localhost:1234/v1',model='vision'))
            self.assertEqual(writer.read_config(tmp)['api_key'],'test-secret')
            writer.save_config(tmp,dict(endpoint='http://localhost:1235',model='vision'))
            self.assertEqual(writer.read_config(tmp)['api_key'],'')
    def test_multimodal_payload_and_candidate_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);path=Path(tmp)/'assets'/'ref.png';Image.new('RGB',(20,20)).save(path)
            s.data['assets']['ref']=dict(id='ref',name='Station',kind='image',file='assets/ref.png')
            before=copy.deepcopy(s.data['projects'])
            response=Mock(status_code=200)
            response.json.return_value={'choices':[{'message':{'content':script()},'finish_reason':'stop'}]}
            with patch('editor.scene_writer.requests.post',return_value=response) as post:
                result=writer.generate(dict(endpoint='http://localhost:1234/v1',model='vision',api_key='test-key'),dict(request='A woman at a station',refs=['ref']),s)
            payload=post.call_args.kwargs['json']
            self.assertEqual(payload['messages'][0]['content'],writer.PROMPT.read_text())
            self.assertTrue(payload['messages'][1]['content'][-1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
            self.assertEqual(result['parsed']['shot_count'],2)
            self.assertEqual(before,s.data['projects'])
    def test_invalid_response_is_kept_for_editing(self):
        with tempfile.TemporaryDirectory() as tmp:
            response=Mock(status_code=200);response.json.return_value={'choices':[{'message':{'content':'Incomplete script'}}]}
            with patch('editor.scene_writer.requests.post',return_value=response):
                out=writer.generate(dict(endpoint='http://localhost:1234',model='test'),dict(request='Test'),Store(tmp))
            self.assertEqual(out['script'],'Incomplete script');self.assertIn('parse_error',out)


class ApprovalTests(unittest.TestCase):
    def test_approval_is_atomic_idempotent_and_preserves_existing_scenes(self):
        from editor import server
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);p=next(iter(s.data['projects'].values()))
            s.data['assets']['ref']=dict(kind='image')
            body=dict(project_id=p['id'],version=p['version'],approval_id='a'*32,name='Station',script=script(),refs=['ref'],duration=4,overlap=39,connected=True)
            with patch.object(server,'store',s):
                out=server.writer_approve(body)
                again=server.writer_approve(body)
                self.assertEqual(out['scene_id'],again['scene_id'])
                scenes=out['project']['scenes'];self.assertEqual(len(scenes),2)
                self.assertEqual(scenes[0],p['scenes'][0])
                self.assertEqual(scenes[1]['refs'],[])
                self.assertEqual(scenes[1]['segments'][0]['refs'],['ref'])
                self.assertEqual(scenes[1]['segments'][1]['refs'],['ref'])
                self.assertIsNot(scenes[1]['segments'][0]['refs'],scenes[1]['segments'][1]['refs'])
                shots=scenes[1]['segments']
                self.assertEqual([x['connected'] for x in shots],[False,True])
                self.assertNotIn('[CONTINUITY ',shots[1]['prompt'])
                self.assertIn('[CONTINUITY 2]',shots[1]['writer_continuity'])
                self.assertEqual(shots[1]['duration'],4)
                self.assertEqual(shots[1]['overlap'],39)
                self.assertEqual(s.data['jobs'],[])
                stale={**body,'approval_id':'b'*32}
                with self.assertRaises(HTTPException):server.writer_approve(stale)
                invalid={**stale,'version':out['project']['version'],'script':'invalid'}
                with self.assertRaises(ValueError):server.writer_approve(invalid)
                self.assertEqual(len(s.data['projects'][p['id']]['scenes']),2)


class ModelDiscoveryTests(unittest.TestCase):
    def test_normalized_url_models_and_saved_key(self):
        saved=dict(endpoint='http://localhost:1234/v1/chat/completions',api_key='saved-key')
        response=Mock(status_code=200)
        response.json.return_value={'data':[{'id':'z-model'},{'id':'a-model'},{'id':'z-model'},{'id':None}]}
        with patch('editor.scene_writer.requests.get',return_value=response) as get:
            result=writer.discover_models(saved,dict(endpoint='http://localhost:1234/v1'))
        self.assertEqual(result['models'],['a-model','z-model'])
        self.assertEqual(get.call_args.args[0],'http://localhost:1234/v1/models')
        self.assertEqual(get.call_args.kwargs['headers'],{'Authorization':'Bearer saved-key'})
        self.assertFalse(get.call_args.kwargs['allow_redirects'])

    def test_changed_endpoint_does_not_receive_saved_key(self):
        response=Mock(status_code=200);response.json.return_value={'data':[]}
        with patch('editor.scene_writer.requests.get',return_value=response) as get:
            writer.discover_models(dict(endpoint='http://old/v1/chat/completions',api_key='secret'),dict(endpoint='http://new/v1'))
        self.assertEqual(get.call_args.kwargs['headers'],{})

    def test_discovery_errors_and_empty_list(self):
        for code,message in [(401,'valid API key'),(404,'manually')]:
            with patch('editor.scene_writer.requests.get',return_value=Mock(status_code=code)):
                with self.assertRaisesRegex(ValueError,message):writer.discover_models({},dict(endpoint='http://localhost:1234'))
        response=Mock(status_code=200);response.json.return_value={'data':[]}
        with patch('editor.scene_writer.requests.get',return_value=response):
            self.assertEqual(writer.discover_models({},dict(endpoint='http://localhost:1234')),{'models':[]})


class HeaderTimeRecoveryTests(unittest.TestCase):
    def test_missing_header_time_recovered_from_all_shots(self):
        value=script().replace('TIME: Morning.\n','',1).replace('SETTING: A station. Morning. A wooden bench.','SETTING: PLACE: A station. | TIME: Morning. | DETAILS: A wooden bench.')
        result=writer.parse_script(value)
        self.assertEqual(result['shot_count'],2)
        self.assertIn('Morning.',result['warnings'][0])
        self.assertIn('TIME: Morning.',result['shots'][0]['prompt'])

    def test_conflicting_or_missing_shot_times_not_guessed(self):
        value=script().replace('TIME: Morning.\n','',1).replace('SETTING: A station. Morning. A wooden bench.','SETTING: PLACE: A station. | TIME: Morning. | DETAILS: A wooden bench.')
        for changed in [value.replace('TIME: Morning.','TIME: Night.',1),value.replace('TIME: Morning.','',1)]:
            with self.assertRaisesRegex(ValueError,'Scene header.*TIME'):
                writer.parse_script(changed)

    def test_blank_time_does_not_consume_next_field(self):
        with self.assertRaisesRegex(ValueError,'Scene header.*TIME'):
            writer.parse_script(script().replace('TIME: Morning.','TIME:'))

    def test_explicit_header_time_does_not_need_recovery(self):
        self.assertEqual(writer.parse_script(script())['warnings'],[])


class WriterReferenceTests(unittest.TestCase):
    def test_legacy_references_are_independent_and_migration_is_one_time(self):
        from editor.store import migrate_writer_references,project,segment
        p=project();sc=p['scenes'][0]
        sc.update(refs=['shared'],writer={'script':'old'})
        sc['segments'].append(segment())
        sc['segments'][0]['refs']=['extra','shared']
        self.assertTrue(migrate_writer_references(p))
        self.assertEqual(sc['refs'],[])
        self.assertEqual(sc['segments'][0]['refs'],['shared','extra'])
        sc['segments'][0]['refs'].remove('shared')
        self.assertEqual(sc['segments'][1]['refs'],['shared'])
        sc['refs']=['manually-shared-later']
        self.assertFalse(migrate_writer_references(p))
        self.assertEqual(sc['refs'],['manually-shared-later'])

    def test_ordinary_scene_shared_refs_unchanged(self):
        from editor.store import migrate_writer_references,project
        p=project();p['scenes'][0]['refs']=['shared']
        self.assertFalse(migrate_writer_references(p))
        self.assertEqual(p['scenes'][0]['refs'],['shared'])
