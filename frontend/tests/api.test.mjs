import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true } });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64') + '#' + Math.random());
}

test('arrêter avant la session annule le signal et empêche tout POST de simulation tardif', async () => {
  const { api } = await load('../src/api.ts');
  const { createSimulationController } = await load('../src/simulationController.ts');
  const previous = globalThis.fetch, paths = [];
  globalThis.fetch = async (path, options = {}) => {
    paths.push(path);
    if (path === '/api/session' && options.signal) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('session annulée', 'AbortError')), { once: true });
      });
    }
    if (path === '/api/session') return Response.json({ token: 'local-test' });
    if (path === '/api/stop') return Response.json({ stop_requested: true, running: false });
    throw Error('aucune simulation ne doit être démarrée après annulation');
  };
  try {
    const controller = createSimulationController();
    const pending = controller.start(signal => api('simulate', { analysis: { kind: 'op' } }, { signal }));
    const aborted = assert.rejects(pending, { name: 'AbortError' });
    await controller.stop(() => api('stop', {}));
    await aborted;
    assert.equal(paths.includes('/api/simulate'), false);
    assert.equal(paths.filter(path => path === '/api/stop').length, 1);
    assert.equal(controller.phase, 'idle');
  } finally { globalThis.fetch = previous; }
});

test('le même signal atteint session et POST, et AbortError de lecture JSON reste reconnaissable', async () => {
  const { api } = await load('../src/api.ts');
  const previous = globalThis.fetch, abort = new AbortController(), signals = [];
  const originalError = new DOMException('lecture annulée', 'AbortError');
  globalThis.fetch = async (path, options) => {
    signals.push(options.signal);
    if (path === '/api/session') return Response.json({ token: 'local-test' });
    return { ok: true, json: async () => { abort.abort(); throw originalError; } };
  };
  try {
    await assert.rejects(api('simulate', {}, { signal: abort.signal }), error => error === originalError);
    assert.deepEqual(signals, [abort.signal, abort.signal]);
  } finally { globalThis.fetch = previous; }
});
