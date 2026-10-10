import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {riggedMannequin,BONE_NAMES} from '../static/rigged-mannequin.js';
import {pickEditable} from '../static/set-picking.js';
const bytes=await readFile(new URL('../static/models/quaternius/mannequin.glb',import.meta.url));
globalThis.ProgressEvent=class {constructor(type,values){Object.assign(this,values)}};
// The loader's only network request is the bundled model, served here from disk.
globalThis.Request=class {constructor(url){this.url=url}};
globalThis.fetch=async req=>{assert.equal(req.url,'/static/models/quaternius/mannequin.glb');return new Response(bytes,{status:200,headers:{'Content-Length':String(bytes.length)}})};

test('bundled mannequin has independent poseable bones and durable hand attachments',async()=>{
 const a=await riggedMannequin({id:'a',color:'#ff0000'}),b=await riggedMannequin({id:'b',color:'#00ff00'});
 assert.equal(Object.keys(a.userData.joints).length,Object.keys(BONE_NAMES).length);
 const arm=a.userData.joints.leftElbow,other=b.userData.joints.leftElbow,old=other.rotation.x;
 const prop=new THREE.Object3D();a.userData.joints.leftHand.add(prop);a.updateMatrixWorld(true);const before=prop.getWorldPosition(new THREE.Vector3());
 arm.rotation.x+=1;a.updateMatrixWorld(true);assert.ok(prop.getWorldPosition(new THREE.Vector3()).distanceTo(before)>.05);assert.equal(other.rotation.x,old);
 const pose=Object.fromEntries(Object.entries(a.userData.joints).map(([n,j])=>[n,[j.rotation.x,j.rotation.y,j.rotation.z]]));
 const restored=await riggedMannequin({id:'restored',pose});assert.deepEqual(restored.userData.joints.leftElbow.rotation.toArray(),arm.rotation.toArray());
 let skins=0;a.traverse(n=>{if(n.isSkinnedMesh){skins++;assert.equal(n.userData.bonePickIds.length,n.skeleton.bones.length);assert.equal(n.material.color.getHex(),0xff0000)}});assert.ok(skins>0);
 // Raycast the actual rigged surface, not a placeholder mesh.
 const world=new THREE.Group();world.add(b);world.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,1.6,4),new THREE.Vector3(0,0,-1));
 assert.match(pickEditable(ray,world)||'',/^b:/);
});

test('IK reaches hand and foot targets while preserving bones under model transforms',async()=>{
 const {makeIK,solveIK}=await import('../static/set-ik.js');
 const model=await riggedMannequin({id:'ik'});model.rotation.y=.7;model.scale.set(1.2,.9,1.1);model.position.set(2,0,-1);model.updateMatrixWorld(true);
 for(const name of ['leftHand','rightFoot']){
  const chain=makeIK(model.userData.joints,name),before=chain.middle.position.clone(),root=model.position.clone();
  const shoulder=chain.upper.getWorldPosition(new THREE.Vector3()),target=chain.end.getWorldPosition(new THREE.Vector3()).lerp(shoulder,.25);target.z+=.06;
  solveIK(chain,target);assert.ok(chain.end.getWorldPosition(new THREE.Vector3()).distanceTo(target)<.005);
  assert.deepEqual(chain.middle.position.toArray(),before.toArray());assert.deepEqual(model.position.toArray(),root.toArray());
  solveIK(chain,new THREE.Vector3(100,100,100));assert.ok(chain.end.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite));
 }
});

test('finger curls are independent, reproducible and preserve wrist and IK poses',async()=>{
 const {applyHandPose}=await import('../static/hand-poses.js');
 const a=await riggedMannequin({id:'hands'}),b=await riggedMannequin({id:'other'});
 const hand=a.userData.joints.leftHand,wrist=hand.quaternion.clone(),rig=a.userData.handRig;
 const middle=rig.left.middle.map(x=>x.bone.quaternion.clone()),right=rig.right.index.map(x=>x.bone.quaternion.clone());
 const tip=rig.left.index[2].bone,open=tip.getWorldPosition(new THREE.Vector3());
 applyHandPose(a,{left:{index:1}});
 assert.ok(tip.getWorldPosition(new THREE.Vector3()).distanceTo(open)>.015);
 assert.ok(rig.left.index.some(x=>x.bone.quaternion.angleTo(x.open)>.3));
 middle.forEach((q,i)=>assert.ok(q.angleTo(rig.left.middle[i].bone.quaternion)<1e-6));right.forEach((q,i)=>assert.ok(q.angleTo(rig.right.index[i].bone.quaternion)<1e-6));
 assert.ok(wrist.angleTo(hand.quaternion)<1e-6);assert.equal(b.userData.handPose.left.index,0);
 const saved=await riggedMannequin({id:'saved',hands:a.userData.handPose});assert.deepEqual(saved.userData.handPose,a.userData.handPose);
 rig.left.index.forEach((x,i)=>assert.ok(x.bone.quaternion.angleTo(saved.userData.handRig.left.index[i].bone.quaternion)<1e-6));
 applyHandPose(a,{});rig.left.index.forEach(x=>assert.ok(x.bone.quaternion.angleTo(x.open)<1e-6));
});
