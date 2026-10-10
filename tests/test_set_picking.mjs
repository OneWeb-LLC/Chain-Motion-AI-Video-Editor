import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../static/vendor/three/three.module.js';
import {pickEditable,isSelectionClick} from '../static/set-picking.js';

test('picks the frontmost editable limb and follows joint transforms',()=>{
 const world=new THREE.Group(),joint=new THREE.Group();world.add(joint);
 const limb=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
 limb.userData.pickId='person:rightElbow';joint.add(limb);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,-1));
 world.updateMatrixWorld(true);assert.equal(pickEditable(ray,world),'person:rightElbow');
 joint.position.x=3;world.updateMatrixWorld(true);assert.equal(pickEditable(ray,world),null);
 ray.ray.origin.x=3;assert.equal(pickEditable(ray,world),'person:rightElbow');
 const prop=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());prop.position.z=2;prop.userData.pickId='prop';joint.add(prop);world.updateMatrixWorld(true);
 assert.equal(pickEditable(ray,world),'prop');
});
test('orbit drags, right clicks and transform handle drags do not select limbs',()=>{
 const start={x:10,y:20,handle:false};
 assert.equal(isSelectionClick(start,{clientX:12,clientY:22,button:0}),true);
 assert.equal(isSelectionClick(start,{clientX:18,clientY:20,button:0}),false);
 assert.equal(isSelectionClick(start,{clientX:10,clientY:20,button:2}),false);
 assert.equal(isSelectionClick({...start,handle:true},{clientX:10,clientY:20,button:0}),false);
});
