"""API graph for the supplied Qwen_image_2.1_00071 editing workflow."""
import json
from pathlib import Path
WORKFLOW=Path(__file__).resolve().parent.parent/'Work Flows'/'Qwen_image_2.1_00071.json'
def image_graph(images,prompt,seed,prefix):
    if not 1<=len(images)<=10:raise ValueError('Qwen accepts the render plus up to nine references.')
    w=json.loads(WORKFLOW.read_text());outer=next(n for n in w['nodes'] if n['id']==459)['widgets_values']
    def node(kind,**inputs):return dict(class_type=kind,inputs=inputs)
    g={
        'model':node('UNETLoader',unet_name=outer[11],weight_dtype='default'),
        'clip':node('CLIPLoader',clip_name=outer[12],type='qwen_image',device='default'),
        'vae':node('VAELoader',vae_name=outer[13]),
        'cache':node('QwenImage21Cache',model=['model',0],device='auto',dtype='default'),
        'encode':node('TextEncodeQwenImage21',clip=['clip',0],vae=['vae',0],prompt=prompt,negative_prompt=outer[2],resolution=0),
        'sample':node('KSampler',model=['cache',0],positive=['encode',0],negative=['encode',1],latent_image=['encode',2],seed=seed,steps=outer[4],cfg=outer[3],sampler_name=outer[8],scheduler=outer[9],denoise=1),
        'decode':node('VAEDecode',samples=['sample',0],vae=['vae',0]),
        'save':node('SaveImageAdvanced',images=['decode',0],filename_prefix=prefix,format='png',**{'format.bit_depth':'8-bit','format.input_color_space':'sRGB'})}
    for i,image in enumerate(images,1):
        g[f'image_{i}']=node('LoadImage',image=image)
        g['encode']['inputs'][f'images.image_{i}']=[f'image_{i}',0]
    return g
