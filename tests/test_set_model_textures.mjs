import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {setModelTextures,disposeModelTextures} from '../static/set-models.js';

test('texture toggle restores maps, preserves colors, and disposes hidden textures',()=>{
 const root=new THREE.Group(),map=new THREE.Texture(),normal=new THREE.Texture();
 const material=new THREE.MeshStandardMaterial({map,normalMap:normal,color:0x884422});
 root.add(new THREE.Mesh(new THREE.BoxGeometry(),[material,material]));
 const other=new THREE.MeshStandardMaterial({map});
 setModelTextures(root,false);
 assert.equal(material.map,null);assert.equal(material.normalMap,null);assert.equal(material.color.getHex(),0x884422);assert.equal(other.map,map);
 setModelTextures(root,false);setModelTextures(root,true);
 assert.equal(material.map,map);assert.equal(material.normalMap,normal);
 setModelTextures(root,false);let disposed=0;
 map.addEventListener('dispose',()=>disposed++);normal.addEventListener('dispose',()=>disposed++);
 disposeModelTextures(root);assert.equal(disposed,2);
});
