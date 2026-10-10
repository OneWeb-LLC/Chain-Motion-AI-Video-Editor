const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupImageEditor({api,capture,guard,status,getDoc,changed}){
 let assets={},seen=null,shownSet=null,busy=false,previousPrompt=null;
 const draft=()=>getDoc().image_edit??={prompt:'',refs:[],seed:42,randomize_seed:true};
 function refs(){const d=draft();$('#edit-refs').innerHTML=d.refs.map((id,i)=>`<div class="edit-ref"><img src="/api/assets/${id}/file" alt="Image ${i+2}"><span>Image ${i+2} · ${esc(assets[id]?.name||'Reference')}</span><button data-remove="${i}" aria-label="Remove image ${i+2}">×</button></div>`).join('');$('#edit-refs').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{draft().refs.splice(Number(b.dataset.remove),1);changed();refs()});}
 function load(){previousPrompt=null;$('#edit-undo-prompt').hidden=true;const d=draft();$('#edit-prompt').value=d.prompt;$('#edit-seed').value=d.seed;$('#edit-random').checked=d.randomize_seed;refs();if(shownSet!==getDoc().id)$('#edited-view').hidden=true;}
 function add(id){if(assets[id]?.kind!=='image')throw Error('Only image references are supported.');if(draft().refs.length>=9)throw Error('All nine reference spaces are filled. Image 1 is reserved for the camera render.');draft().refs.push(id);changed();refs();}
 async function files(list){if(busy)throw Error('Wait for the current reference upload.');if(list.length+draft().refs.length>9)throw Error('Choose up to nine extra references.');if(list.some(f=>!/^image\//.test(f.type)&&! /\.(png|jpe?g|webp|bmp)$/i.test(f.name)))throw Error('Drop image files only.');busy=true;const setId=getDoc().id;try{for(const file of list){const form=new FormData();form.append('file',file);const a=await api('/api/assets',form);assets[a.id]=a;if(getDoc().id!==setId)throw Error('Set changed during upload. Uploaded images remain in the asset library.');add(a.id)}}finally{busy=false;$('#edit-files').value=''}}
 $('#edit-drop').onclick=()=>$('#edit-files').click();$('#edit-drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#edit-files').click()}};
 $('#edit-files').onchange=guard(e=>files([...e.target.files]));
 $('#edit-drop').ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'};
 $('#edit-drop').ondrop=guard(async e=>{e.preventDefault();const id=e.dataTransfer.getData('application/frameforge-asset');if(id)add(id);else await files([...e.dataTransfer.files])});

 let pickerSignature='';
 function pickerOpen(open){$('#edit-asset-menu').hidden=!open;$('#edit-asset-toggle').setAttribute('aria-expanded',String(open));}
 $('#edit-asset-toggle').onclick=()=>pickerOpen($('#edit-asset-menu').hidden);
 $('#edit-asset-picker').onfocusout=e=>{if(e.relatedTarget&&!$('#edit-asset-picker').contains(e.relatedTarget))pickerOpen(false)};
 document.addEventListener?.('click',e=>{if(!$('#edit-asset-picker').contains(e.target))pickerOpen(false)});

 function pickerSelection(){
  const a=assets[$('#edit-asset').value];
  $('#edit-asset-selection').innerHTML=a?`<img src="/api/assets/${encodeURIComponent(a.id)}/file?thumbnail=true" alt=""><span>${esc(a.name)}</span>`:'Choose an image…';
 }
 function pickerOptions(){
  const query=$('#edit-asset-search').value.trim().toLocaleLowerCase();
  const images=Object.values(assets).filter(a=>a.kind==='image'&&a.name.toLocaleLowerCase().includes(query));
  $('#edit-asset-options').innerHTML=images.length?images.map(a=>`<button type="button" class="image-picker-option" data-asset="${esc(a.id)}" aria-pressed="${a.id===$('#edit-asset').value}"><img src="/api/assets/${encodeURIComponent(a.id)}/file?thumbnail=true" alt="" loading="lazy"><span>${esc(a.name)}</span></button>`).join(''):'<p class="hint">No matching images.</p>';
 }
 $('#edit-asset-search').oninput=pickerOptions;
 $('#edit-asset-options').onclick=e=>{
  const option=e.target.closest('[data-asset]');if(!option)return;
  $('#edit-asset').value=option.dataset.asset;pickerSelection();pickerOptions();pickerOpen(false);$('#edit-asset-toggle').focus();
 };
 $('#edit-asset-picker').onkeydown=e=>{
  if(e.key==='Escape'){pickerOpen(false);$('#edit-asset-toggle').focus();e.preventDefault()}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   const options=[...$('#edit-asset-options').querySelectorAll('button')];if(!options.length)return;
   const current=options.indexOf(document.activeElement),next=current<0?(e.key==='ArrowDown'?0:options.length-1):(current+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
   pickerOpen(true);options[next].focus();e.preventDefault();
  }
 };
 $('#edit-add-asset').onclick=guard(()=>add($('#edit-asset').value));
 for(const [id,key] of [['edit-prompt','prompt'],['edit-seed','seed'],['edit-random','randomize_seed']])$('#'+id).oninput=e=>{draft()[key]=key==='randomize_seed'?e.target.checked:key==='seed'?Number(e.target.value):e.target.value;changed()};
 $('#edit-improve').onclick=guard(async()=>{
  if(busy)throw Error('Wait for reference uploads to finish.');
  const d=structuredClone(draft()),doc=getDoc(),button=$('#edit-improve');
  if(!d.prompt.trim())throw Error('Enter an editing prompt first.');
  button.disabled=true;button.textContent='Improving…';
  try{
   status('Capturing the camera frame for prompt improvement…');
   const blob=await capture(),form=new FormData();form.append('file',blob,'camera.png');form.append('prompt',d.prompt);form.append('refs',JSON.stringify(d.refs));
   status('Rewriting the prompt with your connected language model…');
   const result=await api('/api/set-studio/improve-prompt',form);
   if(getDoc()!==doc||draft().prompt!==d.prompt||JSON.stringify(draft().refs)!==JSON.stringify(d.refs))throw Error('The set, prompt, or references changed while improving. Your current prompt was kept; retry to improve it.');
   previousPrompt={before:d.prompt,after:result.rewritten_prompt};draft().prompt=result.rewritten_prompt;$('#edit-prompt').value=result.rewritten_prompt;$('#edit-undo-prompt').hidden=false;changed();status('Prompt improved. Review it before queuing your image edit.');
  }finally{button.disabled=false;button.textContent='Improve prompt'}
 });
 $('#edit-undo-prompt').onclick=guard(()=>{
  if(!previousPrompt)return;
  if(draft().prompt!==previousPrompt.after)throw Error('The rewritten prompt has been edited. Undo was skipped to preserve your changes.');
  draft().prompt=previousPrompt.before;$('#edit-prompt').value=previousPrompt.before;previousPrompt=null;$('#edit-undo-prompt').hidden=true;changed();status('Original prompt restored.');
 });
 function show(id){$('#edited-image').src=`/api/assets/${id}/file`;$('#download-edit').href=`/api/assets/${id}/file`;$('#edited-view').hidden=false;shownSet=getDoc().id;status('Qwen result shown. The image is also saved in the asset library.');}
 $('#back-to-scene').onclick=()=>{$('#edited-view').hidden=true;status('Back to the 3D scene.');};
 $('#edit-queue').onclick=guard(async()=>{
  if(busy)throw Error('Wait for reference uploads to finish.');const d=structuredClone(draft()),setId=getDoc().id;
  if(!d.prompt.trim())throw Error('Enter an editing prompt.');$('#edit-queue').disabled=true;
  try{status('Capturing image 1…');const blob=await capture(),form=new FormData();form.append('file',blob,getDoc().name+' · Qwen input.png');const a=await api('/api/set-studio/render',form);
   await api('/api/set-studio/edit-image',{...d,image_id:a.id,set_id:setId});status('Qwen image edit queued. You can continue working while it runs.');
  }finally{$('#edit-queue').disabled=false}
 });
 function refresh(state){assets=state.assets;
  const signature=JSON.stringify(Object.values(assets).filter(a=>a.kind==='image').map(a=>[a.id,a.name,a.thumbnail]));
  if(signature!==pickerSignature){pickerSignature=signature;if(assets[$('#edit-asset').value]?.kind!=='image')$('#edit-asset').value='';pickerSelection();pickerOptions();}

  const jobs=state.jobs.filter(j=>j.kind==='set-image'),initial=seen===null;if(initial)seen=new Set(state.jobs.filter(j=>j.status==='completed').map(j=>j.id));
  $('#edit-jobs').innerHTML=jobs.slice(-8).reverse().map(j=>`<div class="set-job">${esc(j.stage)}${j.progress!=null?' · '+Math.round(j.progress)+'%':''}${j.error?'<br>'+esc(j.error):''}${['completed','failed','cancelled'].includes(j.status)?(j.results||[]).map(id=>`<button data-result="${id}">Show result</button>`).join(''):`<button data-cancel="${j.id}">Cancel</button>`}</div>`).join('');
  $('#edit-jobs').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=guard(async()=>{await api('/api/jobs/'+b.dataset.cancel+'/cancel',{});status('Cancellation requested.')}));$('#edit-jobs').querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>show(b.dataset.result));
  for(const j of jobs)if(j.spec.set_id===getDoc().id&&j.status==='completed'&&!seen.has(j.id)){seen.add(j.id);if(j.results?.length)show(j.results.at(-1));}refs();
 }
 load();return {refresh,load};
}
