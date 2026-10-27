import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/coach.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
});
const { summarizeCircuit } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);

function circuit() {
  return {
    project: {
      components: [
        {
          id: "V1",
          kind: "voltage_source",
          value: 5,
          label: "Source",
          pins: { p: "V1.p", n: "V1.n" },
        },
        {
          id: "R1",
          kind: "resistor",
          value: 1000,
          label: "Résistance",
          pins: { p: "R1.p", n: "R1.n" },
        },
        { id: "G1", kind: "ground", value: 0, pins: { g: "G1.g" } },
      ],
      ui: { selected: [] },
    },
    topology: {
      nets: [
        { id: "n1", points: ["V1.p", "R1.p"] },
        { id: "0", points: ["V1.n", "R1.n", "G1.g"] },
      ],
      terminal_to_net: {
        "V1.p": "n1",
        "R1.p": "n1",
        "V1.n": "0",
        "R1.n": "0",
        "G1.g": "0",
      },
    },
    simulation: null,
    diagnostics: [],
  };
}
function success() {
  return {
    status: "success",
    stale: false,
    voltages: { 0: 0, n1: 5 },
    currents: { R1: 0.005, V1: -0.005 },
    diagnostics: [],
  };
}

test("un circuit vide propose un exemple sans prétendre qu’une mesure existe", () => {
  const state = circuit();
  state.project.components = [];
  state.topology = { nets: [], terminal_to_net: {} };
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.next.kind, "examples");
  assert.equal(summary.hasCurrentMeasurements, false);
  assert.equal(summary.totalPins, 0);
  assert.ok(summary.checks.every((check) => !check.complete));
});

test("les étapes suivent les réseaux réels et non la présence de traits", () => {
  const state = circuit();
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.connectedPins, 5);
  assert.equal(summary.totalPins, 5);
  assert.deepEqual(
    summary.checks.map((check) => check.complete),
    [true, true, true, false],
  );
  assert.equal(summary.next.kind, "run");
});

test("un calcul réussi expose U, I et la puissance dissipée de la résistance", () => {
  const state = circuit();
  state.simulation = success();
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.hasCurrentMeasurements, true);
  assert.equal(summary.observations.length, 1);
  assert.deepEqual(summary.observations[0], {
    id: "R1",
    label: "Résistance",
    voltage: 5,
    current: 0.005,
    power: 0.025,
  });
  assert.equal(summary.next.kind, "none");
  assert.ok(summary.checks.every((check) => check.complete));
});

test("les mesures obsolètes ou un calcul en cours ne sont jamais présentés comme actuels", () => {
  for (const [stale, busy] of [
    [true, false],
    [false, true],
  ]) {
    const state = circuit();
    state.simulation = success();
    const summary = summarizeCircuit(state, stale, busy);
    assert.equal(summary.hasCurrentMeasurements, false);
    assert.equal(summary.observations.length, 0);
    assert.equal(summary.checks.at(-1).complete, false);
  }
  const state = circuit();
  state.simulation = { ...success(), stale: true };
  assert.equal(summarizeCircuit(state, false).hasCurrentMeasurements, false);
});

test("un échec récent ne transforme pas last_success en nouvelle mesure", () => {
  const state = circuit();
  state.simulation = { status: "error", diagnostics: [] };
  state.last_success = success();
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.hasCurrentMeasurements, false);
  assert.deepEqual(summary.observations, []);
});

test("un court-circuit démontré bloque le conseil de simuler et sélectionne le composant", () => {
  const state = circuit();
  const diagnostic = {
    code: "shorted_source",
    category: "connection",
    severity: "error",
    message: "Source court-circuitée.",
    targets: ["V1"],
  };
  state.diagnostics = [diagnostic];
  state.simulation = { status: "error", diagnostics: [diagnostic] };
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.next.kind, "select");
  assert.deepEqual(summary.next.selectIds, ["V1"]);
  assert.equal(summary.issues.length, 1);
  assert.equal(summary.checks[2].complete, false);
});

test("une masse manquante invite à la bibliothèque au lieu de lancer un calcul bloqué", () => {
  const state = circuit();
  state.project.components = state.project.components.filter(
    (component) => component.kind !== "ground",
  );
  state.diagnostics = [
    {
      code: "missing_ground",
      category: "connection",
      severity: "error",
      message: "Aucune masse.",
      targets: [],
    },
  ];
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.next.kind, "library");
  assert.equal(summary.next.label, "Ajouter une masse");
  assert.equal(summary.checks[1].complete, false);
});

test("deux bornes du même composant ne comptent pas comme une connexion au montage", () => {
  const state = circuit();
  state.topology = {
    nets: [
      { id: "isolated", points: ["R1.p", "R1.n"] },
      { id: "0", points: ["G1.g"] },
      { id: "v", points: ["V1.p", "V1.n"] },
    ],
    terminal_to_net: {
      "R1.p": "isolated",
      "R1.n": "isolated",
      "G1.g": "0",
      "V1.p": "v",
      "V1.n": "v",
    },
  };
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.connectedPins, 0);
  assert.equal(summary.checks[1].complete, false);
  assert.equal(summary.checks[2].complete, false);
});

test("une borne isolée propose une sélection et une hypothèse reste une hypothèse", () => {
  const state = circuit();
  state.diagnostics = [
    {
      code: "floating_island",
      category: "hypothesis",
      severity: "warning",
      message: "Un îlot pourrait flotter.",
      targets: ["n1"],
    },
    {
      code: "dangling_terminal",
      category: "connection",
      severity: "warning",
      message: "Borne isolée.",
      targets: ["R1.p"],
    },
  ];
  const summary = summarizeCircuit(state, false);
  assert.equal(summary.issues[0].code, "dangling_terminal");
  assert.equal(summary.issues[1].category, "hypothesis");
  assert.deepEqual(summary.issues[1].selectIds, ["R1", "V1"]);
  assert.deepEqual(summary.next.selectIds, ["R1"]);
});

test("les observations non finies sont ignorées et les données du projet restent intactes", () => {
  const state = circuit();
  state.simulation = success();
  state.simulation.voltages.n1 = Infinity;
  const before = structuredClone(state);
  assert.deepEqual(summarizeCircuit(state, false).observations, []);
  assert.deepEqual(state, before);
});

test("un résultat obsolète ne réutilise pas les anciens diagnostics de simulation", () => {
  const state = circuit();
  state.simulation = {
    ...success(),
    diagnostics: [
      {
        code: "old",
        category: "connection",
        severity: "error",
        message: "Ancien court-circuit.",
        targets: ["V1"],
      },
    ],
  };
  assert.deepEqual(summarizeCircuit(state, true).issues, []);
  assert.equal(summarizeCircuit(state, true).next.kind, "run");
});
