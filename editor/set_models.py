"""Portable, self-contained GLB assets for staging sets."""
import json
import struct
import time
from .store import uid


def validate_glb(path):
    with path.open('rb') as f:
        header=f.read(20)
        if len(header)!=20:raise ValueError('Invalid GLB file.')
        magic,version,total,length,kind=struct.unpack('<5I',header)
        if magic!=0x46546c67 or version!=2 or total!=path.stat().st_size or kind!=0x4e4f534a or length>16*1024*1024 or length>total-20:
            raise ValueError('Import a valid GLB 2.0 model.')
        try:data=json.loads(f.read(length))
        except (ValueError,UnicodeError) as e:raise ValueError('Invalid GLB model data.') from e
    if not isinstance(data,dict) or not data.get('meshes'):raise ValueError('The GLB must contain a mesh.')
    for item in data.get('buffers',[])+data.get('images',[]):
        uri=item.get('uri','')
        if uri and not uri.startswith('data:'):raise ValueError('Export a self-contained GLB with textures and buffers embedded.')
    unsupported={'KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'}&set(data.get('extensionsRequired',[]))
    if unsupported:raise ValueError('Export an uncompressed GLB; this model requires '+', '.join(sorted(unsupported))+'.')


def register_model(store,path,name):
    validate_glb(path)
    item=dict(id=uid(),name=name[:200],file=str(path.relative_to(store.root)),created=time.time())
    with store.lock:
        store.data.setdefault('set_models',{})[item['id']]=item;store.save()
    return item
