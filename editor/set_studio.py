"""Saved staging sets and the supplied WorldMirror V2 single-image workflow."""
import copy
import json
import math
import re
import secrets
import time
from pathlib import Path
from fastapi import HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from .store import uid

WORKFLOW=Path(__file__).resolve().parent.parent/'Work Flows'/'World-single-image-Gaussian-Splat.json'

def splat_graph(image, job_id, schema):
    workflow=json.loads(WORKFLOW.read_text())
    links={x[0]:x for x in workflow['links']};graph={}
    for node in workflow['nodes']:
        kind=node['type']
        if kind not in schema:raise ValueError('Install the supplied workflow’s missing node: '+kind)
        inputs={};widgets=iter(node.get('widgets_values',[]))
        node_inputs={x['name']:x for x in node.get('inputs',[])}
        for group in ('required','optional'):
            for name,rule in schema[kind].get('input',{}).get(group,{}).items():
                link=node_inputs.get(name,{}).get('link')
                if link is not None:
                    edge=links[link];inputs[name]=[str(edge[1]),edge[2]]
                elif isinstance(rule[0],list) or rule[0] in ('INT','FLOAT','BOOLEAN','STRING'):
                    if len(rule)>1 and rule[1].get('forceInput'):continue
                    try:inputs[name]=next(widgets)
                    except StopIteration:pass
        graph[str(node['id'])]=dict(class_type=kind,inputs=inputs)
    graph['8']['inputs']['image']=image
    graph['5']['inputs']['filename']='frameforge-set-'+job_id
    return graph

def ply_info(history):
    out=history.get('outputs',{}).get('12',{})
    def first(key,default=''):
        value=out.get(key,default)
        return value[0] if isinstance(value,list) and value else value
    name=first('filename')
    if not isinstance(name,str) or not name.lower().endswith('.ply'):raise ValueError('WorldMirror finished without a downloadable PLY. Check Background Preview output in ComfyUI.')
    return dict(filename=name,subfolder=first('subfolder'),type=first('type','output'))

def validate_ply(path):
    with open(path,'rb') as f:header=f.read(65536)
    if not header.startswith(b'ply\n') and not header.startswith(b'ply\r\n'):raise ValueError('Not a PLY file.')
    if b'end_header' not in header:raise ValueError('Invalid PLY header.')
    header=header.split(b'end_header')[0]
    if not all((' '+key).encode() in header for key in ['x','y','z','scale_0','rot_0','opacity']):
        raise ValueError('This PLY is a point cloud, not a Gaussian splat. Export Gaussian PLY with scale, rotation and opacity properties.')

def register_splat(store,path,name,source=None):
    validate_ply(path)
    item=dict(id=uid(),name=name,file=str(path.relative_to(store.root)),source_image=source,created=time.time())
    with store.lock:
        store.data.setdefault('splats',{})[item['id']]=item;store.save()
    return item

JOINTS={'hips','spine','chest','neck','head'} | {side+part for side in ('left','right') for part in ('Shoulder','Elbow','Hand','Hip','Knee','Foot')}

def validate_set(doc,splats,models=None):
    if not isinstance(doc,dict) or not isinstance(doc.get('name'),str) or len(doc['name'])>200:raise ValueError('Name the set (up to 200 characters).')
    objects=doc.get('objects',[])
    if not isinstance(objects,list) or len(objects)>300:raise ValueError('A set supports up to 300 objects.')
    if not re.fullmatch(r'#[a-fA-F0-9]{6}',doc.get('background','#20252b')):raise ValueError('Invalid background color.')
    ids=set()
    for obj in objects:
        if not isinstance(obj,dict) or obj.get('type') not in ('splat','mannequin','camera','box','sphere','cylinder','model'):raise ValueError('Unsupported set object.')
        oid=obj.get('id')
        if not isinstance(oid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',oid) or oid in ids:raise ValueError('Set object IDs must be unique.')
        ids.add(oid)
        if not isinstance(obj.get('name'),str) or len(obj['name'])>200:raise ValueError('Invalid object name.')
        if not re.fullmatch(r'#[a-fA-F0-9]{6}',obj.get('color','#c6b6a3')):raise ValueError('Invalid object color.')
        fov=obj.get('fov',50)
        if not isinstance(fov,(int,float)) or not 10<=fov<=120:raise ValueError('Camera field of view must be 10–120 degrees.')
        pose=obj.get('pose',{})
        if not isinstance(pose,dict) or any(key not in JOINTS or not isinstance(v,list) or len(v)!=3 or any(not isinstance(n,(int,float)) or not math.isfinite(n) for n in v) for key,v in pose.items()):raise ValueError('Invalid mannequin pose.')
        if obj['type']=='splat' and obj.get('splat_id') not in splats:raise ValueError('A set splat is missing.')
        if obj['type']=='model' and obj.get('model_id') not in (models or {}):raise ValueError('An imported GLB model is missing.')
        for key in ('position','rotation','scale'):
            v=obj.get(key)
            if not isinstance(v,list) or len(v)!=3 or any(not isinstance(n,(int,float)) or not math.isfinite(n) or abs(n)>100000 for n in v):raise ValueError('Invalid object transform.')
            if key=='scale' and any(n<=0 for n in v):raise ValueError('Scale must be greater than zero.')
    by_id={o['id']:o for o in objects}
    for obj in objects:
        parent=obj.get('parent')
        if parent:
            if not isinstance(parent,str) or obj.get('part','rightHand') not in JOINTS:raise ValueError('Invalid body part attachment.')
            if parent not in by_id or by_id[parent]['type']!='mannequin' or obj['type'] not in ('box','sphere','cylinder','model'):raise ValueError('Only primitives and GLB models can be attached to mannequins.')
    # Bound the remaining nested pose/settings data, rejecting non-finite JSON.
    if len(json.dumps(doc,allow_nan=False))>500000:raise ValueError('Set is too large.')
    return copy.deepcopy(doc)

def install(app,store,add_asset,job_record):
    @app.get('/api/set-studio')
    def list_sets():
        snap=store.snapshot()
        return dict(sets=list(snap.get('sets',{}).values()),splats=list(snap.get('splats',{}).values()),models=list(snap.get('set_models',{}).values()))

    @app.put('/api/set-studio/sets/{sid}')
    def save_set(sid:str,body:dict):
        if len(sid)!=32 or any(c not in '0123456789abcdef' for c in sid):raise ValueError('Invalid set ID.')
        with store.lock:
            doc=validate_set(body,store.data.get('splats',{}),store.data.get('set_models',{}));old=store.data.setdefault('sets',{}).get(sid)
            if old and body.get('version')!=old['version']:raise HTTPException(409,'Set changed elsewhere. Reopen it before saving.')
            doc.update(id=sid,version=(old or {}).get('version',0)+1,updated=time.time())
            store.data['sets'][sid]=doc;store.save()
        return doc

    @app.post('/api/set-studio/generate')
    def generate(body:dict):
        snap=store.snapshot();aid=body.get('image_id');a=snap['assets'].get(aid,{})
        if a.get('kind')!='image':raise ValueError('Select a scene image.')
        snap['settings']['inference']='local'
        j=job_record('splat','Set Studio · '+a['name'],dict(image_id=aid),snap)
        with store.lock:store.data['jobs'].append(j);store.save()
        return j

    @app.post('/api/set-studio/improve-prompt')
    def improve_prompt(file:UploadFile=File(...),prompt:str=Form(...),refs:str=Form('[]')):
        from . import prompt_enhancer, scene_writer
        try: ids=json.loads(refs)
        except ValueError as e:raise ValueError('Invalid image references.') from e
        frame=file.file.read(32*1024*1024+1)
        if len(frame)>32*1024*1024:raise ValueError('Render exceeds 32 MB.')
        return prompt_enhancer.improve(scene_writer.read_config(store.root),prompt,frame,ids,store)

    @app.post('/api/set-studio/edit-image')
    def edit_image(body:dict):
        snap=store.snapshot();refs=body.get('refs',[]);prompt=body.get('prompt','')
        if not isinstance(refs,list) or len(refs)>9 or any(not isinstance(x,str) for x in refs):raise ValueError('Choose up to nine extra image references.')
        ids=[body.get('image_id')]+refs
        if any(not isinstance(aid,str) or snap['assets'].get(aid,{}).get('kind')!='image' for aid in ids):raise ValueError('The render and all references must be images.')
        if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>30000:raise ValueError('Enter an image edit prompt (up to 30,000 characters).')
        seed=secrets.randbelow(2**53) if body.get('randomize_seed',True) else body.get('seed',42)
        if not isinstance(seed,int) or isinstance(seed,bool) or not 0<=seed<2**53:raise ValueError('Invalid seed.')
        snap['settings']['inference']='local'
        spec=dict(image_id=ids[0],refs=refs,prompt=prompt.strip(),seed=seed,set_id=body.get('set_id'))
        j=job_record('set-image','Set Studio · Qwen image edit',spec,snap,workflow='qwen-image-2.1-set')
        with store.lock:store.data['jobs'].append(j);store.save()
        return j

    @app.post('/api/set-studio/models/import')
    def import_model(file:UploadFile=File(...)):
        from .set_models import register_model
        if not (file.filename or '').lower().endswith('.glb'):raise ValueError('Choose a GLB model file.')
        path=store.root/'assets'/f'{uid()}.glb'
        try:
            total=0
            with path.open('wb') as out:
                while chunk:=file.file.read(1024*1024):
                    total+=len(chunk)
                    if total>256*1024*1024:raise ValueError('GLB models must be below 256 MB.')
                    out.write(chunk)
            return register_model(store,path,Path(file.filename).stem)
        except Exception:path.unlink(missing_ok=True);raise

    @app.get('/api/set-studio/models/{mid}/file.glb')
    def model_file(mid:str):
        item=store.snapshot().get('set_models',{}).get(mid)
        if not item:raise HTTPException(404,'Model not found')
        return FileResponse(store.asset_path(item),media_type='model/gltf-binary',filename=item['name']+'.glb')

    @app.post('/api/set-studio/import')
    def import_splat(file:UploadFile=File(...)):
        if not (file.filename or '').lower().endswith('.ply'):raise ValueError('Import a Gaussian PLY file.')
        path=store.root/'assets'/f'{uid()}.ply'
        try:
            total=0
            with path.open('wb') as out:
                while chunk:=file.file.read(1024*1024):
                    total+=len(chunk)
                    if total>1024**3:raise ValueError('PLY files must be below 1 GB.')
                    out.write(chunk)
            return register_splat(store,path,Path(file.filename).stem)
        except Exception:path.unlink(missing_ok=True);raise

    @app.get('/api/set-studio/splats/{sid}/file.ply')
    def splat_file(sid:str):
        item=store.snapshot().get('splats',{}).get(sid)
        if not item:raise HTTPException(404,'Splat not found')
        return FileResponse(store.asset_path(item),media_type='application/octet-stream',filename=item['name']+'.ply')

    @app.post('/api/set-studio/render')
    def render(file:UploadFile=File(...)):
        path=store.root/'assets'/f'{uid()}.png'
        data=file.file.read(32*1024*1024+1)
        if len(data)>32*1024*1024:raise ValueError('Render exceeds 32 MB.')
        try:
            path.write_bytes(data)
            return add_asset(path,Path(file.filename or 'Set render.png').stem,'set-studio')
        except Exception:path.unlink(missing_ok=True);raise
