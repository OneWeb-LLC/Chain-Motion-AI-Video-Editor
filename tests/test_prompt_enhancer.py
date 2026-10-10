import io
import json
import tempfile
import unittest
from unittest.mock import Mock, patch
from PIL import Image
from editor.store import Store
from editor.prompt_enhancer import improve, PROMPT

class PromptEnhancerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(self.tmp.name)
        out=io.BytesIO();Image.new('RGB',(32,32),'red').save(out,format='PNG');self.frame=out.getvalue()
        path=self.store.root/'assets'/'ref.png';Image.new('RGB',(32,32),'blue').save(path)
        self.store.data['assets']['ref']=dict(kind='image',file='assets/ref.png')
        self.config=dict(endpoint='http://localhost:1234/v1',model='vision',max_tokens=None)

    def response(self,text,finish='stop'):
        return Mock(status_code=200,json=lambda:dict(choices=[dict(message=dict(content=text),finish_reason=finish)]))

    @patch('editor.prompt_enhancer.requests.post')
    def test_exact_system_prompt_and_ordered_images(self,post):
        post.return_value=self.response(json.dumps(dict(rewritten_prompt='Change the coat.\nKeep the pose.',wh_ratio='',ratio_follow='<image1>')))
        result=improve(self.config,'Change coat',self.frame,['ref'],self.store)
        self.assertEqual(result['rewritten_prompt'],'Change the coat. Keep the pose.')
        payload=post.call_args.kwargs['json'];self.assertEqual(payload['messages'][0]['content'],PROMPT.read_text())
        content=payload['messages'][1]['content'];self.assertIn('<image1>',content[1]['text']);self.assertIn('<image2>',content[3]['text'])
        self.assertNotEqual(content[2]['image_url'],content[4]['image_url']);self.assertNotIn('max_tokens',payload)
        self.assertFalse(post.call_args.kwargs['allow_redirects'])

    @patch('editor.prompt_enhancer.requests.post')
    def test_reject_bad_or_truncated_results(self,post):
        for text,finish in [('plain text','stop'),('{}','stop'),('{"rewritten_prompt":""}','stop'),('{"rewritten_prompt":"ok"}','length')]:
            post.return_value=self.response(text,finish)
            with self.assertRaisesRegex(ValueError,'unchanged'):improve(self.config,'Edit',self.frame,[],self.store)

    @patch('editor.prompt_enhancer.requests.post')
    def test_validation_before_request(self,post):
        for prompt,frame,refs in [('',self.frame,[]),('Edit',b'bad',[]),('Edit',self.frame,['missing']),('Edit',self.frame,['ref']*10)]:
            with self.assertRaises(ValueError):improve(self.config,prompt,frame,refs,self.store)
        post.assert_not_called()

    @patch('editor.prompt_enhancer.requests.post')
    def test_route_multipart(self,post):
        from fastapi import FastAPI
        from fastapi import UploadFile
        from editor.set_studio import install
        from editor.scene_writer import save_config
        save_config(self.store.root,self.config)
        app=FastAPI();install(app,self.store,None,None)
        post.return_value=self.response('{"rewritten_prompt":"Preserve the pose."}')
        route=next(r.endpoint for r in app.routes if r.path=='/api/set-studio/improve-prompt')
        response=route(UploadFile(filename='camera.png',file=io.BytesIO(self.frame)),'Edit','["ref"]')
        self.assertEqual(response['rewritten_prompt'],'Preserve the pose.')
        self.assertEqual(len(self.store.data['assets']),1)
