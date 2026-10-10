import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function pinMotionLinks()'), source.indexOf('function moveSegment('));
function fixture() {
 const a = {id:'a'}, b = {id:'b',connected:true}, c = {id:'c'};
 const project = {scenes:[{id:'first',segments:[a,b]},{id:'second',segments:[c]}]};
 const context = {project, sceneId:'first', segmentId:'a', selected:new Set(['a']),
  allSegments:()=>project.scenes.flatMap(s=>s.segments),
  motionSource:seg=>seg.connected ? a : null,
  newSegment:()=>({id:'blank',prompt:'',main:null,refs:[],takes:[],connected:true}),
  edit:fn=>fn()};
 vm.createContext(context);vm.runInContext(functions, context);
 return context;
}
test('inserts and selects a blank shot without redirecting continuation',()=>{
 const c=fixture();c.insertBlankSegment('first','b');
 assert.deepEqual(c.project.scenes[0].segments.map(s=>s.id),['a','blank','b']);
 assert.equal(c.project.scenes[0].segments[1].connected,false);
 assert.equal(c.project.scenes[0].segments[1].prompt,'');
 assert.equal(c.project.scenes[0].segments[2].continuation_segment,'a');
 assert.equal(c.segmentId,'blank');
});
test('scene-boundary insert belongs to the following scene; stale target is ignored',()=>{
 const c=fixture();c.insertBlankSegment('second','c');
 assert.deepEqual(c.project.scenes[1].segments.map(s=>s.id),['blank','c']);
 assert.equal(c.sceneId,'second');
 c.insertBlankSegment('missing','c');
 assert.equal(c.project.scenes[1].segments.length,2);
});
