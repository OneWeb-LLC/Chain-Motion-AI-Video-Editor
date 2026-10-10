import * as THREE from 'three';
export const FINGERS=['thumb','index','middle','ring','pinky'];
export function applyHandPose(root,values={}){
 const rig=root.userData.handRig;if(!rig)return;
 const pose={};
 for(const side of ['left','right']){
  pose[side]={};
  for(const finger of FINGERS){
   const value=Number(values[side]?.[finger]??0),amount=Number.isFinite(value)?THREE.MathUtils.clamp(value,0,1):0;
   pose[side][finger]=amount;
   for(const {bone,open,closed} of rig[side][finger])bone.quaternion.copy(open).slerp(closed,amount);
  }
 }
 root.userData.handPose=pose;root.updateMatrixWorld(true);
}
export function buildHandRig(root,model,openPose,closedPose,values){
 const bones={};model.traverse(n=>{if(n.isBone)bones[n.name]=n});const rig={};
 for(const [side,suffix] of [['left','l'],['right','r']]){
  rig[side]={};for(const finger of FINGERS){rig[side][finger]=[];
   for(let i=1;i<=3;i++){
    const name=`${finger}_0${i}_${suffix}`,bone=bones[name];if(!bone||!openPose[name]||!closedPose[name])throw Error('Missing finger bone: '+name);
    const quaternion=angles=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles));
    rig[side][finger].push({bone,open:quaternion(openPose[name]),closed:quaternion(closedPose[name])});
   }
  }
 }
 root.userData.handRig=rig;applyHandPose(root,values);
}
export function handControls(root,checkpoint,changed){
 const container=document.createElement('section');container.className='hand-controls';
 if(!root.userData.handRig){container.innerHTML='<p class="hint">Finger controls are available on the Quaternius mannequin. Add a new mannequin to use them.</p>';return container;}
 const title=s=>s[0].toUpperCase()+s.slice(1);
 for(const side of ['left','right']){
  const group=document.createElement('details');group.open=true;group.innerHTML=`<summary>${title(side)} hand</summary><p class="hint">0% open · 100% closed. Grasp sets all five fingers; individual sliders refine the pose.</p>`;
  for(const finger of ['grasp',...FINGERS]){
   const label=document.createElement('label');label.className='hand-slider';label.innerHTML=`<span>${finger==='grasp'?'Whole hand grasp':title(finger)} <output></output></span><input type="range" min="0" max="100" step="1" aria-label="${title(side)} ${finger==='grasp'?'hand grasp':finger+' curl'}">`;
   const input=label.querySelector('input');input.dataset.hand=side;input.dataset.finger=finger;let editing=false;
   const begin=()=>{if(!editing){checkpoint();editing=true}};
   input.onpointerdown=begin;input.oninput=()=>{begin();const pose=structuredClone(root.userData.handPose),v=Number(input.value)/100;
    if(finger==='grasp')for(const name of FINGERS)pose[side][name]=v;else pose[side][finger]=v;
    applyHandPose(root,pose);changed();refresh();
   };input.onchange=input.onblur=input.onpointercancel=()=>{editing=false};group.append(label);
  }
  container.append(group);
 }
 function refresh(){for(const input of container.querySelectorAll('input')){const values=root.userData.handPose[input.dataset.hand],v=input.dataset.finger==='grasp'?FINGERS.reduce((sum,f)=>sum+values[f],0)/5:values[input.dataset.finger];input.value=Math.round(v*100);input.previousElementSibling.querySelector('output').textContent=input.value+'%';}}
 refresh();return container;
}
