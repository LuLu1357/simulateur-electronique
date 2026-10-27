import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/simulationController.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true } });
const { createSimulationController } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('le calcul devient immédiatement running et ignore un double démarrage', async () => {
  const phases = [], job = deferred();
  const controller = createSimulationController({ onPhaseChange: phase => phases.push(phase) });
  let calls = 0;
  const pending = controller.start(() => { calls++; return job.promise; });
  assert.equal(controller.phase, 'running');
  assert.equal(controller.getSnapshot().canStop, true);
  assert.equal(await controller.start(async () => { calls++; }), undefined);
  assert.equal(calls, 1);
  job.resolve({ status: 'success', currents: { R1: .005 } });
  assert.deepEqual(await pending, { status: 'success', currents: { R1: .005 } });
  assert.equal(controller.phase, 'idle');
  assert.deepEqual(phases, ['running', 'idle']);
});
test('un OP terminé reste idle et conserve les courants disponibles pour une animation indépendante', async () => {
  const controller = createSimulationController();
  const result = await controller.start(async () => ({ status: 'success', currents: { R1: .005 } }));
  assert.equal(controller.getSnapshot().canStart, true);
  let stops = 0;
  assert.equal(await controller.stop(async () => { stops++; }), false);
  assert.equal(stops, 0);
  assert.equal(result.currents.R1, .005);
});
test('un arrêt HTTP tardif bloque le nouveau calcul même si OP a déjà fini', async () => {
  const controller = createSimulationController(), job = deferred(), stop = deferred();
  const pending = controller.start(() => job.promise);
  const stopping = controller.stop(() => stop.promise);
  assert.equal(controller.phase, 'stopping');
  job.resolve({ status: 'success' });
  await pending;
  assert.equal(controller.phase, 'stopping');
  let starts = 0;
  assert.equal(await controller.start(async () => { starts++; }), undefined);
  assert.equal(starts, 0);
  stop.resolve({ stop_requested: true });
  assert.equal(await stopping, true);
  assert.equal(controller.phase, 'idle');
  await controller.start(async () => { starts++; return 'new'; });
  assert.equal(starts, 1);
});
test('arrêter est dédoublonné et stopping persiste jusqu’au résultat du worker', async () => {
  const controller = createSimulationController(), job = deferred(), stop = deferred();
  const pending = controller.start(() => job.promise);
  let stops = 0;
  const first = controller.stop(() => { stops++; return stop.promise; });
  const second = controller.stop(() => { stops++; return stop.promise; });
  assert.strictEqual(first, second);
  stop.resolve({ stop_requested: true });
  await first;
  assert.equal(stops, 1);
  assert.equal(controller.phase, 'stopping');
  assert.equal(await controller.stop(async () => { stops++; }), false);
  job.resolve({ status: 'cancelled' });
  await pending;
  assert.equal(controller.phase, 'idle');
});
test('un échec d’arrêt est propagé et permet de retenter sans perdre le calcul actif', async () => {
  const controller = createSimulationController(), job = deferred();
  const pending = controller.start(() => job.promise);
  const failure = new Error('service local indisponible');
  await assert.rejects(controller.stop(async () => { throw failure; }), error => error === failure);
  assert.equal(controller.phase, 'running');
  assert.equal(controller.getSnapshot().canStop, true);
  job.resolve({ status: 'success' });
  await pending;
  assert.equal(controller.phase, 'idle');
});
test('un échec de calcul libère le contrôle et conserve son erreur exacte', async () => {
  const controller = createSimulationController();
  const failure = new Error('ngspice indisponible');
  await assert.rejects(controller.start(async () => { throw failure; }), error => error === failure);
  assert.equal(controller.phase, 'idle');
  assert.equal(await controller.start(async () => 'retry'), 'retry');
});
test('un GET commencé avant le calcul ne peut effacer son résultat à révision identique', async () => {
  const controller = createSimulationController();
  const before = controller.beginPoll(), job = deferred();
  const pending = controller.start(() => job.promise);
  const during = controller.beginPoll();
  assert.equal(controller.acceptPoll(during, false), false);
  job.resolve({ project: { revision: 7 }, simulation: { status: 'success' } });
  const final = await pending;
  assert.equal(controller.acceptPoll(before, false), false);
  assert.equal(controller.acceptPoll(during, false), false);
  assert.equal(final.simulation.status, 'success');
  assert.equal(controller.acceptPoll(controller.beginPoll(), false), true);
});
test('les réponses des sondages concurrents ne peuvent revenir à un ancien état', () => {
  const controller = createSimulationController();
  const older = controller.beginPoll(), newer = controller.beginPoll();
  assert.equal(controller.acceptPoll(newer, true), true);
  assert.equal(controller.phase, 'running');
  assert.equal(controller.acceptPoll(older, false), false);
  assert.equal(controller.phase, 'running');
});
test('un calcul MCP observé peut être arrêté et attend ensuite un sondage frais terminé', async () => {
  const controller = createSimulationController();
  controller.acceptPoll(controller.beginPoll(), true);
  assert.equal(await controller.start(async () => 'must not run'), undefined);
  const stale = controller.beginPoll();
  assert.equal(await controller.stop(async () => ({ stop_requested: true })), true);
  assert.equal(controller.phase, 'stopping');
  assert.equal(controller.acceptPoll(stale, true), false);
  assert.equal(controller.acceptPoll(controller.beginPoll(), true), true);
  assert.equal(controller.phase, 'stopping');
  controller.acceptPoll(controller.beginPoll(), false);
  assert.equal(controller.phase, 'idle');
});
test('une publication autoritaire invalide un ancien sondage sans changer la phase', () => {
  const snapshots = [];
  const controller = createSimulationController({ onChange: state => snapshots.push(state) });
  const poll = controller.beginPoll();
  controller.invalidatePolls();
  assert.equal(controller.acceptPoll(poll, true), false);
  assert.equal(controller.phase, 'idle');
  controller.acceptPoll(controller.beginPoll(), false);
  assert.deepEqual(snapshots, []);
});

test('stop annule immédiatement le signal du POST local mais attend une confirmation serveur', async () => {
  const controller = createSimulationController();
  let signal;
  const pending = controller.start(currentSignal => {
    signal = currentSignal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('annulé', 'AbortError')), { once: true });
    });
  });
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await controller.stop(async () => ({ stop_requested: true, running: true }));
  await aborted;
  assert.equal(signal.aborted, true);
  assert.equal(controller.phase, 'stopping');
  assert.equal(controller.getSnapshot().canStart, false);
  assert.equal(controller.getSnapshot().serverRunning, true);
  assert.equal(await controller.start(async () => 'cannot run yet'), undefined);
  controller.acceptPoll(controller.beginPoll(), false);
  assert.equal(controller.phase, 'idle');
});

test('une confirmation d’arrêt idle permet de finir sans inventer un worker encore actif', async () => {
  const controller = createSimulationController();
  const pending = controller.start(signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('annulé', 'AbortError')), { once: true });
  }));
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  await controller.stop(async () => ({ stop_requested: true, running: false }));
  await aborted;
  assert.equal(controller.phase, 'idle');
  assert.equal(controller.getSnapshot().awaitingServer, false);
});
