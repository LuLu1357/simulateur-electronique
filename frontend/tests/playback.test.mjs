import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compiled = ts.transpileModule(
  await readFile(new URL("../src/playback.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const {
  playbackSource,
  frameMatchesSource,
  nearestPlaybackIndex,
  withPlaybackFrame,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const uid = "1".repeat(32);
function fixture() {
  return {
    project: { id: "test", revision: 10 },
    running: false,
    simulation: {
      status: "success",
      stale: false,
      simulation_id: uid,
      project_revision: 6,
      circuit_fingerprint: "electrical_identity",
      analysis: { kind: "tran", stop: 1 },
      time: [0, 0.01, 0.2, 1],
      curves: [{ id: "V", label: "V", unit: "V", values: [0, 1, 3, 5] }],
      voltages: { 0: 0, V: 5 },
      currents: { R1: 0.005 },
      wire_currents: { W1: 0.005 },
      wire_current_status: { W1: "unique" },
      wire_flow_hints: { W1: 0.005 },
      assumptions: ["source assumptions"],
      diagnostics: [{ code: "converged" }],
      netlist: "original netlist",
      log: "original log",
    },
  };
}
function frame(index = 1) {
  const state = fixture();
  const simulation = {
    ...state.simulation,
    voltages: { 0: 0, V: 1 },
    currents: { R1: 0.001 },
    terminal_currents: { R1: { p: 0.001, n: -0.001 } },
    time: [],
    curves: [],
    wire_currents: { W1: 0.001 },
    wire_flow_hints: {},
    wire_current_status: { W1: "unique" },
    sample_index: index,
    sample_time: state.simulation.time[index],
    sample_count: state.simulation.time.length,
  };
  return {
    project_id: "test",
    project_revision: 9,
    source_revision: 6,
    simulation_id: uid,
    circuit_fingerprint: "electrical_identity",
    index,
    time: state.simulation.time[index],
    sample_count: 4,
    simulation,
  };
}

test("seul un transitoire courant réussi, identifié et encore frais peut être relu", () => {
  const state = fixture();
  const source = playbackSource(state);
  assert.equal(source.projectId, "test");
  assert.equal(source.sourceRevision, 6);
  assert.equal(source.simulationId, uid);
  assert.deepEqual(source.time, [0, 0.01, 0.2, 1]);
  assert.equal(playbackSource(state, true), null);
  state.running = true;
  assert.equal(playbackSource(state), null);
  state.running = false;
  state.simulation.stale = true;
  assert.equal(playbackSource(state), null);
  state.simulation.stale = false;
  state.last_success = structuredClone(state.simulation);
  state.simulation.status = "error";
  assert.equal(playbackSource(state), null);
  assert.equal(playbackSource(null), null);
});

test("provenance absente, point continu et temps invalides n’activent pas la relecture", () => {
  for (const mutate of [
    (s) => {
      delete s.simulation.simulation_id;
    },
    (s) => {
      s.simulation.analysis.kind = "op";
    },
    (s) => {
      s.simulation.circuit_fingerprint = "";
    },
    (s) => {
      s.simulation.time = [0];
    },
    (s) => {
      s.simulation.time = [0, 0, 1];
    },
    (s) => {
      s.simulation.time = [0, 2, 1];
    },
    (s) => {
      s.simulation.time = [0, Infinity];
    },
    (s) => {
      s.simulation.time = [-1, 1];
    },
  ]) {
    const state = fixture();
    mutate(state);
    assert.equal(playbackSource(state), null);
  }
});

test("une frame correspond au même projet, calcul et échantillon malgré une édition visuelle plus récente", () => {
  const source = playbackSource(fixture()),
    sampled = frame();
  assert.equal(frameMatchesSource(sampled, source, 1), true);
  sampled.project_revision = 500;
  assert.equal(frameMatchesSource(sampled, source, 1), true);
  assert.equal(frameMatchesSource(sampled, source, 2), false);
});

test("réponses tardives, autre calcul, mauvais temps et métadonnées incohérentes sont refusés", () => {
  const source = playbackSource(fixture());
  for (const mutate of [
    (f) => {
      f.project_id = "another";
    },
    (f) => {
      f.simulation_id = "2".repeat(32);
    },
    (f) => {
      f.circuit_fingerprint = "changed";
    },
    (f) => {
      f.source_revision++;
    },
    (f) => {
      f.sample_count--;
    },
    (f) => {
      f.time = 0.02;
    },
    (f) => {
      f.simulation.sample_index = 2;
    },
    (f) => {
      f.simulation.sample_time = 0.2;
    },
    (f) => {
      f.simulation.sample_count = 3;
    },
    (f) => {
      f.simulation.status = "error";
    },
    (f) => {
      f.simulation.stale = true;
    },
    (f) => {
      f.simulation.simulation_id = "old";
    },
    (f) => {
      f.simulation.voltages.V = Infinity;
    },
    (f) => {
      f.simulation.currents = null;
    },
    (f) => {
      f.simulation.terminal_currents.R1.p = NaN;
    },
  ]) {
    const sampled = frame();
    mutate(sampled);
    assert.equal(frameMatchesSource(sampled, source, 1), false);
  }
  assert.equal(frameMatchesSource(null, source, 1), false);
});

test("le temps de lecture choisit un vrai point adaptatif et conserve le premier en cas d’égalité", () => {
  const time = [0, 0.01, 0.2, 1];
  assert.equal(nearestPlaybackIndex(time, 0.012), 1);
  assert.equal(nearestPlaybackIndex(time, 0.7), 3);
  assert.equal(nearestPlaybackIndex(time, 0.005), 0);
  assert.equal(nearestPlaybackIndex(time, -1), 0);
  assert.equal(nearestPlaybackIndex(time, 100), 3);
  assert.equal(nearestPlaybackIndex([], 0), -1);
  assert.equal(nearestPlaybackIndex(time, NaN), -1);
});

test("les courants de bornes reçus doivent être une table de tables numériques, pas un scalaire ou tableau vide", () => {
  const source = playbackSource(fixture());
  for (const invalid of [42, true, "", [], [0], { R1: [] }, { R1: null }]) {
    const sampled = frame();
    sampled.simulation.terminal_currents = invalid;
    assert.equal(frameMatchesSource(sampled, source, 1), false);
  }
  assert.equal(frameMatchesSource(frame(), source, 1), true);
});

test("les mesures instantanées remplacent le point final et gardent les séries complètes sans mutation", () => {
  const state = fixture(),
    source = playbackSource(state),
    sampled = frame();
  const before = JSON.stringify({ state, sampled });
  const displayed = withPlaybackFrame(state.simulation, source, sampled);
  assert.equal(displayed.voltages.V, 1);
  assert.equal(displayed.currents.R1, 0.001);
  assert.equal(displayed.wire_currents.W1, 0.001);
  assert.strictEqual(displayed.time, state.simulation.time);
  assert.strictEqual(displayed.curves, state.simulation.curves);
  assert.equal(displayed.log, "original log");
  assert.equal(displayed.netlist, "original netlist");
  assert.deepEqual(displayed.diagnostics, [{ code: "converged" }]);
  assert.equal(displayed.sample_index, 1);
  assert.equal(displayed.sample_time, 0.01);
  assert.equal(displayed.sample_count, 4);
  assert.equal(JSON.stringify({ state, sampled }), before);
});

test("les flux absents d’une frame ne réutilisent jamais ceux du point final", () => {
  const state = fixture(),
    source = playbackSource(state),
    sampled = frame();
  delete sampled.simulation.wire_currents;
  delete sampled.simulation.wire_flow_hints;
  const displayed = withPlaybackFrame(state.simulation, source, sampled);
  assert.equal(displayed.wire_currents, undefined);
  assert.equal(displayed.wire_flow_hints, undefined);
});

test("revenir à la fin restaure les mesures et leur instant exact sans requête supplémentaire", () => {
  const state = fixture(),
    source = playbackSource(state);
  const displayed = withPlaybackFrame(state.simulation, source, null);
  assert.equal(displayed.voltages.V, 5);
  assert.equal(displayed.currents.R1, 0.005);
  assert.equal(displayed.sample_time, 1);
  assert.equal(displayed.sample_index, 3);
  assert.equal(state.simulation.sample_index, undefined);
});
