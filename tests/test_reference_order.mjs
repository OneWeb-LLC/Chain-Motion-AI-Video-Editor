import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedReferences,moveImageReference} from '../static/reference-order.js';
test('image moves keep audio/video slots and shared references intact',()=>{
 const assets={a:{kind:'image'},b:{kind:'image'},c:{kind:'image'},v:{kind:'video'},s:{kind:'audio'}};
 const scene={refs:['a']},seg={refs:['b','v','c','s']};
 const ids=orderedReferences(scene,seg),result=moveImageReference(ids,assets,'a','c');
 assert.deepEqual(result,['b','c','v','a','s']);assert.deepEqual(scene.refs,['a']);
 assert.deepEqual(orderedReferences(scene,{...seg,ref_order:result}),result);
 assert.deepEqual(orderedReferences(scene,{refs:['b','s'],ref_order:result}),['b','a','s']);
 assert.deepEqual(moveImageReference(ids,assets,'v','a'),ids);
});
