import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const textureMaps=new WeakMap();

export function setModelTextures(root,enabled){
 root.traverse(n=>{
  if(!n.isMesh)return;
  for(const material of Array.isArray(n.material)?n.material:[n.material]){
   if(!material)continue;
   if(!textureMaps.has(material))textureMaps.set(material,Object.fromEntries(Object.entries(material).filter(([,value])=>value?.isTexture)));
   for(const [key,texture] of Object.entries(textureMaps.get(material)))material[key]=enabled?texture:null;
   material.needsUpdate=true;
  }
 });
}

export function disposeModelTextures(root){
 const textures=new Set();
 root.traverse(n=>{for(const material of Array.isArray(n.material)?n.material:[n.material]){
  if(material)for(const texture of Object.values(textureMaps.get(material)||{}))textures.add(texture);
 }});
 for(const texture of textures)texture.dispose();
}

export async function importedModel(data){
 const asset=await new GLTFLoader().loadAsync(`/api/set-studio/models/${encodeURIComponent(data.model_id)}/file.glb`);
 const root=new THREE.Group();root.add(asset.scene);
 // Preserve authored node transforms beneath an independent staging transform.
 root.traverse(n=>{if(n.isMesh){n.userData.pickId=data.id;if(n.isSkinnedMesh)n.frustumCulled=false;}});
 root.userData.importedModel=true;
 setModelTextures(root,data.textures_enabled!==false);
 return root;
}
