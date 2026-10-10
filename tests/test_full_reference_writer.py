import tempfile
import unittest
from unittest.mock import Mock, patch
from editor import scene_writer as writer
from editor.store import Store


def candidate():
    prompt = '''subject_definitions:
<Subject 1> is the woman in <Picture 1>, wearing a blue coat.
summary:
[reference generation] <Subject 1> greets the viewer.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - blue coat and appearance.
detailed_description:
Cinematic realism with cool lighting.
[Shot 1] <Subject 1> (S1) smiles and says, <d>[French] Bonjour!</d>
[Shot 2] At 00:02.000, a close-up shows her wave.
overall_soundscape:
Quiet room tone.
non_diegetic_music:
N/A'''
    return '[SCENE START]\nSHOT_COUNT: 2\n[SEGMENT 1]\n'+prompt+'\n[SEGMENT 2]\n'+prompt+'\n[SCENE END]'


class FullReferenceTests(unittest.TestCase):
    def test_six_sections_internal_shots_and_dialogue_preserved(self):
        parsed=writer.parse_script(candidate())
        self.assertEqual(parsed['shot_count'],2)
        self.assertEqual(parsed['format'],'full-reference')
        for shot in parsed['shots']:
            self.assertTrue(shot['prompt'].startswith('subject_definitions:'))
            self.assertNotIn('[SEGMENT',shot['prompt'])
            self.assertIn('[Shot 2] At 00:02.000',shot['prompt'])
            self.assertIn('<d>[French] Bonjour!</d>',shot['prompt'])
        self.assertEqual(parsed['carryover'],parsed['shots'][-1]['prompt'])

    def test_missing_sections_are_rejected(self):
        for name in writer.REFERENCE_FIELDS:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, name):
                writer.parse_script(candidate().replace(name+':', 'unrecognized:'))

    def test_generate_request_and_approval(self):
        from editor import server
        with tempfile.TemporaryDirectory() as root:
            store=Store(root);project=next(iter(store.data['projects'].values()))
            response=Mock(status_code=200)
            response.json.return_value={'choices':[{'message':{'content':candidate()},'finish_reason':'stop'}]}
            with patch('editor.scene_writer.requests.post',return_value=response) as post:
                result=writer.generate(dict(endpoint='http://localhost:1234',model='test'),dict(request='A greeting',duration=4),store)
            messages=post.call_args.kwargs['json']['messages']
            self.assertIn('TARGET_SEGMENT_SECONDS: 4.0',messages[1]['content'])
            self.assertIn('retention_analysis',messages[0]['content'])
            self.assertEqual(len(store.data['projects'][project['id']]['scenes']),1)
            store.data['assets']['ref']=dict(kind='image')
            with patch.object(server,'store',store):
                out=server.writer_approve(dict(project_id=project['id'],version=project['version'],approval_id='c'*32,name='Greeting',script=result['script'],refs=['ref'],duration=4,overlap=22,connected=True))
            segments=out['project']['scenes'][-1]['segments']
            self.assertEqual(len(segments),2)
            self.assertEqual(segments[0]['prompt'],result['parsed']['shots'][0]['prompt'])
            self.assertEqual(segments[1]['refs'],['ref'])
            self.assertTrue(segments[1]['connected'])
            self.assertEqual(store.data['jobs'],[])

    def test_windows_newlines_and_indented_headers(self):
        text=candidate().replace('[SEGMENT', '  [Segment').replace('subject_definitions:', '  subject_definitions:').replace('\n', '\r\n')
        result=writer.parse_script(text)
        self.assertEqual(result['shot_count'],2)
        self.assertIn('<d>[French] Bonjour!</d>', result['shots'][0]['prompt'])

    def test_formatting_counts_order_and_duplicates_do_not_block(self):
        variants = [
            candidate().replace('SHOT_COUNT: 2', 'SHOT_COUNT: 99'),
            candidate().replace('[SEGMENT 2]', '[SEGMENT 9]'),
            candidate().replace('[Shot 2]', '[Shot 9]'),
            candidate().replace('[SCENE END]', ''),
            candidate().replace('Quiet room tone.', ''),
            candidate().replace('summary:', 'overall_soundscape: Preliminary notes.\nsummary:'),
        ]
        for text in variants:
            with self.subTest(text=text):
                result=writer.parse_script(text)
                self.assertEqual(len(result['shots']),2)

    def test_bare_markdown_prompt_can_have_any_order_and_intro(self):
        text='Here is your prompt.\n\n'+ '\n\n'.join('## **'+name.replace('_',' ').title()+'**\nContent.' for name in reversed(writer.REFERENCE_FIELDS))
        result=writer.parse_script(text)
        self.assertEqual(result['shot_count'],1)
        self.assertEqual(result['shots'][0]['prompt'],text)

    def test_duplicate_content_is_preserved(self):
        text=candidate().replace('summary:', 'overall_soundscape: Preliminary ambience.\nsummary:')
        result=writer.parse_script(text)
        for shot in result['shots']:
            self.assertIn('Preliminary ambience.',shot['prompt'])
            self.assertIn('Quiet room tone.',shot['prompt'])

    def test_each_segment_must_have_sections(self):
        text=candidate().replace('non_diegetic_music:', 'other:',1)
        with self.assertRaisesRegex(ValueError,'Prompt 1.*non_diegetic_music'):
            writer.parse_script(text)
