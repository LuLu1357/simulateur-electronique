import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/stateMerge.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {electricalSignature,withMeasurements,publishSimulationState,publishProjectState,isCurrentProjectRevision}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));
function state(revision=1){return{project:{id:'test',revision,title:'circuit',components:[{id:'R1',kind:'resistor',value:1000,model:null,pins:{p:'R1.p',n:'R1.n'},label:'R1'}],wires:[],junctions:[],schematic:{R1:{x:10,y:20}},breadboard:{placements:{'R1.p':'c1','R1.n':'c4'},rail_splits:true},ui:{selected:[],view:'split',highlights:[],annotations:[]}},topology:{nets:[],terminal_to_net:{},hole_to_net:{}},history:{can_undo:true},simulation:{status:'success',project_revision:1,stale:false,currents:{R1:.005}},last_success:{status:'success',project_revision:1,stale:false,currents:{R1:.005}},running:false};}
test('une sélection ou rotation ultérieure ne perd ni le projet récent ni les mesures OP',()=>{const calc=state(1),edited=structuredClone(calc);edited.project.revision=2;edited.project.ui.selected=['R1'];edited.project.schematic.R1.rotation=90;edited.simulation={status:'idle'};const result=withMeasurements(edited,calc);assert.equal(result.project.revision,2);assert.equal(result.project.schematic.R1.rotation,90);assert.equal(result.simulation.currents.R1,.005);assert.equal(result.simulation.stale,false);assert.equal(edited.simulation.status,'idle');});
test('un résultat arrivé après une modification de valeur garde cette valeur et marque les anciennes mesures',()=>{const calc=state(1),current=state(2);current.project.components[0].value=2000;const result=publishSimulationState(current,calc);assert.equal(result.project.components[0].value,2000);assert.equal(result.simulation.currents.R1,.005);assert.equal(result.simulation.stale,true);assert.equal(result.last_success.stale,true);});
test('les déplacements de pattes et les nouveaux fils demandent un nouveau calcul',()=>{const calc=state();for(const edit of [p=>p.breadboard.placements['R1.p']='d7',p=>p.wires.push({id:'W1',a:'R1.p',b:'R1.n'}),p=>p.breadboard.rail_splits=false]){const current=structuredClone(calc);current.project.revision++;edit(current.project);assert.equal(withMeasurements(current,calc).simulation.stale,true);}});
test('une nouvelle position de potentiomètre invalide une réponse de calcul tardive',()=>{const calc=state();calc.project.components[0].kind='potentiometer';calc.project.components[0].position=.5;const current=structuredClone(calc);current.project.revision++;current.project.components[0].position=.75;assert.equal(withMeasurements(current,calc).simulation.stale,true);const defaulted=structuredClone(calc);delete defaulted.project.components[0].position;assert.equal(electricalSignature(defaulted.project),electricalSignature(calc.project));});
test('une réponse autoritaire de même révision remplace normalement l’ancien calcul',()=>{const old=state(),next=state();next.simulation.currents.R1=.003;assert.strictEqual(publishSimulationState(old,next),next);assert.strictEqual(publishSimulationState(null,next),next);});
test('titres, noms de réseaux et annotations n’altèrent pas la signature électrique',()=>{const old=state(),next=structuredClone(old);next.project.title='Renommé';next.project.net_labels={'R1.p':'Sortie'};next.project.ui.annotations=[{text:'Observation'}];assert.equal(electricalSignature(old.project),electricalSignature(next.project));});

test('une réponse de mutation tardive ne remplace ni projet ni mesures ni statut déjà plus récents',()=>{
  const visible=state(4);visible.project.components[0].value=2000;visible.simulation.currents.R1=.0025;visible.history.can_redo=true;visible.running=false;
  const delayed=state(3);delayed.project.components[0].value=1000;delayed.simulation={status:'idle'};delayed.running=true;
  const published=publishProjectState(visible,delayed);
  assert.strictEqual(published,visible);
  assert.equal(published.project.components[0].value,2000);
  assert.equal(published.simulation.currents.R1,.0025);
  assert.equal(published.running,false);
  assert.equal(published.history.can_redo,true);
  assert.equal(isCurrentProjectRevision(visible,delayed),false);
});
test('le contrôle de révision accepte le premier état et les réponses de même révision ou plus récentes',()=>{
  const visible=state(4),same=state(4),newer=state(5);
  assert.equal(isCurrentProjectRevision(null,visible),true);
  assert.strictEqual(publishProjectState(null,visible),visible);
  assert.equal(isCurrentProjectRevision(visible,same),true);
  assert.strictEqual(publishProjectState(visible,same),same);
  assert.equal(isCurrentProjectRevision(visible,newer),true);
  assert.strictEqual(publishProjectState(visible,newer),newer);
});
test('une réponse de projet abandonnée ne fait pas régresser un calcul reçu entretemps',()=>{
  let visible=state(2);
  const delayed=structuredClone(visible);
  delayed.project.revision=3;delayed.project.ui.selected=['R1'];delayed.simulation={status:'idle'};
  const completed=state(4);completed.simulation.currents.R1=.003;visible=publishSimulationState(visible,completed);
  visible=publishProjectState(visible,delayed);
  assert.strictEqual(visible,completed);
  assert.equal(visible.project.revision,4);
  assert.equal(visible.simulation.currents.R1,.003);
});

test('le stimulus est électrique, le tracé et la couleur d’un fil restent visuels',()=>{const initial=state();initial.project.components.push({id:'V1',kind:'voltage_source',value:5,pins:{p:'V1.p',n:'V1.n'}});const styled=structuredClone(initial);styled.project.wires=[{id:'W1',a:'V1.p',b:'R1.p'}];const changed=structuredClone(styled);changed.project.wires[0].color='#eac06c';changed.project.wires[0].waypoints=[{x:50,y:20}];assert.equal(electricalSignature(styled.project),electricalSignature(changed.project));const pulse=structuredClone(styled);pulse.project.components[1].waveform={kind:'pulse',low:0,high:5,delay:0,rise:1e-5,fall:1e-5,width:.003,period:.006};assert.notEqual(electricalSignature(styled.project),electricalSignature(pulse.project));assert.equal(withMeasurements(pulse,styled).simulation.stale,true);});
