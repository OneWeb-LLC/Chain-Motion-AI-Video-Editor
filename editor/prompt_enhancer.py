"""Image-aware prompt rewriting using the configured OpenAI-compatible endpoint."""
import base64
import io
import json
from pathlib import Path
import requests
from PIL import Image, ImageOps, UnidentifiedImageError
from .scene_writer import endpoint_url

PROMPT = Path(__file__).resolve().parent.parent/'prompts'/'EditPromptEnhancer.txt'


def image_content(source):
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((1280,1280))
            out = io.BytesIO();image.save(out,format='JPEG',quality=88)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError('The prompt improver needs a valid camera render and image references.') from e
    return dict(type='image_url',image_url={'url':'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()})


def improve(config, prompt, frame, refs, store):
    if not config.get('model'):raise ValueError('Configure a vision-capable language model in Scene Writer first.')
    endpoint=endpoint_url(config.get('endpoint',''))
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>30000:
        raise ValueError('Enter an editing prompt (up to 30,000 characters).')
    assets=store.snapshot()['assets']
    if not isinstance(refs,list) or len(refs)>9 or any(not isinstance(a,str) or assets.get(a,{}).get('kind')!='image' for a in refs):
        raise ValueError('Choose up to nine image references.')
    content=[dict(type='text',text="The user's edit instruction to rewrite is:\n"+prompt),dict(type='text',text='<image1>: Current camera render.'),image_content(io.BytesIO(frame))]
    for i,aid in enumerate(refs,2):
        content.extend([dict(type='text',text=f'<image{i}>: Additional reference.'),image_content(store.asset_path(assets[aid]))])
    payload=dict(model=config['model'],stream=False,messages=[dict(role='system',content=PROMPT.read_text()),dict(role='user',content=content)])
    if config.get('max_tokens') is not None:payload['max_tokens']=config['max_tokens']
    headers={'Content-Type':'application/json'}
    if config.get('api_key'):headers['Authorization']='Bearer '+config['api_key']
    try:response=requests.post(endpoint,json=payload,headers=headers,timeout=(10,900),allow_redirects=False)
    except requests.Timeout as e:raise ValueError('Prompt improvement timed out. Your original prompt is unchanged.') from e
    except requests.RequestException as e:raise ValueError('Cannot reach the configured language model. Your original prompt is unchanged.') from e
    if response.status_code in (401,403):raise ValueError('The language model rejected authentication. Check the API key in Scene Writer.')
    if response.status_code!=200:raise ValueError(f'The language model returned HTTP {response.status_code}. Check its image-input support.')
    try:
        choice=response.json()['choices'][0]
        if choice.get('finish_reason')=='length':raise ValueError('truncated')
        text=choice['message']['content'].strip()
        if text.startswith('```') and text.endswith('```'):text='\n'.join(text.splitlines()[1:-1])
        result=json.loads(text);rewrite=result['rewritten_prompt']
        if not isinstance(rewrite,str) or not rewrite.strip() or len(rewrite)>30000:raise ValueError('empty or oversized')
    except (ValueError,KeyError,TypeError,IndexError,AttributeError) as e:
        raise ValueError('The model returned an incomplete or invalid rewrite. Your prompt is unchanged. Check the model’s response limit and retry.') from e
    return dict(rewritten_prompt=' '.join(rewrite.splitlines()).strip())
