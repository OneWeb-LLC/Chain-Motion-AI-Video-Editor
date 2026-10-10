"""Comfy Cloud's ComfyUI-compatible transport; credentials stay out of jobs/backups."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import requests
from .comfy import Comfy
from .store import ordered_references

CLOUD_URL='https://cloud.comfy.org/api'

def read_config(root):
    path=Path(root)/'comfy-cloud.json'
    return json.loads(path.read_text()) if path.exists() else {}

def save_config(root, body):
    config=read_config(root)
    key=str(body.get('api_key','')).strip()
    if body.get('clear_key'):config.pop('api_key',None)
    elif key:config['api_key']=key
    path=Path(root)/'comfy-cloud.json'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump(config,f)
    os.chmod(path,0o600)
    return {'has_api_key':bool(config.get('api_key'))}

class CloudComfy(Comfy):
    def __init__(self, root):
        super().__init__(CLOUD_URL)
        self.key=read_config(root).get('api_key','')
        if not self.key:raise ValueError('Add your Comfy Cloud API key using Cloud setup beside Queue selected.')

    def request(self,path,body=None,timeout=15):
        try:
            r=requests.request('GET' if body is None else 'POST',self.url+path,
                json=body,headers={'X-API-Key':self.key},timeout=timeout,allow_redirects=False)
            if not r.ok or r.is_redirect:
                message={401:'Check your API key.',403:'Access denied.',402:'Insufficient cloud credits.',429:'Check your subscription or retry later.'}.get(r.status_code,'Check cloud workflow support and service availability.')
                raise ValueError(f'Comfy Cloud HTTP {r.status_code}. {message}')
            return r.json() if r.content.strip() else {}
        except requests.RequestException as e:raise ValueError('Cannot reach Comfy Cloud. Check your connection and retry.') from e

    def upload(self,path):
        with open(path,'rb') as f:
            r=requests.post(self.url+'/upload/image',headers={'X-API-Key':self.key},files={'image':(path.name,f)},data={'type':'input','overwrite':'false'},timeout=300,allow_redirects=False)
        if r.status_code!=200:raise ValueError(f'Comfy Cloud upload failed (HTTP {r.status_code}).')
        d=r.json()
        return (d.get('subfolder','')+'/' if d.get('subfolder') else '')+d['name']

    def download(self,info,path):
        r=requests.get(self.url+'/view',params=info,headers={'X-API-Key':self.key},stream=True,timeout=300,allow_redirects=False)
        if r.is_redirect:
            target=r.headers['Location'];r.close()
            if urlparse(target).scheme!='https':raise ValueError('Comfy Cloud returned an invalid download URL.')
            # Never forward the API key to the signed storage URL.
            r=requests.get(target,stream=True,timeout=300)
        with r:
            r.raise_for_status()
            with open(path,'wb') as f:
                for chunk in r.iter_content(1024*1024):f.write(chunk)


def queue_segments(p, ids, snap, record):
    """Cloud continuations depend on delivered videos, never local latent paths."""
    import copy
    import secrets
    from .store import encode_spec, generation_order
    jobs=[];queued={}
    ordered, sources = generation_order(p)
    for scene,seg in ordered:
        if seg['id'] not in ids or seg.get('type')=='video':continue
        if not seg['prompt'].strip():raise ValueError(f'Add a prompt to {seg["name"]}.')
        spec=copy.deepcopy(seg)
        if seg.get('randomize_seed'):spec['seed']=secrets.randbelow(2**53)
        spec['prompt']='\n\n'.join(x for x in [scene.get('prompt',''),seg['prompt']] if x)
        spec['refs']=ordered_references(scene,seg)
        source=None;dependency=None
        if seg.get('continuation'):
            aid=seg['continuation'];a=snap['assets'].get(aid,{})
            if a.get('kind')!='video':raise ValueError('Choose an existing continuation video.')
            source=dict(asset_id=aid,trim_in=0,duration=a['duration'])
        elif seg['id'] in sources:
            prev=sources[seg['id']];dependency=queued.get(prev['id'])
            if not dependency:
                if not prev.get('main'):raise ValueError(f'{seg["name"]}: queue the linked source segment too, or select its main video.')
                source=encode_spec(prev,snap['assets'])
        if source and source['duration']+0.005<spec['overlap']/24:
            raise ValueError(f'{seg["name"]}: the linked source clip is shorter than the selected overlap.')
        j=record('segment',scene['name']+' / '+seg['name'],spec,snap,project_id=p['id'],segment_id=seg['id'],
                 dependency=dependency,guide_source=source,workflow='h3-cloud-add-guide')
        jobs.append(j);queued[seg['id']]=j['id']
    if not jobs:raise ValueError('Select a generation segment. Cloud Add Guide uses imported videos directly; latent encoding is not needed.')
    return jobs
