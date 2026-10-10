from .store import ordered_references
import copy
import json
import mimetypes
import os
import re
import secrets
import shutil
import threading
import time
import zipfile
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .store import Store, project, uid, check_project, encode_spec, segment_context, segment
from .comfy import Comfy, JobRunner
from .workflows import DEFAULT_MODELS
from . import media, scene_writer, cloud
from .hosting import is_local
from .store import generation_order

ROOT = Path(__file__).resolve().parent.parent
store = Store(os.environ.get('FRAMEFORGE_DATA', str(ROOT/'data')))
app = FastAPI(title='Frameforge local video editor')


@app.exception_handler(ValueError)
async def value_error(request, e):
    return JSONResponse({'detail':str(e)}, status_code=400)


@app.middleware('http')
async def local_only(request: Request, call_next):
    hosting = getattr(app.state, 'hosting', None)
    if hosting and not hosting.lan and not is_local(request.client.host if request.client else ''):
        return JSONResponse({'detail':'This editor is in local-only mode.'}, status_code=403)
    if request.method in ('POST','PUT','PATCH','DELETE'):
        origin = request.headers.get('origin')
        if origin and origin != str(request.base_url).rstrip('/'):
            return JSONResponse({'detail':'Cross-origin writes are not allowed.'},status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def add_asset(path, name, source='imported'):
    ext = path.suffix.lower()
    kind = 'image' if ext in ('.png','.jpg','.jpeg','.webp','.bmp') else 'audio' if ext in ('.wav','.mp3','.flac','.ogg','.m4a','.aac') else 'video'
    a = dict(id=uid(),name=name,kind=kind,file=str(path.relative_to(store.root)),source=source,tags=[],folder='',created=time.time())
    if kind in ('video','audio'):
        a.update(media.probe(path))
        if not a['duration']:
            raise ValueError('The media file could not be read, or has no duration.')
    else:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        a['duration'] = 0
    try:
        thumb = store.root/'assets'/f'{a["id"]}.jpg'
        if kind in ('image','video'):
            media.thumbnail(path,thumb,kind)
            a['thumbnail'] = str(thumb.relative_to(store.root))
        if kind=='audio':
            a['waveform'] = media.waveform(path)
    except Exception as e:
        a['preview_warning'] = str(e)
    with store.lock:
        store.data['assets'][a['id']] = a
        store.save()
    return a


runner = JobRunner(store,add_asset)


@app.on_event('startup')
def startup():
    runner.start()


@app.on_event('shutdown')
def shutdown():
    runner.stop.set()


@app.get('/api/hosting')
def hosting_status():
    hosting = getattr(app.state, 'hosting', None)
    return hosting.status() if hosting else dict(supported=False, lan=False, urls=[])


@app.put('/api/hosting')
async def hosting_update(body:dict):
    hosting = getattr(app.state, 'hosting', None)
    if not hosting:
        raise ValueError('Start the editor with run.py to change hosting from settings.')
    return await hosting.change(body.get('lan'))


@app.get('/api/state')
def state():
    snap = store.snapshot()
    try:
        media.ffmpeg()
        snap['media_available'] = True
    except ValueError:
        snap['media_available'] = False
    return snap


@app.get('/api/scene-writer/config')
def writer_config():
    with store.lock:
        return scene_writer.public_config(scene_writer.read_config(store.root))


@app.put('/api/scene-writer/config')
def writer_settings(body:dict):
    with store.lock:
        return scene_writer.save_config(store.root,body)


@app.post('/api/scene-writer/models')
def writer_models(body:dict):
    with store.lock:
        config=scene_writer.read_config(store.root)
    return scene_writer.discover_models(config,body)


@app.post('/api/scene-writer/generate')
def writer_generate(body:dict):
    if body.get('project_id') not in store.snapshot()['projects']:
        raise ValueError('Select an existing project.')
    with store.lock:
        config=scene_writer.read_config(store.root)
    return scene_writer.generate(config,body,store)


@app.post('/api/scene-writer/parse')
def writer_parse(body:dict):
    return scene_writer.parse_script(body.get('script'))


@app.post('/api/scene-writer/approve')
def writer_approve(body:dict):
    with store.lock:
        existing=store.data['projects'].get(body.get('project_id'))
        if not existing:raise ValueError('The target project no longer exists.')
        token=body.get('approval_id')
        if not isinstance(token,str) or not re.fullmatch(r'[a-f0-9]{32}',token):
            raise ValueError('Missing script approval identifier.')
        target_id=body.get('segment_id')
        if target_id:
            for sc in existing['scenes']:
                for seg in sc['segments']:
                    if seg['id']==target_id and seg.get('writer',{}).get('approval_id')==token:
                        return dict(project=existing,scene_id=sc['id'],segment_id=target_id)
        for sc in existing['scenes']:
            if not target_id and sc.get('writer',{}).get('approval_id')==token:
                return dict(project=existing,scene_id=sc['id'])
        if body.get('version')!=existing['version']:
            raise HTTPException(409,'Project changed. Refresh the editor and approve the script again.')
        parsed=scene_writer.parse_script(body.get('script'))
        refs=scene_writer.check_images(body.get('refs',[]),store.data['assets'])
        if target_id:
            p=copy.deepcopy(existing)
            for sc in p['scenes']:
                seg=next((x for x in sc['segments'] if x['id']==target_id),None)
                if seg is None:continue
                other_refs=[aid for aid in seg.get('refs',[]) if store.data['assets'].get(aid,{}).get('kind')!='image']
                shot=dict(prompt='\n\n'.join(item['prompt'] for item in parsed['shots']),continuity=parsed['carryover'])
                seg.update(prompt=shot['prompt'],refs=list(refs)+other_refs,
                           ref_order=list(refs)+other_refs,writer_continuity=shot['continuity'],
                           writer=dict(approval_id=token,script=parsed['script'],carryover=parsed['carryover']))
                check_project(p,store.data['assets'])
                p['version']+=1
                store.data['projects'][p['id']]=p
                store.save()
                return dict(project=p,scene_id=sc['id'],segment_id=target_id)
            raise ValueError('The target segment no longer exists. Reopen Scene Writer from an existing segment.')
        duration=float(body.get('duration',8))
        overlap=body.get('overlap',22)
        if not .25<=duration<=120 or overlap not in (22,39,56):
            raise ValueError('Choose 0.25–120 seconds per shot and 22, 39, or 56 context frames.')
        name=str(body.get('name','')).strip()
        if not name:raise ValueError('Give the new scene a name.')
        p=copy.deepcopy(existing)
        sc=dict(id=uid(),name=name,prompt='',refs=[],segments=[],writer=dict(reference_mode='segment',approval_id=token,script=parsed['script'],carryover=parsed['carryover']))
        for shot in parsed['shots']:
            seg=segment(f'Shot {shot["number"]:02d}')
            seg.update(prompt=shot['prompt'],refs=list(refs),duration=duration,overlap=overlap,connected=bool(body.get('connected',True)) and shot['number']>1,seed=secrets.randbelow(2**53),writer_continuity=shot['continuity'])
            sc['segments'].append(seg)
        p['scenes'].append(sc)
        check_project(p,store.data['assets'])
        p['version']+=1
        store.data['projects'][p['id']]=p
        store.save()
        return dict(project=p,scene_id=sc['id'])


@app.post('/api/projects')
def create_project(body:dict):
    p = project(body.get('name','Untitled film'))
    with store.lock:
        store.data['projects'][p['id']] = p
        store.data.setdefault('saved_projects',{})[p['id']]=copy.deepcopy(p)
        store.save()
    return p


@app.get('/api/projects/{pid}/export')
def export_project(pid:str):
    snap=store.snapshot()
    p=snap['projects'][pid]
    ids=set()
    for sc in p['scenes']:
        ids.update(sc['refs'])
        for seg in sc['segments']:
            ids.update(seg['refs']+seg['takes'])
            ids.update(x for x in [seg.get('main'),seg.get('continuation')] if x)
    assets={aid:copy.deepcopy(snap['assets'][aid]) for aid in ids if aid in snap['assets']}
    path=store.root/'exports'/f'project-{uid()}.zip'
    with zipfile.ZipFile(path,'w',zipfile.ZIP_STORED) as z:
        files=set()
        for a in assets.values():
            files.update(a[k] for k in ('file','thumbnail') if a.get(k))
            if a.get('latent',{}).get('local'): files.add(a['latent']['local'])
        for sc in p['scenes']:
            for seg in sc['segments']:
                if seg.get('encoded_latent',{}).get('local'): files.add(seg['encoded_latent']['local'])
        for rel in files:
            source=store.asset_path({'file':rel})
            if source.is_file(): z.write(source,rel)
        z.writestr('project.json',json.dumps(dict(project=p,assets=assets)))
    return FileResponse(path,filename='frameforge-project.zip')


@app.post('/api/projects/import')
def import_project(file:UploadFile=File(...)):
    written=[]
    try:
        with zipfile.ZipFile(file.file) as z:
            manifest=json.loads(z.read('project.json'))
            p=manifest['project']; assets=manifest['assets']
            mapping={aid:uid() for aid in assets}
            def restore(rel,folder):
                target=store.root/folder/(uid()+Path(rel).suffix)
                with z.open(rel) as source, target.open('wb') as dest:
                    written.append(target)
                    shutil.copyfileobj(source,dest,1024*1024)
                return str(target.relative_to(store.root))
            def latent(value):
                if value and value.get('local'):
                    value['local']=restore(value['local'],'latents')
                if value and value.get('source'):
                    value['source']['asset_id']=mapping.get(value['source']['asset_id'],value['source']['asset_id'])
            for old,a in assets.items():
                a['id']=mapping[old]
                a['file']=restore(a['file'],'assets')
                if a.get('thumbnail'): a['thumbnail']=restore(a['thumbnail'],'assets')
                latent(a.get('latent'))
            p.update(id=uid(),version=0)
            segment_ids={seg['id']:uid() for sc in p['scenes'] for seg in sc['segments']}
            for sc in p['scenes']:
                sc['id']=uid();sc['refs']=[mapping[x] for x in sc['refs']]
                for seg in sc['segments']:
                    seg['id']=segment_ids[seg['id']]
                    if seg.get('continuation_segment'):
                        seg['continuation_segment']=segment_ids[seg['continuation_segment']]
                    for key in ('refs','takes'): seg[key]=[mapping[x] for x in seg[key]]
                    if 'audio_trims' in seg:seg['audio_trims']={mapping[k]:v for k,v in seg['audio_trims'].items() if k in mapping}
                    for key in ('main','continuation'):
                        if seg.get(key):seg[key]=mapping[seg[key]]
                    latent(seg.get('encoded_latent'))
            imported={a['id']:a for a in assets.values()}
            check_project(p,imported)
        with store.lock:
            store.data['assets'].update(imported)
            store.data['projects'][p['id']]=p
            store.data.setdefault('saved_projects',{})[p['id']]=copy.deepcopy(p)
            store.save()
        return p
    except Exception as e:
        for path in written:path.unlink(missing_ok=True)
        raise ValueError(f'Cannot import project archive: {e}') from e


@app.delete('/api/projects/{pid}')
def delete_project(pid:str):
    with store.lock:
        if any(j.get('project_id')==pid and j['status'] not in ('completed','failed','cancelled') for j in store.data['jobs']):
            raise ValueError('Cancel or finish this project’s jobs before deleting it.')
        if pid not in store.data['projects']:raise HTTPException(404,'Project not found')
        del store.data['projects'][pid]
        store.data.setdefault('saved_projects',{}).pop(pid,None)
        if not store.data['projects']:
            p=project();store.data['projects'][p['id']]=p
            store.data['saved_projects'][p['id']]=copy.deepcopy(p)
        store.save()
    return {'ok':True}


@app.put('/api/projects/{pid}')
def save_project(pid:str, body:dict):
    with store.lock:
        old = store.data['projects'].get(pid)
        if not old:
            raise HTTPException(404,'Project not found')
        if body.get('version') != old['version']:
            raise HTTPException(409,'Project changed while you were editing. Your unsaved edit is kept in this browser; reload or reapply it to the latest project.')
        if body.get('id') != pid:
            raise ValueError('Project ID mismatch')
        check_project(body,store.data['assets'])
        body['version'] += 1
        store.data['projects'][pid] = body
        store.save()
    return body


@app.post('/api/projects/{pid}/commit')
def commit_project(pid:str, body:dict):
    with store.lock:
        current=store.data['projects'].get(pid)
        if not current:raise HTTPException(404,'Project not found')
        if body.get('version')!=current['version']:
            raise HTTPException(409,'Project changed. Retry Save after the latest results arrive.')
        saved=copy.deepcopy(current)
        if 'name' in body:
            name=str(body['name']).strip()
            if not name:raise ValueError('Enter a name for the saved copy.')
            saved.update(id=uid(),name=name,version=0)
            store.data['projects'][saved['id']]=copy.deepcopy(saved)
        store.data.setdefault('saved_projects',{})[saved['id']]=copy.deepcopy(saved)
        store.save()
        return saved


@app.post('/api/projects/{pid}/discard-recovery')
def discard_project_recovery(pid:str, body:dict):
    with store.lock:
        current=store.data['projects'].get(pid)
        saved=store.data.get('saved_projects',{}).get(pid)
        if not current or not saved:raise HTTPException(404,'Saved project not found')
        if body.get('version')!=current['version']:
            raise HTTPException(409,'Project changed. Refresh before discarding recovery.')
        if any(j.get('project_id')==pid and j['status'] not in ('completed','failed','cancelled') for j in store.data['jobs']):
            raise ValueError('Finish or cancel this project’s jobs before reverting to its saved version.')
        restored=copy.deepcopy(saved)
        restored['version']=current['version']+1
        store.data['projects'][pid]=restored
        store.save()
        return restored


@app.get('/api/cloud/config')
def cloud_config():
    return {'has_api_key':bool(cloud.read_config(store.root).get('api_key'))}


@app.put('/api/cloud/config')
def cloud_save(body:dict):
    return cloud.save_config(store.root,body)


@app.post('/api/cloud/test')
def cloud_test():
    schema=cloud.CloudComfy(store.root).request('/object_info',timeout=90)
    required={'MiniMaxH3AddGuide','MiniMaxH3ReferenceToVideo'}
    missing=sorted(required-schema.keys())
    return {'connected':True,'warning':('Cloud is missing required continuation nodes: '+', '.join(missing)) if missing else 'Connected. Each queued workflow will also be validated against cloud nodes and model filenames.'}


@app.put('/api/settings')
def settings(body:dict):
    Comfy(body['comfy_url'])
    if any(j['status'] in ('queued','preparing','submitting','running','recovering','cancelling') for j in store.snapshot()['jobs']):
        raise ValueError('Finish or cancel active jobs before changing the connection or models.')
    with store.lock:
        store.data['settings'] = dict(comfy_url=body['comfy_url'].rstrip('/'),models={**DEFAULT_MODELS,**body.get('models',{})})
        store.save()
    return store.data['settings']


@app.get('/api/connection')
def connection(url:str|None=None):
    c = Comfy(url or store.snapshot()['settings']['comfy_url'])
    try:
        return dict(connected=True,stats=c.request('/system_stats',timeout=5),queue=c.request('/queue',timeout=5))
    except ValueError as e:
        return dict(connected=False,error=str(e))


@app.get('/api/capabilities')
def capabilities(url:str|None=None):
    c = Comfy(url or store.snapshot()['settings']['comfy_url'])
    schema = c.request('/object_info',timeout=90)
    pairs = {'h3_model':('UNETLoader','unet_name'), 'h3_clip':('CLIPLoader','clip_name'), 'h3_video_vae':('VAELoader','vae_name'),
             'h3_audio_vae':('VAELoader','vae_name'), 'ltx_checkpoint':('CheckpointLoaderSimple','ckpt_name'), 'ltx_encoder':('LTXAVTextEncoderLoader','text_encoder'),
             'ltx_distilled_lora':('LoraLoaderModelOnly','lora_name')}
    models={}
    for key,(node,inp) in pairs.items():
        rule = schema.get(node,{}).get('input',{}).get('required',{}).get(inp,[])
        models[key] = rule[0] if rule and isinstance(rule[0],list) else rule[1].get('options',[]) if len(rule)>1 else []
    return dict(nodes=list(schema),models=models)


@app.post('/api/assets')
def import_asset(file:UploadFile=File(...)):
    ext = Path(file.filename or '').suffix.lower()
    if ext not in ('.png','.jpg','.jpeg','.webp','.bmp','.mp4','.mov','.webm','.mkv','.avi','.wav','.mp3','.flac','.ogg','.m4a','.aac'):
        raise ValueError('Unsupported media type. Import an image, video or audio file.')
    path = store.root/'assets'/f'{uid()}{ext}'
    try:
        with path.open('wb') as out:
            shutil.copyfileobj(file.file,out,1024*1024)
        return add_asset(path,Path(file.filename).stem)
    except Exception:
        path.unlink(missing_ok=True)
        raise


@app.patch('/api/assets/{aid}')
def edit_asset(aid:str,body:dict):
    with store.lock:
        a = store.data['assets'].get(aid)
        if not a:
            raise HTTPException(404,'Asset not found')
        for key in ('name','folder','tags','description'):
            if key in body:
                if key=='tags' and (not isinstance(body[key],list) or any(not isinstance(x,str) for x in body[key])):
                    raise ValueError('Tags must be a list of names')
                if key!='tags' and not isinstance(body[key],str):
                    raise ValueError('Asset details must be text')
                a[key] = body[key]
        store.save()
        return a


@app.post('/api/assets/{aid}/describe')
def describe_asset(aid:str):
    asset=store.snapshot()['assets'].get(aid)
    if not asset:raise HTTPException(404,'Asset not found')
    description=scene_writer.describe_image(scene_writer.read_config(store.root),asset,store)
    with store.lock:
        current=store.data['assets'].get(aid)
        if not current:raise HTTPException(404,'Asset no longer exists')
        current['description']=description
        store.save()
    return {'description':description}


@app.get('/api/assets/{aid}/file')
def asset_file(aid:str,thumbnail:bool=False):
    a = store.snapshot()['assets'].get(aid)
    if not a:
        raise HTTPException(404,'Asset not found')
    path = store.root/a['thumbnail'] if thumbnail and a.get('thumbnail') else store.asset_path(a)
    return FileResponse(path,media_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')


@app.post('/api/assets/{aid}/trim')
def trim_asset(aid:str,body:dict):
    a = store.snapshot()['assets'][aid]
    start,end = float(body['start']),float(body['end'])
    if a['kind']!='audio' or not 0 <= start < end <= a['duration']+0.025:
        raise ValueError('Choose valid audio in/out points within the recording.')
    path = store.root/'assets'/f'{uid()}.wav'
    media.trim_audio(store.asset_path(a),path,start,end)
    return add_asset(path,body.get('name',a['name']+' · trimmed'),'trimmed')


@app.post('/api/assets/{aid}/capture')
def capture(aid:str,body:dict):
    a = store.snapshot()['assets'][aid]
    t = float(body['time'])
    if a['kind']!='video' or not 0 <= t < a['duration']:
        raise ValueError('Choose a frame inside the video.')
    path = store.root/'assets'/f'{uid()}.png'
    media.run(['-ss',t,'-i',store.asset_path(a),'-frames:v','1',path])
    return add_asset(path,body.get('name',a['name']+f' · frame {round(t*24)}'),'capture')


def job_record(kind,name,spec,snap,**extras):
    return dict(id=uid(),kind=kind,name=name,spec=copy.deepcopy(spec),status='queued',stage='Queued locally',progress=None,created=time.time(),
                inference=snap['settings'].get('inference','local'),comfy_url=snap['settings']['comfy_url'],models=copy.deepcopy(snap['settings']['models']),**extras)


@app.post('/api/queue')
def queue(body:dict):
    with store.lock:
        snap=store.snapshot()
        target=body.get('inference','local')
        if target not in ('local','cloud'):raise ValueError('Choose local or cloud inference.')
        if target=='cloud':
            cloud.CloudComfy(store.root)
            snap['settings']['comfy_url']=cloud.CLOUD_URL
        turbo=body.get('turbo',False)
        if not isinstance(turbo,bool):raise ValueError('Turbo must be enabled or disabled.')
        snap['settings']['inference']=target
        p = snap['projects'][body['project_id']]
        check_project(p,snap['assets'])
        ids = body.get('segment_ids',[])
        if not ids:
            raise ValueError('Select at least one segment.')
        if len(set(ids))!=len(ids):
            raise ValueError('Duplicate segment selection')
        known_ids={seg['id'] for scene in p['scenes'] for seg in scene['segments']}
        if not set(ids)<=known_ids:
            raise ValueError('One of the selected segments no longer exists.')
        for scene in p['scenes']:
            for seg in scene['segments']:
                if seg['id'] in ids:
                    seg['turbo']=turbo
                    if turbo:seg['steps']=4
        if target=='cloud':
            jobs=cloud.queue_segments(p,ids,snap,job_record)
            store.data['jobs'].extend(jobs)
            store.save()
            return jobs
        jobs=[]
        queued_by_segment={}
        def usable(context):
            return context and (context.get('width'),context.get('height'))==(p['width'],p['height']) and context.get('server','').rstrip('/')==snap['settings']['comfy_url'].rstrip('/')
        def ensure_encoding(source, seg=None):
            active=[x for x in snap['jobs']+jobs if x['kind']=='encode' and x['spec']==source
                    and x.get('segment_id')==(seg['id'] if seg else None)
                    and (not seg or x.get('project_id')==p['id'])
                    and x.get('comfy_url','').rstrip('/')==snap['settings']['comfy_url'].rstrip('/')
                    and x['status'] in ('queued','preparing','submitting','running','recovering')]
            if active:
                return active[-1]['id']
            extra=dict(project_id=p['id'],segment_id=seg['id']) if seg else {}
            name=seg['name'] if seg else snap['assets'][source['asset_id']]['name']
            encoding=job_record('encode','Encode · '+name,source,snap,**extra)
            jobs.append(encoding)
            return encoding['id']
        ordered, sources = generation_order(p)
        for scene, seg in ordered:
            if seg['id'] not in ids:
                continue
            if seg.get('type')=='video':
                spec=encode_spec(seg,snap['assets'])
                j=job_record('encode','Encode · '+seg['name'],spec,snap,project_id=p['id'],segment_id=seg['id'])
                jobs.append(j)
                queued_by_segment[seg['id']]=j['id']
                continue
            if not seg['prompt'].strip():
                raise ValueError(f'Add a prompt to {seg["name"]}.')
            spec=copy.deepcopy(seg)
            if seg.get("randomize_seed"):
                spec["seed"]=secrets.randbelow(2**53)
            spec['prompt']='\n\n'.join(x for x in [scene.get('prompt',''),seg['prompt']] if x)
            spec['refs']=ordered_references(scene,seg)
            dependency,context=None,None
            if seg.get('continuation'):
                context=snap['assets'].get(seg['continuation'],{}).get('latent')
                if not usable(context):
                    aid=seg['continuation']
                    if snap['assets'].get(aid,{}).get('kind')!='video':
                        raise ValueError('Choose an existing continuation video.')
                    dependency=ensure_encoding(dict(asset_id=aid,width=p['width'],height=p['height']))
                    context=None
            elif seg['id'] in sources:
                prev=sources[seg['id']]
                dependency=queued_by_segment.get(prev['id'])
                if not dependency:
                    context=segment_context(prev,snap['assets'])
                    if not usable(context):
                        context=None
                        if prev.get('main'):
                            dependency=ensure_encoding(encode_spec(prev,snap['assets']),prev)
                        else:
                            active_previous=[x for x in snap['jobs'] if x['kind']=='segment' and x.get('segment_id')==prev['id'] and x.get('project_id')==p['id'] and x.get('comfy_url')==snap['settings']['comfy_url'] and x['status'] in ('queued','preparing','submitting','running','recovering')]
                            if not active_previous:
                                raise ValueError(f'{seg["name"]}: the linked source segment needs a video. Queue both segments together.')
                            dependency=active_previous[-1]['id']
            j=job_record('segment',scene['name']+' / '+seg['name'],spec,snap,project_id=p['id'],segment_id=seg['id'],dependency=dependency,context=context)
            jobs.append(j)
            queued_by_segment[seg['id']]=j['id']
        store.data['jobs'].extend(jobs)
        store.save()
    return jobs


@app.post('/api/speech')
def speech(body:dict):
    snap=store.snapshot()
    if not str(body.get('prompt','')).strip() or not 0.5<=float(body.get('duration',0))<=40:
        raise ValueError('Enter dialogue and a duration between 0.5 and 40 seconds.')
    for field,kind in [('image_id','image'),('audio_id','audio')]:
        if snap['assets'].get(body.get(field),{}).get('kind')!=kind:
            raise ValueError(f'Choose a {kind} reference.')
    body['reference_duration']=snap['assets'][body['audio_id']]['duration']
    if body['reference_duration']>=float(body['duration']):
        raise ValueError('Generation length must exceed the voice reference length. Trim the reference to 1–2 seconds or increase generation length.')
    body['output_duration']=float(body['duration'])-body['reference_duration']
    body['mode']='voice-prefix'
    body['seed']=secrets.randbelow(2**53) if body.get('randomize_seed') else int(body.get('seed',42))
    if not 0<=body['seed']<=2**53-1:
        raise ValueError('Seed must be a nonnegative safe integer.')
    j=job_record('speech',body.get('name','Dialogue'),body,snap)
    with store.lock:
        store.data['jobs'].append(j)
        store.save()
    return j


@app.post('/api/assets/{aid}/encode')
def encode(aid:str,body:dict):
    snap=store.snapshot()
    a=snap['assets'].get(aid)
    if not a or a['kind']!='video':
        raise ValueError('Choose a video to encode.')
    p=snap['projects'][body['project_id']]
    if body.get('segment_id'):
        seg=next((v for sc in p['scenes'] for v in sc['segments'] if v['id']==body['segment_id']),None)
        if not seg or seg.get('main')!=aid:
            raise ValueError('The segment no longer uses this video.')
        spec=encode_spec(seg,snap['assets'])
        j=job_record('encode','Encode · '+seg['name'],spec,snap,project_id=p['id'],segment_id=seg['id'])
    else:
        j=job_record('encode','Encode · '+a['name'],dict(asset_id=aid,width=p['width'],height=p['height']),snap)
    with store.lock:
        store.data['jobs'].append(j)
        store.save()
    return j


@app.post('/api/jobs/{jid}/cancel')
def cancel(jid:str):
    runner.cancel(jid)
    return {'ok':True}


@app.get('/api/jobs/{jid}/graph')
def graph(jid:str):
    path=store.root/'graphs'/f'{jid}.json'
    if not re.fullmatch('[a-f0-9]{32}',jid) or not path.exists():
        raise HTTPException(404,'Graph is not available until the job is prepared.')
    return FileResponse(path,filename='comfy-workflow.json')


@app.post('/api/export')
def export(body:dict):
    if body.get('mode') not in ('video','clips'):
        raise ValueError('Choose video or clips export.')
    snap=store.snapshot()
    p=snap['projects'][body['project_id']]
    eid=uid()
    task=dict(id=eid,kind='export',name='Export · '+p['name'],status='running',stage='Normalizing and sequencing clips',created=time.time(),progress=None)
    with store.lock:
        store.data['jobs'].append(task)
        store.save()
    def work():
        try:
            assets=snap['assets']
            for a in assets.values():
                a['_path']=str(store.asset_path(a))
            result=media.export_sequence(p,assets,store.root/'exports'/eid,body['mode'])
            store.update_job(eid,status='completed',stage='Export ready',download=f'/api/exports/{eid}/{result.name}',finished=time.time(),progress=100)
        except Exception as e:
            store.update_job(eid,status='failed',error=str(e),finished=time.time())
    threading.Thread(target=work,daemon=True).start()
    return task


@app.get('/api/exports/{eid}/{name}')
def exported(eid:str,name:str):
    if not re.fullmatch('[a-f0-9]{32}',eid) or name not in ('finished-video.mp4','individual-clips.zip'):
        raise HTTPException(404)
    return FileResponse(store.root/'exports'/eid/name,filename=name)


@app.get('/api/backup')
def backup():
    path=store.root/'exports'/f'library-{uid()}.zip'
    snap=store.snapshot()
    with zipfile.ZipFile(path,'w',zipfile.ZIP_STORED) as z:
        z.writestr('library.json',json.dumps(snap,indent=2))
        for folder in ['assets','latents','graphs']:
            for f in (store.root/folder).iterdir():
                if f.is_file() and not f.name.startswith('prepared-'):
                    z.write(f,f.relative_to(store.root))
    return FileResponse(path,filename='frameforge-library.zip',background=None)


@app.get('/')
def index():
    return FileResponse(ROOT/'static'/'index.html')


app.mount('/static',StaticFiles(directory=ROOT/'static'),name='static')


from . import set_studio
set_studio.install(app,store,add_asset,job_record)
