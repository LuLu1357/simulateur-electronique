import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compiled = ts.transpileModule(
  await readFile(new URL("../src/energy.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { circuitEnergy, nearestEnergySample, energyCsv } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
function fixture() {
  return {
    project: {
      id: "energy_test",
      revision: 15,
      components: [
        {
          id: "C1",
          kind: "capacitor",
          label: "Filtre",
          value: 2e-6,
          pins: { p: "C1.p", n: "C1.n" },
        },
        {
          id: "L1",
          kind: "inductor",
          label: "Bobine",
          value: 0.02,
          pins: { p: "L1.p", n: "L1.n" },
        },
      ],
    },
    topology: {
      terminal_to_net: {
        "C1.p": "upper",
        "C1.n": "lower",
        "L1.p": "upper",
        "L1.n": "0",
      },
    },
    simulation: {
      status: "success",
      stale: false,
      project_revision: 12,
      circuit_fingerprint: "electrical_state",
      voltages: { upper: 4, lower: 1 },
      currents: { L1: -0.02 },
      time: [],
      curves: [],
      analysis: { kind: "op" },
    },
    running: false,
  };
}
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-14, `${actual} ≈ ${expected}`);
test("énergie électrique différentielle et magnétique signée suivent les formules indépendantes", () => {
  const state = fixture(),
    before = JSON.stringify(state);
  const report = circuitEnergy(state);
  assert.equal(report.status, "ready");
  close(report.capacitive[0], 9e-6); // ½ × 2 µF × (4−1 V)²
  close(report.magnetic[0], 4e-6); // ½ × 20 mH × (−20 mA)²
  close(report.total[0], 13e-6);
  assert.equal(report.revision, 12); // Une édition visuelle peut avoir une révision plus récente.
  assert.equal(JSON.stringify(state), before);
});
test("un nouveau calcul réinitialise le curseur autonome, une édition visuelle conserve sa source", () => {
  const state = fixture();
  state.simulation.simulation_id = "premier_calcul";
  const initial = circuitEnergy(state).key;
  state.project.revision += 1;
  assert.equal(circuitEnergy(state).key, initial);
  state.simulation.simulation_id = "nouveau_calcul";
  assert.notEqual(circuitEnergy(state).key, initial);
});
test("échantillons transitoires exacts, tension négative et référence 0 V sont conservés", () => {
  const state = fixture();
  state.topology.terminal_to_net["C1.n"] = "0";
  state.simulation.time = [0, 0.001, 0.004];
  state.simulation.analysis = { kind: "tran" };
  state.simulation.curves = [
    { id: "upper", unit: "V", values: [0, -2, 3] },
    { id: "I:L1", unit: "A", values: [0.03, -0.01, 0] },
  ];
  const report = circuitEnergy(state);
  assert.deepEqual(report.time, [0, 0.001, 0.004]);
  close(report.capacitive[1], 4e-6);
  close(report.magnetic[1], 1e-6);
  close(report.total[0], 9e-6);
  close(report.total[2], 9e-6);
  assert.equal(nearestEnergySample(report.time, 0.0031), 2);
  assert.equal(nearestEnergySample(report.time, 0.0005), 0);
  assert.equal(nearestEnergySample(report.time, -1), 0);
  assert.equal(nearestEnergySample(report.time, 10), 2);
});
test("un courant ou une tension absent ne devient jamais une énergie nulle ni un total complet", () => {
  const state = fixture();
  delete state.simulation.currents.L1;
  const report = circuitEnergy(state);
  assert.deepEqual(report.magnetic, [null]);
  assert.deepEqual(report.total, [null]);
  close(report.capacitive[0], 9e-6);
  delete state.topology.terminal_to_net["C1.p"];
  assert.deepEqual(circuitEnergy(state).capacitive, [null]);
});
test("une courbe tronquée garde un trou ; une mauvaise unité n’est pas interprétée", () => {
  const state = fixture();
  state.simulation.time = [0, 1, 2];
  state.simulation.curves = [
    { id: "upper", unit: "V", values: [1, 2, 3] },
    { id: "lower", unit: "V", values: [0, 0, 0] },
    { id: "I:L1", unit: "A", values: [0.02] },
  ];
  const magnetic = circuitEnergy(state).magnetic;
  close(magnetic[0], 4e-6);
  assert.deepEqual(magnetic.slice(1), [null, null]);
  state.simulation.curves[2].unit = "V";
  assert.deepEqual(circuitEnergy(state).magnetic, [null, null, null]);
});
test("résultats obsolètes, échec récent et calcul en cours n’exposent pas d’anciennes énergies", () => {
  const state = fixture();
  state.simulation.stale = true;
  assert.equal(circuitEnergy(state).status, "stale");
  state.last_success = { ...state.simulation, stale: false };
  state.simulation.status = "error";
  assert.equal(circuitEnergy(state).status, "unavailable");
  assert.equal(circuitEnergy(state, true).status, "pending");
  state.running = true;
  assert.equal(circuitEnergy(state).status, "pending");
});
test("temps incohérents et débordement numérique restent explicites", () => {
  for (const time of [
    [1, 0],
    [0, 0],
    [-1, 1],
    [0, Infinity],
  ]) {
    const state = fixture();
    state.simulation.time = time;
    assert.equal(circuitEnergy(state).status, "unavailable");
  }
  const state = fixture();
  state.simulation.analysis.kind = "tran";
  assert.equal(circuitEnergy(state).status, "unavailable");
  state.simulation.analysis.kind = "op";
  state.simulation.currents.L1 = 1e300;
  assert.deepEqual(circuitEnergy(state).magnetic, [null]);
});
test("un montage sans élément de stockage propose une action et un condensateur seul n’invente pas de bobine", () => {
  const state = fixture();
  state.project.components.pop();
  const report = circuitEnergy(state);
  assert.deepEqual(report.magnetic, [0]);
  close(report.total[0], 9e-6);
  state.project.components = [];
  assert.equal(circuitEnergy(state).status, "empty");
});
test("CSV en unités SI conserve tous les échantillons et les valeurs manquantes", () => {
  const state = fixture();
  delete state.simulation.currents.L1;
  const csv = energyCsv(circuitEnergy(state));
  assert.equal(
    csv.split("\r\n")[0],
    '"time_s","capacitive_J","magnetic_J","total_J","C1_J","L1_J"',
  );
  assert.equal(csv.split("\r\n")[1], ",0.000009,,,0.000009,");
});
