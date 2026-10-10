import test from 'node:test';
import assert from 'node:assert/strict';
import {setupImageEditor} from '../static/set-image-editor.js';

test('rewrite, undo, errors and concurrent edits preserve the correct prompt',async()=>{
 const elements=new Map();globalThis.document={querySelector(selector){if(!elements.has(selector))elements.set(selector,{value:'',hidden:false,disabled:false,querySelectorAll:()=>[]});return elements.get(selector)}};
 const el=id=>document.querySelector('#'+id);
 let doc={id:'one',image_edit:{prompt:'Original',refs:[],seed:42,randomize_seed:true}},pending,fail=false;
 setupImageEditor({api:async(path,form)=>{assert.equal(path,'/api/set-studio/improve-prompt');assert.equal(form.get('refs'),'[]');if(fail)throw Error('Offline');return await new Promise(resolve=>{pending=resolve})},capture:async()=>new Blob(['image']),guard:f=>f,status:()=>{},getDoc:()=>doc,changed:()=>{}});
 const start=async()=>{const task=el('edit-improve').onclick();await new Promise(resolve=>setImmediate(resolve));return {task}};
 let {task}=await start();assert.equal(el('edit-improve').disabled,true);pending({rewritten_prompt:'Improved'});await task;
 assert.equal(doc.image_edit.prompt,'Improved');assert.equal(el('edit-prompt').value,'Improved');el('edit-undo-prompt').onclick();assert.equal(doc.image_edit.prompt,'Original');
 ({task}=await start());doc.image_edit.prompt='New typing';pending({rewritten_prompt:'Stale'});await assert.rejects(task,/changed/);assert.equal(doc.image_edit.prompt,'New typing');assert.equal(el('edit-improve').disabled,false);
 fail=true;await assert.rejects(el('edit-improve').onclick(),/Offline/);assert.equal(doc.image_edit.prompt,'New typing');assert.equal(el('edit-improve').disabled,false);
 fail=false;({task}=await start());doc={id:'two',image_edit:{prompt:'Other set',refs:[]}};pending({rewritten_prompt:'Stale'});await assert.rejects(task,/changed/);assert.equal(doc.image_edit.prompt,'Other set');
});
