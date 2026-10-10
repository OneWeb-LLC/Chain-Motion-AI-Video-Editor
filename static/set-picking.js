// Pick only editable surfaces. Splat rendering and transform handles are excluded.
export function pickEditable(raycaster, world) {
  const targets=[];
  world.traverse(object=>{if(object.isMesh&&object.visible&&object.userData.pickId)targets.push(object)});
  // Skinned mesh bounds change when a joint is posed.
  for(const object of targets)if(object.isSkinnedMesh){object.computeBoundingSphere();object.computeBoundingBox();}
  const hit=raycaster.intersectObjects(targets,false)[0];
  if(!hit)return null;
  const mesh=hit.object;
  if(mesh.isSkinnedMesh&&mesh.userData.bonePickIds&&hit.face){
    const weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex,scores=new Map();
    const bary=hit.barycoord?[hit.barycoord.x,hit.barycoord.y,hit.barycoord.z]:[1/3,1/3,1/3];
    [hit.face.a,hit.face.b,hit.face.c].forEach((v,i)=>{for(let c=0;c<4;c++){const id=mesh.userData.bonePickIds[indices.getComponent(v,c)];if(id)scores.set(id,(scores.get(id)||0)+weights.getComponent(v,c)*bary[i]);}});
    return [...scores].sort((a,b)=>b[1]-a[1])[0]?.[0]||mesh.userData.pickId;
  }
  return mesh.userData.pickId;
}

export function isSelectionClick(start, event) {
  return !!start && !start.handle && event.button===0 &&
    Math.hypot(event.clientX-start.x,event.clientY-start.y)<5;
}
