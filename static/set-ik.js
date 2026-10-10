import * as THREE from 'three';
export function ikNames(name){
 const side=name?.startsWith('left')?'left':name?.startsWith('right')?'right':null;
 if(!side)return null;
 if(['Shoulder','Elbow','Hand'].some(part=>name===side+part))return [side+'Shoulder',side+'Elbow',side+'Hand'];
 if(['Hip','Knee','Foot'].some(part=>name===side+part))return [side+'Hip',side+'Knee',side+'Foot'];
 return null;
}
const point=(bone,frame)=>frame.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
export function makeIK(joints,name){
 const names=ikNames(name);if(!names)return null;
 const [upper,middle,end]=names.map(n=>joints[n]);if(!upper||!middle||!end)return null;
 upper.updateWorldMatrix(true,true);const frame=upper.parent;
 const a=point(upper,frame),b=point(middle,frame),c=point(end,frame),axis=c.clone().sub(a).normalize();
 let pole=b.clone().sub(a);pole.addScaledVector(axis,-pole.dot(axis));
 if(pole.lengthSq()<1e-7){pole.set(0,0,1);pole.addScaledVector(axis,-pole.dot(axis));if(pole.lengthSq()<1e-7)pole.set(1,0,0).addScaledVector(axis,-axis.x);}
 return {upper,middle,end,frame,pole:pole.normalize(),lengths:[a.distanceTo(b),b.distanceTo(c)]};
}
function aim(joint,child,worldGoal){
 joint.updateWorldMatrix(true,true);
 const from=joint.worldToLocal(child.getWorldPosition(new THREE.Vector3())).normalize();
 const to=joint.worldToLocal(worldGoal.clone()).normalize();
 if(from.lengthSq()&&to.lengthSq())joint.quaternion.multiply(new THREE.Quaternion().setFromUnitVectors(from,to));
 joint.updateWorldMatrix(true,true);
}
// Solve in the shoulder/hip parent's coordinates so model rotation/scale is respected.
// Only joint rotations change; bone lengths and the mannequin root stay untouched.
export function solveIK(chain,worldTarget){
 const {upper,middle,end,frame,pole,lengths:[l1,l2]}=chain;
 if(Math.min(l1,l2)<1e-6)return;
 frame.updateWorldMatrix(true,true);
 const a=point(upper,frame),target=frame.worldToLocal(worldTarget.clone()),direction=target.sub(a);
 if(direction.lengthSq()<1e-12)direction.copy(point(end,frame).sub(a));
 const distance=THREE.MathUtils.clamp(direction.length(),Math.abs(l1-l2)+1e-5,l1+l2-1e-5);direction.normalize();
 const bend=pole.clone().addScaledVector(direction,-pole.dot(direction));
 if(bend.lengthSq()<1e-8){bend.set(1,0,0).addScaledVector(direction,-direction.x);if(bend.lengthSq()<1e-8)bend.set(0,1,0).addScaledVector(direction,-direction.y);}
 bend.normalize();
 const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 const elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,height),goal=a.clone().addScaledVector(direction,distance);
 aim(upper,middle,frame.localToWorld(elbow));aim(middle,end,frame.localToWorld(goal));
}
