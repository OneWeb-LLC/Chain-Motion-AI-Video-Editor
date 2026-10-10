// Map the browser's Three.js import map for Node regression tests.
export async function resolve(specifier,context,next){
 if(specifier==='three')return {url:new URL('../static/vendor/three/three.module.js',import.meta.url).href,shortCircuit:true};
 if(specifier.startsWith('three/addons/'))return {url:new URL('../static/vendor/three/addons/'+specifier.slice(13),import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}
