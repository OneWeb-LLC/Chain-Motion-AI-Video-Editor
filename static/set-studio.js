import * as THREE from 'three';
import {importedModel,setModelTextures,disposeModelTextures} from './set-models.js';
import {handControls} from './hand-poses.js';
import {setupImageEditor} from './set-image-editor.js';
import {makeIK,solveIK,ikNames} from './set-ik.js';
import {riggedMannequin,RIG} from './rigged-mannequin.js';
import {pickEditable,isSelectionClick} from './set-picking.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const api=async(path,body,method='POST')=>{const r=await fetch(path,{method:body===undefined?'GET':method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(!r.ok){let e=await r.json();throw Error(e.detail||r.statusText)}return r.json()};
const status=s=>$('#set-status').textContent=s;
const guard=fn=>async(...args)=>{try{await fn(...args)}catch(e){console.error(e);status(e.message)}};
let library={sets:[],splats:[]}, doc={id:uid(),name:'Untitled set',objects:[],background:'#20252b',version:0}, selected=null, dirty=false, undo=[],previewCamera=null, loading=0, rendering=false;
const pendingSplats=new Map();
let refreshing=false,buildVersion=0;
const scene=new THREE.Scene(), world=new THREE.Group(), helpers=new THREE.Group(), objects=new Map();scene.add(world,helpers);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#20252b');$('#set-viewport').append(renderer.domElement);
const view=new THREE.PerspectiveCamera(50,1,.01,10000);view.position.set(3,2,5);
const orbit=new OrbitControls(view,renderer.domElement);orbit.target.set(0,1,0);orbit.update();
const spark=new SparkRenderer({renderer});scene.add(spark);
// PBR metals need reflected environment light; hemisphere light alone only fills diffuse surfaces.
// A neutral surround keeps every viewing direction lit without changing imported materials.
const studioSurround=new THREE.Scene();studioSurround.background=new THREE.Color(0xc7c7c7);
const environmentGenerator=new THREE.PMREMGenerator(renderer);
const studioEnvironment=environmentGenerator.fromScene(studioSurround,0,.1,10,{size:64});
scene.environment=studioEnvironment.texture;scene.environmentIntensity=.8;
environmentGenerator.dispose();
scene.add(new THREE.HemisphereLight(0xffffff,0x586170,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,8,5);scene.add(light);
const jointMarker=new THREE.Mesh(new THREE.SphereGeometry(.025,12,8),new THREE.MeshBasicMaterial({color:0xffbb55,depthTest:false}));jointMarker.visible=false;jointMarker.renderOrder=100;helpers.add(jointMarker);
helpers.add(new THREE.GridHelper(20,40,0x687581,0x343e48));
let ikMode=false,ikChain=null;const ikTarget=new THREE.Object3D();scene.add(ikTarget);
const gizmo=new TransformControls(view,renderer.domElement);gizmo.setSpace('local');scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed',e=>{orbit.enabled=!e.value&&!previewCamera});
gizmo.addEventListener('mouseDown',()=>{checkpoint();if(ikChain)ikChain=makeIK(objects.get(rootRecord().id).userData.joints,selected.split(':')[1]);});gizmo.addEventListener('objectChange',()=>{if(ikChain&&gizmo.object===ikTarget)solveIK(ikChain,ikTarget.position);syncTransforms();dirty=true;});gizmo.addEventListener('mouseUp',()=>{if(ikChain)ikChain.end.getWorldPosition(ikTarget.position);inspect();});
const joints=[['hips',null,[0,.95,0]],['spine','hips',[0,.22,0]],['chest','spine',[0,.25,0]],['neck','chest',[0,.2,0]],['head','neck',[0,.14,0]],['leftShoulder','chest',[-.24,.1,0]],['leftElbow','leftShoulder',[0,-.3,0]],['leftHand','leftElbow',[0,-.28,0]],['rightShoulder','chest',[.24,.1,0]],['rightElbow','rightShoulder',[0,-.3,0]],['rightHand','rightElbow',[0,-.28,0]],['leftHip','hips',[-.12,-.06,0]],['leftKnee','leftHip',[0,-.42,0]],['leftFoot','leftKnee',[0,-.4,0]],['rightHip','hips',[.12,-.06,0]],['rightKnee','rightHip',[0,-.42,0]],['rightFoot','rightKnee',[0,-.4,0]]];
function checkpoint(){syncTransforms();undo.push(JSON.stringify(doc));if(undo.length>40)undo.shift();dirty=true;}
function rootRecord(){return doc.objects.find(o=>o.id===selected?.split(':')[0])}
function selectedObject(){if(!selected)return null;const [id,joint]=selected.split(':');const root=objects.get(id);return joint?root?.userData.joints?.[joint]:root}
function setTransform(object,data){object.position.fromArray(data.position);object.rotation.set(...data.rotation);object.scale.fromArray(data.scale)}
function syncTransforms(){for(const d of doc.objects){const o=objects.get(d.id);if(!o)continue;if(d.type==='splat'&&new Set(o.scale.toArray()).size>1){const old=d.scale[0],changed=o.scale.toArray().find(v=>Math.abs(v-old)>1e-8);o.scale.setScalar(Math.max(.001,changed??old));}d.position=o.position.toArray();d.rotation=[o.rotation.x,o.rotation.y,o.rotation.z];d.scale=o.scale.toArray();if(d.type==='mannequin'){if(o.userData.handPose)d.hands=structuredClone(o.userData.handPose);d.pose={};for(const [n,j] of Object.entries(o.userData.joints))d.pose[n]=[j.rotation.x,j.rotation.y,j.rotation.z]}}}
function mesh(geometry,material,parent,pos=[0,0,0]){const m=new THREE.Mesh(geometry,material.clone());m.position.fromArray(pos);parent.add(m);return m}
function mannequin(d){const root=new THREE.Group(),parts={},mat=new THREE.MeshStandardMaterial({color:d.color||'#c6b6a3',roughness:.75});
 for(const [name,parent,pos] of joints){const j=new THREE.Group();j.name=name;j.position.fromArray(pos);(parent?parts[parent]:root).add(j);parts[name]=j;if(d.pose?.[name])j.rotation.set(...d.pose[name]);
 mesh(new THREE.SphereGeometry(name==='head'?.14:.065,16,12),mat,j,name==='head'?[0,.07,0]:[0,0,0]);}
 mesh(new THREE.CylinderGeometry(.055,.055,.14,12),mat,parts.neck,[0,.07,0]);mesh(new THREE.BoxGeometry(.32,.19,.2),mat,parts.hips);mesh(new THREE.CapsuleGeometry(.15,.22,6,12),mat,parts.spine,[0,.06,0]);mesh(new THREE.BoxGeometry(.4,.22,.22),mat,parts.chest);
 for(const side of ['left','right']){for(const [part,len,r] of [['Shoulder',.3,.06],['Elbow',.28,.05],['Hip',.42,.08],['Knee',.4,.065]])mesh(new THREE.CylinderGeometry(r,r,len,12),mat,parts[side+part],[0,-len/2,0]);mesh(new THREE.BoxGeometry(.11,.07,.23),mat,parts[side+'Foot'],[0,-.03,.07]);mesh(new THREE.BoxGeometry(.08,.12,.045),mat,parts[side+'Hand'],[0,-.04,0]);}
 root.userData.joints=parts;root.traverse(n=>{if(n.isMesh)n.userData.pickId=d.id+':'+n.parent.name});return root;}
function disposeObject(o){if(o.userData.importedModel)disposeModelTextures(o);o.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.dispose();if(n.geometry)n.geometry.dispose();if(n.material){for(const m of Array.isArray(n.material)?n.material:[n.material]){m.dispose()}}});if(o instanceof SplatMesh)o.dispose();}
async function rebuild(){const version=++buildVersion;gizmo.detach();previewCamera=null;orbit.enabled=true;for(const o of objects.values())disposeObject(o);objects.clear();world.clear();for(const h of [...helpers.children])if(h.isCameraHelper){helpers.remove(h);h.dispose()}
 for(const d of doc.objects){let o;
  if(d.type==='splat'){o=new SplatMesh({url:`/api/set-studio/splats/${d.splat_id}/file.ply`});loading++;o.initialized.then(()=>{loading--;status('Splat loaded. Select it and use Frame object to locate it.')}).catch(e=>{loading--;status('Could not load splat: '+e.message)});}
  else if(d.type==='mannequin'){if(d.rig===RIG){loading++;status('Loading Quaternius mannequin…');try{o=await riggedMannequin(d);status('Quaternius mannequin ready. Click a limb to pose it.');}finally{loading--}}else o=mannequin(d);}
  else if(d.type==='model'){loading++;status('Loading '+d.name+'…');try{o=await importedModel(d);}catch(e){o=new THREE.Group();status('Could not load '+d.name+': '+e.message);}finally{loading--}}
  else if(d.type==='camera'){o=new THREE.PerspectiveCamera(d.fov||50,Number($('#render-width').value)/Number($('#render-height').value),.01,10000);const h=new THREE.CameraHelper(o);helpers.add(h);o.userData.helper=h;}
  else{o=new THREE.Mesh(d.type==='sphere'?new THREE.SphereGeometry(.25,24,16):d.type==='cylinder'?new THREE.CylinderGeometry(.2,.2,.5,20):new THREE.BoxGeometry(.4,.4,.4),new THREE.MeshStandardMaterial({color:d.color||'#dc8465',roughness:.7}));}
  if(version!==buildVersion){disposeObject(o);return;}if(o.isMesh&&!(o instanceof SplatMesh))o.userData.pickId=d.id;o.name=d.name;setTransform(o,d);objects.set(d.id,o);world.add(o);
 }
 for(const d of doc.objects)if(d.parent){const parent=objects.get(d.parent)?.userData.joints?.[d.part||'rightHand'];if(parent)parent.add(objects.get(d.id));}
 renderer.setClearColor(doc.background||'#20252b');$('#set-background').value=doc.background||'#20252b';$('#set-name').value=doc.name;
 tree();select(selected);resize();imageEditor.load();}
function tree(){const list=$('#set-tree');list.innerHTML=doc.objects.map(d=>`<button class="tree-object ${selected===d.id?'selected':''}" data-object="${d.id}">${esc(d.name)} <small>· ${d.type}${d.parent?' / '+esc(d.part):''}</small></button>${d.type==='mannequin'&&selected?.startsWith(d.id)?joints.map(([name])=>`<button class="tree-object tree-joint ${selected===d.id+':'+name?'selected':''}" data-object="${d.id}:${name}">${name}</button>`).join(''):''}`).join('');list.querySelectorAll('[data-object]').forEach(b=>b.onclick=()=>select(b.dataset.object));
 const previous=$('#render-camera').value;$('#render-camera').innerHTML='<option value="">Current view</option>'+doc.objects.filter(d=>d.type==='camera').map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');$('#render-camera').value=previous;}
function highlightSelection(enabled=true){world.traverse(n=>{if(n.isMesh&&n.userData.pickId?.includes(':')&&n.material?.emissive)n.material.emissive.setHex(enabled&&n.userData.pickId===selected?0x634017:0)});}
function select(id){selected=id;const joint=!!id?.includes(':');ikChain=ikMode&&joint?makeIK(objects.get(rootRecord()?.id)?.userData.joints||{},id.split(':')[1]):null;
 if(joint)gizmo.setMode(ikChain?'translate':'rotate');gizmo.setSpace(ikChain?'world':$('#gizmo-space').value);
 for(const b of document.querySelectorAll('[data-mode]'))b.disabled=joint&&b.dataset.mode!=='rotate';
 const obj=selectedObject();if(ikChain){ikChain.end.getWorldPosition(ikTarget.position);if(!previewCamera)gizmo.attach(ikTarget);else gizmo.detach();}
 else if(obj&&!previewCamera)gizmo.attach(obj);else gizmo.detach();highlightSelection();tree();inspect();}
$('#ik-mode').onclick=()=>{ikMode=!ikMode;$('#ik-mode').setAttribute('aria-pressed',String(ikMode));select(selected);status(ikMode?'IK pose: select an arm or leg, then drag the hand or foot move handles.':'Rotation posing enabled.');};
const pickRay=new THREE.Raycaster();let pickStart=null;
renderer.domElement.addEventListener('pointerdown',e=>{pickStart=e.button===0?{x:e.clientX,y:e.clientY,handle:!!gizmo.axis||gizmo.dragging}:null},true);
renderer.domElement.addEventListener('pointercancel',()=>{pickStart=null});
renderer.domElement.addEventListener('pointerup',e=>{
 const start=pickStart;pickStart=null;if(rendering||!isSelectionClick(start,e))return;
 const rect=renderer.domElement.getBoundingClientRect();world.updateWorldMatrix(true,true);
 pickRay.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),previewCamera||view);
 const id=pickEditable(pickRay,world);if(id){select(id);status(id.includes(':')?'Selected '+id.split(':')[1]+'. Drag a rotation ring or edit its rotation below.':'Object selected.');}
});
renderer.domElement.addEventListener('dblclick',e=>{
 if(rendering||previewCamera)return;
 const rect=renderer.domElement.getBoundingClientRect();world.updateWorldMatrix(true,true);
 pickRay.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),view);
 const id=pickEditable(pickRay,world);if(id){select(id.split(':')[0]);gizmo.setMode('translate');status('Whole model selected. Drag the move handles to reposition it.');}
});
function inspect(){const d=rootRecord(),o=selectedObject(),host=$('#set-inspector');if(!d||!o){host.textContent='Select an object or mannequin joint.';return}const joint=selected.includes(':');
 host.innerHTML=`<label class="field">${joint?'Selected limb / joint':'Name'}<input id="object-name" value="${esc(joint?selected.split(':')[1]:d.name)}" ${joint?'disabled':''}></label>${(joint?['rotation']:['position','rotation','scale']).map(key=>`<label>${key==='rotation'?'Rotation · degrees':key}</label><div class="xyz">${['x','y','z'].map(axis=>`<label>${axis.toUpperCase()}<input data-transform="${key}" data-axis="${axis}" type="number" step="${key==='rotation'?1:.05}" ${key==='scale'?'min="0.01"':''} value="${(key==='rotation'?THREE.MathUtils.radToDeg(o[key][axis]):o[key][axis]).toFixed(3)}"></label>`).join('')}</div>`).join('')}${d.type==='splat'?'<p class="hint">Splat scaling is uniform. Change any scale axis to resize the set.</p>':''}${['mannequin','box','sphere','cylinder'].includes(d.type)?`<label class="field">Color<input id="object-color" type="color" value="${d.color||'#c6b6a3'}"></label>`:''}${d.type==='model'?`<label class="field"><span><input id="model-textures" type="checkbox" ${d.textures_enabled!==false?'checked':''}> Show textures</span></label><p class="hint">Turn off texture maps while keeping material colors. Applies to camera renders too.</p>`:''}${d.type==='camera'?`<label class="field">Lens · vertical field of view<input id="camera-fov" type="number" min="10" max="120" value="${d.fov||50}"></label><button id="camera-view">Look through camera</button><button id="camera-capture">Update from current view</button>`:''}${d.type==='mannequin'?'<button id="pose-neutral">Neutral pose</button><button id="pose-t">T pose</button>':''}${['box','sphere','cylinder','model'].includes(d.type)?`<label class="field">Attach to mannequin<select id="object-parent"><option value="">None · world</option>${doc.objects.filter(x=>x.type==='mannequin').map(x=>`<option value="${x.id}" ${d.parent===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label class="field">Body part<select id="object-part">${joints.map(([n])=>`<option ${n===(d.part||'rightHand')?'selected':''}>${n}</option>`).join('')}</select></label><p class="hint">Attachments use local coordinates relative to the body part. Moving a joint moves its attached props.</p>`:''}<button id="delete-object" class="danger">Delete ${joint?'mannequin':d.type}</button>`;
 if(d.type==='mannequin')host.insertBefore(handControls(objects.get(d.id),checkpoint,()=>{syncTransforms();dirty=true}),$('#delete-object'));
 host.querySelectorAll('[data-transform]').forEach(input=>input.onchange=()=>{const v=Number(input.value),key=input.dataset.transform;if(!Number.isFinite(v)||(key==='scale'&&v<=0))return;checkpoint();if(key==='scale'&&d.type==='splat')o.scale.setScalar(v);else o[key][input.dataset.axis]=key==='rotation'?THREE.MathUtils.degToRad(v):v;syncTransforms();if(ikChain)ikChain.end.getWorldPosition(ikTarget.position);});
 $('#object-name').onchange=e=>{checkpoint();d.name=e.target.value;tree()};
 if($('#object-color'))$('#object-color').onchange=e=>{checkpoint();d.color=e.target.value;objects.get(d.id).traverse(n=>{if(n.material&&(n.userData.pickId===d.id||n.userData.pickId?.startsWith(d.id+':')))n.material.color.set(d.color)});};
 if($('#model-textures'))$('#model-textures').onchange=e=>{checkpoint();d.textures_enabled=e.target.checked;setModelTextures(objects.get(d.id),d.textures_enabled);};
 if(d.type==='camera'){$('#camera-fov').onchange=e=>{checkpoint();d.fov=THREE.MathUtils.clamp(Number(e.target.value)||50,10,120);o.fov=d.fov;o.updateProjectionMatrix()};$('#camera-view').onclick=()=>{previewCamera=o;orbit.enabled=false;gizmo.detach();$('#render-camera').value=d.id;$('#viewport-label').textContent=d.name;resize()};$('#camera-capture').onclick=()=>{checkpoint();o.position.copy(view.position);o.quaternion.copy(view.quaternion);syncTransforms();select(selected)};}
 if(d.type==='mannequin')for(const key of ['neutral','t'])$('#pose-'+key).onclick=()=>{checkpoint();const preset=objects.get(d.id).userData.posePresets?.[key];if(preset){for(const [name,angles] of Object.entries(preset))objects.get(d.id).userData.joints[name].rotation.set(...angles);syncTransforms();select(selected);return;}for(const j of Object.values(objects.get(d.id).userData.joints))j.rotation.set(0,0,0);if(key==='t'){objects.get(d.id).userData.joints.leftShoulder.rotation.z=-Math.PI/2;objects.get(d.id).userData.joints.rightShoulder.rotation.z=Math.PI/2}syncTransforms();select(selected)};
 if($('#object-parent')){const attach=()=>{checkpoint();d.parent=$('#object-parent').value||null;d.part=$('#object-part').value;const parent=objects.get(d.parent)?.userData.joints?.[d.part]||world;if(d.type==='model'){world.updateMatrixWorld(true);parent.attach(o);if(d.parent)o.position.set(0,0,0);}else{parent.add(o);o.position.set(0,0,0);}syncTransforms();tree();inspect()};$('#object-parent').onchange=$('#object-part').onchange=attach;}
 $('#delete-object').onclick=guard(async()=>{checkpoint();doc.objects=doc.objects.filter(x=>x.id!==d.id&&x.parent!==d.id);selected=null;await rebuild()});
}
function add(type,extra={}){checkpoint();const d={id:uid(),type,name:type[0].toUpperCase()+type.slice(1)+' '+(doc.objects.filter(x=>x.type===type).length+1),position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:'#c6b6a3',...extra};doc.objects.push(d);selected=d.id;return rebuild()}
function resize(){if(rendering)return;const el=$('#set-viewport');let w=el.clientWidth,h=el.clientHeight;const aspect=Number($('#render-width').value)/Number($('#render-height').value);view.aspect=w/h;view.updateProjectionMatrix();if(previewCamera&&Number.isFinite(aspect)&&aspect>0){if(w/h>aspect)w=h*aspect;else h=w/aspect;previewCamera.aspect=aspect;previewCamera.updateProjectionMatrix()}renderer.setSize(w,h);}
for(const id of ['render-width','render-height'])$('#'+id).onchange=()=>{for(const o of objects.values())if(o.isPerspectiveCamera){o.aspect=Number($('#render-width').value)/Number($('#render-height').value);o.updateProjectionMatrix()}resize()};
new ResizeObserver(resize).observe($('#set-viewport'));
renderer.setAnimationLoop(()=>{if(rendering)return;orbit.update();const picked=selectedObject();jointMarker.visible=!!picked&&!!selected?.includes(':')&&rootRecord()?.rig===RIG;if(jointMarker.visible)picked.getWorldPosition(jointMarker.position);for(const o of objects.values())o.userData.helper?.update();helpers.visible=$('#show-guides').checked&&!previewCamera;renderer.render(scene,previewCamera||view)});
async function refresh(){if(refreshing)return;refreshing=true;try{const [data,state]=await Promise.all([api('/api/set-studio'),api('/api/state')]);library=data;imageEditor.refresh(state);const current=data.sets.some(s=>s.id===doc.id)?doc.id:$('#saved-sets').value;$('#saved-sets').innerHTML='<option value="">Open saved set…</option>'+data.sets.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#saved-sets').value=current;
 for(const [id,items] of [['source-image',Object.values(state.assets).filter(a=>a.kind==='image')],['splat-library',data.splats],['model-library',data.models||[]]]){const el=$('#'+id),old=el.value;el.innerHTML=items.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');if(items.some(a=>a.id===old))el.value=old;}
 $('#set-jobs').innerHTML=state.jobs.filter(j=>j.kind==='splat').slice(-5).reverse().map(j=>`<div class="set-job">${esc(j.name)} · ${esc(j.stage)}${j.error?'<br>'+esc(j.error):''}${j.status==='completed'&&j.splat_id?`<button data-show-splat="${j.splat_id}">Show in viewport</button>`:''}${!['completed','failed','cancelled'].includes(j.status)?`<button data-cancel="${j.id}">Cancel</button>`:''}</div>`).join('');$('#set-jobs').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=guard(async()=>{await api(`/api/jobs/${b.dataset.cancel}/cancel`,{});await refresh()}));
 $('#set-jobs').querySelectorAll('[data-show-splat]').forEach(b=>b.onclick=guard(()=>showSplat(b.dataset.showSplat)));
 for(const j of state.jobs){if(!pendingSplats.has(j.id))continue;if(['failed','cancelled'].includes(j.status))pendingSplats.delete(j.id);else if(j.status==='completed'&&j.splat_id&&pendingSplats.get(j.id)===doc.id){pendingSplats.delete(j.id);await showSplat(j.splat_id);}}
 }finally{refreshing=false;}}
async function showSplat(sid){
 const item=library.splats.find(s=>s.id===sid);if(!item)throw Error('Choose a saved splat first.');
 const existing=doc.objects.find(o=>o.type==='splat'&&o.splat_id===sid);
 if(existing)select(existing.id);else await add('splat',{splat_id:sid,name:item.name,rotation:item.source_image?[Math.PI,0,0]:[0,0,0]});
 const object=selectedObject(),setId=doc.id,objectId=selected;
 status('Loading splat into the viewport…');await object.initialized;
 if(doc.id!==setId||objects.get(objectId)!==object)return;
 select(objectId);frameObject(object);status('Splat visible. Save set to keep it in this scene.');
}
$('#save-set').onclick=guard(async()=>{syncTransforms();doc.name=$('#set-name').value;doc=await api('/api/set-studio/sets/'+doc.id,doc,'PUT');dirty=false;select(selected);await refresh();status('Set saved.');});
$('#save-set-as').onclick=guard(async()=>{
 const name=prompt('Save a copy of this set as:',(doc.name||'Untitled set')+' copy');
 if(name===null)return;
 if(!name.trim()||name.trim().length>200)throw Error('Enter a set name of 1–200 characters.');
 syncTransforms();const source=doc,before=JSON.stringify(doc),copy=structuredClone(doc),button=$('#save-set-as');
 copy.id=uid();copy.version=0;copy.name=name.trim();delete copy.updated;
 button.disabled=true;
 try{
  const saved=await api('/api/set-studio/sets/'+copy.id,copy,'PUT');
  if(doc===source){
   syncTransforms();const changedDuringSave=JSON.stringify(doc)!==before;
   // Keep any edits made while saving, but subsequent saves belong to the new copy.
   doc.id=saved.id;doc.version=saved.version;doc.updated=saved.updated;doc.name=saved.name;
   dirty=changedDuringSave;undo=[];$('#set-name').value=doc.name;imageEditor.load();
   status(changedDuringSave?'Copy saved. Your newer edits can be saved to this copy.':'Copy saved. You are now editing '+saved.name+'.');
  }else status('Copy saved as '+saved.name+'.');
  await refresh();
 }finally{button.disabled=false}
});
$('#set-name').oninput=()=>{doc.name=$('#set-name').value;dirty=true};
$('#saved-sets').onchange=guard(async e=>{const d=library.sets.find(s=>s.id===e.target.value);if(!d)return;if(dirty&&!confirm('Discard unsaved set edits?'))return;doc=structuredClone(d);undo=[];selected=null;dirty=false;await rebuild();status('Set opened.')});
$('#new-set').onclick=guard(async()=>{if(dirty&&!confirm('Discard unsaved set edits?'))return;doc={id:uid(),name:'Untitled set',objects:[],background:'#20252b',version:0};undo=[];dirty=false;selected=null;await rebuild()});
$('#add-mannequin').onclick=guard(()=>add('mannequin',{rig:RIG}));$('#add-primitive').onclick=guard(()=>add($('#primitive-type').value,{position:[0,1,0]}));$('#add-camera').onclick=guard(()=>add('camera',{position:view.position.toArray(),rotation:[view.rotation.x,view.rotation.y,view.rotation.z],fov:view.fov}));
$('#add-splat').onclick=guard(()=>showSplat($('#splat-library').value));
$('#generate-splat').onclick=guard(async()=>{const b=$('#generate-splat');b.disabled=true;try{const setId=doc.id;const job=await api('/api/set-studio/generate',{image_id:$('#source-image').value});pendingSplats.set(job.id,setId);status('Splat reconstruction queued. It will appear here automatically when ready.');await refresh()}finally{b.disabled=false}});
async function showModel(item){await add('model',{model_id:item.id,name:item.name});const o=selectedObject();if(o?.userData.importedModel){frameObject(o);status('GLB model added. Move, rotate or scale it, then save the set.');}}
$('#add-model').onclick=guard(async()=>{const item=library.models?.find(m=>m.id===$('#model-library').value);if(!item)throw Error('Import or select a GLB model first.');await showModel(item)});
$('#import-model').onclick=()=>$('#glb-file').click();
$('#glb-file').onchange=guard(async e=>{
 const file=e.target.files[0];if(!file)return;const button=$('#import-model'),setId=doc.id;button.disabled=true;
 try{if(!/\.glb$/i.test(file.name))throw Error('Choose a GLB model file.');if(file.size>256*1024*1024)throw Error('GLB models must be below 256 MB.');const form=new FormData();form.append('file',file);status('Importing GLB model…');const item=await api('/api/set-studio/models/import',form);await refresh();$('#model-library').value=item.id;if(doc.id===setId)await showModel(item);else status('Model imported. Select it from Imported models to add it to this set.');}
 finally{button.disabled=false;e.target.value=''}
});
$('#import-splat').onclick=()=>$('#ply-file').click();$('#ply-file').onchange=guard(async e=>{const file=e.target.files[0];if(!file)return;const fd=new FormData();fd.append('file',file);status('Importing splat…');const s=await api('/api/set-studio/import',fd);await refresh();$('#splat-library').value=s.id;await showSplat(s.id);e.target.value=''});
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{if(ikMode){ikMode=false;$('#ik-mode').setAttribute('aria-pressed','false');select(selected)}gizmo.setMode(b.dataset.mode);};$('#gizmo-space').onchange=e=>gizmo.setSpace(ikChain?'world':e.target.value);
$('#free-view').onclick=()=>{previewCamera=null;orbit.enabled=true;$('#viewport-label').textContent='Free view';select(selected);resize()};
function frameObject(o){if(!o)return;o.updateWorldMatrix(true,true);const box=o instanceof SplatMesh?o.getBoundingBox().applyMatrix4(o.matrixWorld):new THREE.Box3().setFromObject(o);if(box.isEmpty())return;const center=box.getCenter(new THREE.Vector3()),size=Math.max(.5,box.getSize(new THREE.Vector3()).length());orbit.target.copy(center);view.position.copy(center).add(new THREE.Vector3(size*.65,size*.32,size*1.15));view.lookAt(center);$('#free-view').click();}
$('#focus-object').onclick=guard(async()=>{const o=selectedObject();if(o instanceof SplatMesh)await o.initialized;if(o===selectedObject())frameObject(o)});
$('#undo-set').onclick=guard(async()=>{if(!undo.length)return;const version=doc.version;doc=JSON.parse(undo.pop());doc.version=version;selected=null;dirty=true;await rebuild()});
$('#set-background').oninput=e=>{doc.background=e.target.value;renderer.setClearColor(doc.background);dirty=true};
async function capture(){if(loading)throw Error('Wait for the scene models to finish loading.');const w=Number($('#render-width').value),h=Number($('#render-height').value);if(![w,h].every(n=>Number.isInteger(n)&&n>=64&&n<=4096))throw Error('Render dimensions must be 64–4096 pixels.');const cam=objects.get($('#render-camera').value)||previewCamera||view;rendering=true;const aspect=cam.aspect,ratio=renderer.getPixelRatio(),guideVisible=helpers.visible;gizmo.detach();helpers.visible=false;highlightSelection(false);
 try{cam.aspect=w/h;cam.updateProjectionMatrix();cam.updateMatrixWorld();renderer.setPixelRatio(1);renderer.setSize(w,h,false);renderer.setClearColor(doc.background,$('#transparent-render').checked?0:1);scene.updateMatrixWorld(true);await spark.viewpoint.prepare({scene,camera:cam});renderer.render(scene,cam);const blob=await new Promise(r=>renderer.domElement.toBlob(r,'image/png'));if(!blob)throw Error('Browser could not create the PNG.');return blob;}
 finally{cam.aspect=aspect;cam.updateProjectionMatrix();renderer.setPixelRatio(ratio);renderer.setClearColor(doc.background,1);helpers.visible=guideVisible;rendering=false;resize();select(selected);}}
async function render(save){$('#render-set').disabled=$('#download-render').disabled=true;status('Rendering camera…');try{const blob=await capture();if(save){const fd=new FormData();fd.append('file',blob,(doc.name||'Set')+' render.png');const a=await api('/api/set-studio/render',fd);$('#render-result').innerHTML=`<img src="/api/assets/${a.id}/file" alt="Rendered set"><p>Saved to image assets: ${esc(a.name)}</p>`;status('Rendered image added to the asset library.');}else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=doc.name+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('PNG downloaded.')}}finally{$('#render-set').disabled=$('#download-render').disabled=false}}
$('#render-set').onclick=guard(()=>render(true));$('#download-render').onclick=guard(()=>render(false));
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
const imageEditor=setupImageEditor({api,capture,guard,status,getDoc:()=>doc,changed:()=>{dirty=true}});
await refresh();resize();status('Ready. Generate a splat, or select a saved splat and click Show splat in viewport.');setInterval(()=>refresh().catch(e=>status(e.message)),6000);
