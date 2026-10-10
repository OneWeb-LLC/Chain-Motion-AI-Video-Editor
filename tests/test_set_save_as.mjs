import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../static/set-studio.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("$('#save-set-as').onclick="),source.indexOf("$('#set-name').oninput="));
function setup(name='Copy',fail=false){
 const elements=new Map(),saved=[];
 const context={structuredClone,JSON,Error,prompt:()=>name,uid:()=> 'new-id',doc:{id:'original',version:5,name:'Original',objects:[{id:'model',parent:'person',textures_enabled:false}],image_edit:{prompt:'Keep pose',refs:['image']}},dirty:true,undo:['old'],syncTransforms(){},guard:f=>f,imageEditor:{load(){}},status(){},refresh:async()=>{},$:s=>{if(!elements.has(s))elements.set(s,{});return elements.get(s)},api:async(path,body)=>{if(fail)throw Error('Offline');saved.push(structuredClone(body));return {...body,version:1,updated:123}}};
 vm.createContext(context);vm.runInContext(handler,context);return {context,saved,click:()=>elements.get('#save-set-as').onclick()};
}
test('Save as creates an independent copy and switches subsequent saves',async()=>{
 const {context,saved,click}=setup();const original=structuredClone(context.doc);await click();
 assert.equal(saved[0].id,'new-id');assert.equal(saved[0].version,0);assert.equal(saved[0].name,'Copy');
 assert.deepEqual(saved[0].objects,original.objects);assert.deepEqual(saved[0].image_edit,original.image_edit);
 assert.equal(context.doc.id,'new-id');assert.equal(context.doc.version,1);assert.equal(context.dirty,false);assert.equal(context.undo.length,0);
 context.doc.objects[0].textures_enabled=true;assert.equal(saved[0].objects[0].textures_enabled,false);
});
test('cancel and failed saves preserve current set identity',async()=>{
 for(const [name,fail] of [[null,false],['Copy',true]]){
  const {context,saved,click}=setup(name,fail);if(fail)await assert.rejects(click(),/Offline/);else await click();
  assert.equal(context.doc.id,'original');assert.equal(context.doc.version,5);assert.equal(saved.length,0);
 }
});
