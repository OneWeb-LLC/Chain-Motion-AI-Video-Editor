import * as THREE from 'three';
import {buildHandRig} from './hand-poses.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

export const RIG='quaternius-v1';
export const BONE_NAMES={hips:'pelvis',spine:'spine_01',chest:'spine_03',neck:'neck_01',head:'Head',leftShoulder:'upperarm_l',leftElbow:'lowerarm_l',leftHand:'hand_l',rightShoulder:'upperarm_r',rightElbow:'lowerarm_r',rightHand:'hand_r',leftHip:'thigh_l',leftKnee:'calf_l',leftFoot:'foot_l',rightHip:'thigh_r',rightKnee:'calf_r',rightFoot:'foot_r'};
let template;
function loadTemplate(){return template??=new GLTFLoader().loadAsync('/static/models/quaternius/mannequin.glb').catch(e=>{template=null;throw e})}
function samplePose(scene,animations,name){
 const mixer=new THREE.AnimationMixer(scene),clip=THREE.AnimationClip.findByName(animations,name);
 if(!clip)throw Error('Mannequin pose missing: '+name);
 mixer.clipAction(clip).play();mixer.setTime(0);
 const pose={};scene.traverse(n=>{if(n.isBone)pose[n.name]=[n.rotation.x,n.rotation.y,n.rotation.z]});
 mixer.stopAllAction();mixer.uncacheRoot(scene);return pose;
}
export async function riggedMannequin(data){
 const asset=await loadTemplate(),model=clone(asset.scene),root=new THREE.Group();root.add(model);
 const tPose=samplePose(model,asset.animations,'A_TPose'),neutral=samplePose(model,asset.animations,'Idle_Loop'),grasp=samplePose(model,asset.animations,'Punch_Cross');
 const parts={},aliases=new Map(Object.entries(BONE_NAMES).map(([alias,name])=>[name,alias]));
 model.traverse(n=>{if(n.isBone){n.rotation.set(...tPose[n.name]);if(aliases.has(n.name))parts[aliases.get(n.name)]=n}});
 for(const name of Object.keys(BONE_NAMES))if(!parts[name])throw Error('Mannequin joint missing: '+name);
 model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model,true),scale=1.8/bounds.getSize(new THREE.Vector3()).y;
 model.scale.setScalar(scale);model.position.y=-bounds.min.y*scale;
 model.traverse(n=>{if(n.isMesh){n.geometry=n.geometry.clone();n.material=new THREE.MeshStandardMaterial({color:data.color||'#c6b6a3',roughness:.75});n.userData.pickId=data.id;n.frustumCulled=false;
  if(n.isSkinnedMesh){n.userData.bonePickIds=n.skeleton.bones.map(b=>{let current=b;while(current){if(aliases.has(current.name))return data.id+':'+aliases.get(current.name);current=current.parent}return data.id+':hips'});}
 }});
 root.userData.joints=parts;
 root.userData.posePresets={t:Object.fromEntries(Object.entries(BONE_NAMES).map(([a,b])=>[a,tPose[b]])),neutral:Object.fromEntries(Object.entries(BONE_NAMES).map(([a,b])=>[a,neutral[b]]))};
 for(const [name,bone] of Object.entries(parts))bone.rotation.set(...(data.pose?.[name]||neutral[BONE_NAMES[name]]));
 buildHandRig(root,model,tPose,grasp,data.hands);
 root.updateMatrixWorld(true);return root;
}
