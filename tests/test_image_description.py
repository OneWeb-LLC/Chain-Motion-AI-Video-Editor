import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from PIL import Image
from editor import scene_writer as writer
from editor.store import Store

class ImageDescriptionTests(unittest.TestCase):
    def test_vision_request_and_saved_editable_description(self):
        from editor import server
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);path=Path(tmp)/'assets'/'ref.png';Image.new('RGB',(24,24)).save(path)
            s.data['assets']['ref']=dict(id='ref',kind='image',file='assets/ref.png',name='Reference')
            writer.save_config(tmp,dict(endpoint='http://localhost:1234',model='vision',api_key='secret'))
            response=Mock(status_code=200);response.json.return_value={'choices':[{'message':{'content':'A blue coat.'},'finish_reason':'stop'}]}
            with patch.object(server,'store',s),patch('editor.scene_writer.requests.post',return_value=response) as post:
                self.assertEqual(server.describe_asset('ref'),{'description':'A blue coat.'})
                self.assertEqual(s.data['assets']['ref']['description'],'A blue coat.')
                payload=post.call_args.kwargs['json']
                self.assertEqual(payload['model'],'vision')
                self.assertTrue(payload['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,'))
                self.assertNotIn('SCENE START',payload['messages'][0]['content'])
                server.edit_asset('ref',{'description':'Edited description'})
                self.assertEqual(Store(tmp).data['assets']['ref']['description'],'Edited description')
                self.assertEqual(s.data['jobs'],[])

    def test_non_image_and_missing_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp)
            with self.assertRaisesRegex(ValueError,'image asset'):writer.describe_image({},dict(kind='video'),s)
            with self.assertRaisesRegex(ValueError,'Configure'):writer.describe_image({},dict(kind='image'),s)

    def test_failure_preserves_previous_description(self):
        from editor import server
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);s.data['assets']['ref']=dict(kind='image',description='Original')
            with patch.object(server,'store',s),patch('editor.scene_writer.describe_image',side_effect=ValueError('Unavailable')):
                with self.assertRaises(ValueError):server.describe_asset('ref')
            self.assertEqual(s.data['assets']['ref']['description'],'Original')
