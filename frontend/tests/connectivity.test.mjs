import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const typesUrl=dataUrl(compile(await readFile(new URL('../src/types.ts',import.meta.url),'utf8')));
const source=compile(await readFile(new URL('../src/connectivity.ts',import.meta.url),'utf8')).replace(/from ["']\.\/types["']/g,`from "${typesUrl}"`);
const {wirePath,boardLinks}=await import(dataUrl(source));
const {pinPoints}=await import(typesUrl);
function project(){return {
 components:[{id:'R1',kind:'resistor',pins:{p:'R1.p',n:'R1.n'}},{id:'R2',kind:'resistor',pins:{p:'R2.p',n:'R2.n'}}],
 schematic:{R1:{x:100,y:100,rotation:0},R2:{x:300,y:200,rotation:0}},wires:[],junctions:[],breadboard:{placements:{},rail_splits:true},
};}
function orthogonalVertices(path){
 assert.ok(path.startsWith('M'));
 assert.doesNotMatch(path,/[LQCTA]/i,'le tracé manuel doit rester orthogonal');
 const vertices=[];
 for(const [,command,args] of path.matchAll(/([MHV])([^MHV]*)/g)){
  const values=args.split(',').map(Number);
  if(command==='M')vertices.push(values);
  else if(command==='H')vertices.push([values[0],vertices.at(-1)[1]]);
  else vertices.push([vertices.at(-1)[0],values[0]]);
 }
 for(const [x,y] of vertices)assert.ok(Number.isFinite(x)&&Number.isFinite(y));
 return vertices;
}
test('sans point de passage, le routage automatique existant est conservé',()=>{
 const p=project();
 assert.equal(wirePath(p,'R1.p','R2.n'),'M52,100L28,100H200V200H372L348,200');
 assert.equal(wirePath(p,'R1.p','R2.n',pinPoints(p),[]),wirePath(p,'R1.p','R2.n'));
});
test('le tracé manuel traverse les points dans l’ordre et atteint les deux bornes',()=>{
 const p=project(),points=pinPoints(p),waypoints=[{x:160,y:40},{x:270,y:70}];
 const path=wirePath(p,'R1.p','R2.n',points,waypoints),vertices=orthogonalVertices(path);
 assert.deepEqual(vertices[0],points['R1.p']);
 assert.deepEqual(vertices.at(-1),points['R2.n']);
 assert.ok(vertices.findIndex(([x,y])=>x===160&&y===40)<vertices.findIndex(([x,y])=>x===270&&y===70));
});
test('les quatre rotations et les broches diagonales des transistors gardent des segments orthogonaux',()=>{
 for(const rotation of [0,90,180,270]){
  const p=project();
  p.components[0]={id:'Q1',kind:'npn',pins:{c:'Q1.c',b:'Q1.b',e:'Q1.e'}};
  p.schematic.Q1={x:100,y:100,rotation};
  const points=pinPoints(p);
  for(const pin of ['c','b','e']){
   const path=wirePath(p,`Q1.${pin}`,'R2.n',points,[{x:200,y:20}]),vertices=orthogonalVertices(path);
   assert.deepEqual(vertices[0],points[`Q1.${pin}`]);
   assert.deepEqual(vertices.at(-1),points['R2.n']);
  }
 }
});
test('les points invalides sont ignorés, le nombre est borné et les références absentes restent vides',()=>{
 const p=project(),points=pinPoints(p);
 assert.equal(wirePath(p,'absent','R2.n',points,[{x:5,y:5}]),'');
 for(const invalid of [[null],[{x:NaN,y:5}],[{x:1e9,y:0}],[{x:'3',y:4}]])assert.equal(wirePath(p,'R1.p','R2.n',points,invalid),wirePath(p,'R1.p','R2.n',points));
 const route=Array.from({length:50},(_,i)=>({x:150+i,y:20+i}));
 assert.equal(wirePath(p,'R1.p','R2.n',points,route),wirePath(p,'R1.p','R2.n',points,route.slice(0,32)));
 assert.equal(wirePath(p,'R1.p','R2.n',{'R1.p':[Infinity,0],'R2.n':[1,2]},[{x:4,y:2}]),'');
});
test('changer un dessin de fil ne change pas les continuités implicites de la plaque',()=>{
 const p=project();p.breadboard.placements={'R1.p':'a1','R2.p':'e1'};
 const before=boardLinks(p);
 p.wires.push({id:'W1',a:'R1.n',b:'R2.n',color:'#eac06c',waypoints:[{x:80,y:20}]});
 assert.deepEqual(boardLinks(p),before);
 assert.deepEqual(before,[{a:'R1.p',b:'R2.p',group:'AE1'}]);
});
