export function orderedReferences(scene,segment){
 const ids=[...new Set([...(scene?.refs||[]),...(segment?.refs||[])])];
 return [...new Set([...(segment?.ref_order||[]).filter(id=>ids.includes(id)),...ids])];
}
export function moveImageReference(ids,assets,source,target){
 const images=ids.filter(id=>assets[id]?.kind==='image');
 const from=images.indexOf(source),to=images.indexOf(target);
 if(from<0||to<0||from===to)return ids;
 images.splice(to,0,images.splice(from,1)[0]);let i=0;
 return ids.map(id=>assets[id]?.kind==='image'?images[i++]:id);
}
