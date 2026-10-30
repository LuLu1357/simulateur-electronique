import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/notebook.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
});
const {
  notebookStorageKey,
  maxCaptures,
  circuitComparisonKey,
  createNotebookCapture,
  compareNotebookCaptures,
  describeNotebookChanges,
  readNotebook,
  writeNotebook,
  appendNotebookCapture,
  notebookHasIncompleteSampleProvenance,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);

const circuit = () => ({
  id: "ohm",
  title: "Loi d’Ohm",
  revision: 3,
  components: [
    {
      id: "V1",
      kind: "voltage_source",
      label: "Alimentation",
      value: 5,
      pins: { p: "V1.p", n: "V1.n" },
    },
    {
      id: "R1",
      kind: "resistor",
      label: "Résistance",
      value: 1000,
      pins: { p: "R1.p", n: "R1.n" },
    },
  ],
  schematic: { R1: { x: 20, y: 40 } },
});
const nets = () => ({
  nets: [
    { id: "0", points: ["V1.n", "R1.n"] },
    { id: "n1", name: "Alimentation", points: ["V1.p", "R1.p"] },
  ],
});
const result = () => ({
  status: "success",
  project_revision: 3,
  time: [],
  analysis: { kind: "op" },
  voltages: { 0: 0, n1: 5 },
  currents: { V1: -0.005, R1: 0.005 },
});
const snapshot = () =>
  createNotebookCapture(
    circuit(),
    result(),
    nets(),
    false,
    "Premier essai",
    "2026-10-27T20:00:00.000Z",
  );
function memory(raw) {
  const values = new Map(raw === undefined ? [] : [[notebookStorageKey, raw]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("une capture conserve les valeurs finies et signes, sans référencer les objets vivants", () => {
  const project = circuit(),
    simulation = result(),
    topology = nets();
  const capture = createNotebookCapture(
    project,
    simulation,
    topology,
    false,
    "  Une note  ",
    "2026-10-27T20:00:00.000Z",
  );
  assert.equal(capture.note, "Une note");
  assert.equal(capture.analysisLabel, "OP · état stabilisé");
  assert.equal(
    capture.measurements.find((measurement) => measurement.id === "I:V1").value,
    -0.005,
  );
  assert.equal(
    capture.measurements.find(
      (measurement) =>
        measurement.unit === "V" && measurement.label === "Alimentation",
    ).value,
    5,
  );
  project.components[1].value = 2000;
  simulation.currents.R1 = 0.0025;
  topology.nets[0].points.push("extra");
  assert.equal(capture.componentValues.R1, 1000);
  assert.equal(
    capture.measurements.find((measurement) => measurement.id === "I:R1").value,
    0.005,
  );
});

test("les résultats manquants, ratés ou obsolètes ne sont jamais capturés", () => {
  for (const simulation of [
    null,
    { ...result(), status: "error" },
    { ...result(), status: "cancelled" },
    { ...result(), stale: true },
  ])
    assert.equal(
      createNotebookCapture(circuit(), simulation, nets(), false),
      null,
    );
  assert.equal(createNotebookCapture(circuit(), result(), nets(), true), null);
  assert.equal(
    createNotebookCapture(
      circuit(),
      { ...result(), voltages: {}, currents: {} },
      nets(),
      false,
    ),
    null,
  );
});

test("les valeurs NaN et infinies sont exclues des captures et les notes sont bornées", () => {
  const capture = createNotebookCapture(
    circuit(),
    {
      ...result(),
      currents: { R1: NaN, V1: -Infinity },
      voltages: { n1: Infinity, 0: 0 },
    },
    nets(),
    false,
    "x".repeat(400),
  );
  assert.equal(capture.measurements.length, 1);
  assert.equal(capture.measurements[0].value, 0);
  assert.equal(capture.note.length, 280);
});

test("la comparaison mesure une vraie variation de résistance sans changer le câblage", () => {
  const baseline = snapshot(),
    project = circuit(),
    simulation = result();
  project.components[1].value = 2000;
  project.revision++;
  simulation.currents.R1 = 0.0025;
  const candidate = createNotebookCapture(project, simulation, nets(), false);
  const comparison = compareNotebookCaptures(baseline, candidate);
  assert.equal(comparison.comparable, true);
  assert.equal(
    comparison.rows.find((row) => row.id === "I:R1").baseline,
    0.005,
  );
  assert.equal(comparison.rows.find((row) => row.id === "I:R1").delta, -0.0025);
  assert.equal(candidate.componentValues.R1, 2000);
});

test("l’ordre des composants, des réseaux, des points et la disposition ne changent pas l’identité", () => {
  const project = circuit(),
    topology = nets(),
    original = circuitComparisonKey(project, topology);
  project.components.reverse();
  project.schematic.R1.x = 100;
  topology.nets.reverse();
  topology.nets.forEach((net) => {
    net.points.reverse();
    net.holes = ["a1", "b1"];
  });
  assert.equal(circuitComparisonKey(project, topology), original);
});

test("un autre projet, câblage, composant ou ensemble de mesures interdit la comparaison", () => {
  const baseline = snapshot();
  const differentProject = { ...baseline, projectId: "divider" };
  const differentTopology = nets();
  differentTopology.nets[1].points = ["V1.p"];
  const differentComponent = circuit();
  differentComponent.components[1].kind = "capacitor";
  for (const candidate of [
    differentProject,
    createNotebookCapture(circuit(), result(), differentTopology, false),
    createNotebookCapture(differentComponent, result(), nets(), false),
    { ...baseline, measurements: baseline.measurements.slice(1) },
    {
      ...baseline,
      measurements: baseline.measurements.map((measurement, index) =>
        index ? measurement : { ...measurement, unit: "A" },
      ),
    },
    null,
  ]) {
    const comparison = compareNotebookCaptures(baseline, candidate);
    assert.equal(comparison.comparable, false);
    assert.deepEqual(comparison.rows, []);
    assert.ok(comparison.reason.length > 0);
  }
});

test("OP et TRAN, instants différents et conditions initiales différentes restent séparés", () => {
  const baseline = snapshot();
  const transient = (time, startup = true) =>
    createNotebookCapture(
      circuit(),
      { ...result(), analysis: { kind: "tran", startup }, time: [0, time] },
      nets(),
      false,
    );
  assert.equal(
    compareNotebookCaptures(baseline, transient(0.01)).comparable,
    false,
  );
  assert.equal(
    compareNotebookCaptures(transient(0.01), transient(0.02)).comparable,
    false,
  );
  assert.equal(
    compareNotebookCaptures(transient(0.01), transient(0.01, false)).comparable,
    false,
  );
  assert.equal(
    compareNotebookCaptures(transient(0.01), transient(0.01)).comparable,
    true,
  );
  assert.equal(
    createNotebookCapture(
      circuit(),
      { ...result(), analysis: { kind: "tran" } },
      nets(),
      false,
    ),
    null,
  );
});

test("l’historique limite ses captures à douze et remplace un identifiant identique", () => {
  let captures = [];
  for (let index = 0; index < 20; index++)
    captures = appendNotebookCapture(captures, {
      ...snapshot(),
      id: `capture-${index}`,
    });
  assert.equal(captures.length, maxCaptures);
  assert.equal(captures[0].id, "capture-19");
  assert.equal(captures.at(-1).id, "capture-8");
  const updated = appendNotebookCapture(captures, {
    ...captures[4],
    note: "mise à jour",
  });
  assert.equal(updated.length, maxCaptures);
  assert.equal(updated[0].note, "mise à jour");
  assert.equal(updated.filter((entry) => entry.id === updated[0].id).length, 1);
});

test("le carnet relit ses captures et n’enregistre aucun champ supplémentaire", () => {
  const storage = memory();
  const capture = {
    ...snapshot(),
    token: "confidentiel",
    netlist: "ne pas copier",
  };
  assert.equal(writeNotebook(storage, [capture]), true);
  const raw = storage.values.get(notebookStorageKey);
  assert.equal(raw.includes("confidentiel"), false);
  assert.equal(raw.includes("ne pas copier"), false);
  const loaded = readNotebook(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].note, capture.note);
  assert.deepEqual(loaded[0].measurements, capture.measurements);
});

test("stockage refusé, versions inconnues et données corrompues ne bloquent jamais le carnet", () => {
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("full");
    },
  };
  assert.deepEqual(readNotebook(denied), []);
  assert.equal(writeNotebook(denied, [snapshot()]), false);
  assert.equal(writeNotebook(null, [snapshot()]), false);
  for (const raw of [
    "{",
    "null",
    "[]",
    JSON.stringify({ version: 2, captures: [snapshot()] }),
    JSON.stringify({ version: 1, captures: [null, { id: "invalid" }] }),
  ])
    assert.deepEqual(readNotebook(memory(raw)), []);
  const duplicateMeasurements = { ...snapshot() };
  duplicateMeasurements.measurements.push(
    duplicateMeasurements.measurements[0],
  );
  const invalidNumber = { ...snapshot(), revision: -1 };
  const invalidDate = { ...snapshot(), capturedAt: "not-a-date" };
  for (const capture of [duplicateMeasurements, invalidNumber, invalidDate])
    assert.deepEqual(
      readNotebook(memory(JSON.stringify({ version: 1, captures: [capture] }))),
      [],
    );
});

test("un quota refusé conserve les captures en mémoire lors de la réouverture du panneau", () => {
  const denied = {
    getItem() {
      return null;
    },
    setItem() {
      throw Error("quota");
    },
  };
  const capture = snapshot();
  assert.equal(writeNotebook(denied, [capture]), false);
  const reopened = readNotebook(denied);
  assert.deepEqual(reopened, [capture]);
  reopened[0].note = "Modification hors du cache";
  assert.equal(readNotebook(denied)[0].note, capture.note);
  // Une suppression non persistée remplace aussi le cache de session.
  assert.equal(writeNotebook(denied, []), false);
  assert.deepEqual(readNotebook(denied), []);
});

test("le curseur d’un potentiomètre est capturé et comparé sans modifier sa résistance nominale", () => {
  const project = circuit();
  project.components[1] = {
    id: "R1",
    kind: "potentiometer",
    label: "Potentiomètre",
    value: 10000,
    pins: { p: "R1.p", w: "R1.w", n: "R1.n" },
  };
  const topology = nets();
  topology.nets.push({ id: "out", points: ["R1.w"] });
  const baseline = createNotebookCapture(project, result(), topology, false);
  assert.equal(baseline.componentSettings.R1.position, 0.5);
  project.components[1].position = 0.8;
  const candidate = createNotebookCapture(project, result(), topology, false);
  assert.equal(candidate.componentValues.R1, baseline.componentValues.R1);
  assert.equal(compareNotebookCaptures(baseline, candidate).comparable, true);
  assert.deepEqual(describeNotebookChanges(baseline, candidate), {
    changes: [{ id: "R1", fields: ["position"] }],
    incompleteProvenance: false,
  });
  const storage = memory();
  assert.equal(writeNotebook(storage, [baseline, candidate]), true);
  const restored = readNotebook(storage);
  assert.equal(restored[0].componentSettings.R1.position, 0.5);
  assert.equal(restored[1].componentSettings.R1.position, 0.8);
});

test("changer de modèle LED est une expérience comparable avec un réglage identifié", () => {
  const project = circuit();
  project.components[1] = {
    id: "R1",
    kind: "led",
    label: "LED",
    value: 0,
    model: "led_red",
    pins: { a: "R1.p", k: "R1.n" },
  };
  const baseline = createNotebookCapture(project, result(), nets(), false);
  project.components[1].model = "led_green";
  const candidate = createNotebookCapture(project, result(), nets(), false);
  assert.equal(compareNotebookCaptures(baseline, candidate).comparable, true);
  assert.deepEqual(describeNotebookChanges(baseline, candidate), {
    changes: [{ id: "R1", fields: ["model"] }],
    incompleteProvenance: false,
  });
  assert.equal(baseline.componentSettings.R1.model, "led_red");
  assert.equal(candidate.componentSettings.R1.model, "led_green");
});

test("une ancienne capture v1 reste lisible sans prétendre connaître ses réglages", () => {
  const old = snapshot();
  delete old.componentSettings;
  const loaded = readNotebook(
    memory(JSON.stringify({ version: 1, captures: [old] })),
  );
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].componentSettings, undefined);
  assert.equal(compareNotebookCaptures(loaded[0], snapshot()).comparable, true);
  assert.deepEqual(describeNotebookChanges(loaded[0], snapshot()), {
    changes: [],
    incompleteProvenance: true,
  });
  const partial = snapshot();
  delete partial.componentSettings.R1;
  assert.equal(
    describeNotebookChanges(partial, snapshot()).incompleteProvenance,
    true,
  );
  const changedValue = snapshot();
  changedValue.componentValues.R1 = 2000;
  assert.deepEqual(describeNotebookChanges(old, changedValue), {
    changes: [{ id: "R1", fields: ["value"] }],
    incompleteProvenance: true,
  });
});

test("la tension initiale du condensateur est documentée et les réglages stockés sont bornés", () => {
  const project = circuit();
  project.components[1].kind = "capacitor";
  const baseline = createNotebookCapture(project, result(), nets(), false);
  assert.equal(baseline.componentSettings.R1.initial_voltage, 0);
  project.components[1].initial_voltage = 2;
  const candidate = createNotebookCapture(project, result(), nets(), false);
  assert.deepEqual(describeNotebookChanges(baseline, candidate), {
    changes: [{ id: "R1", fields: ["initial_voltage"] }],
    incompleteProvenance: false,
  });
  for (const settings of [
    null,
    [],
    { R1: null },
    { R1: { model: 3 } },
    { R1: { model: "x".repeat(201) } },
    { R1: { position: -0.1 } },
    { R1: { position: 1.1 } },
    { R1: { position: "0.5" } },
    { R1: { initial_voltage: null } },
  ]) {
    const raw = JSON.stringify({
      version: 1,
      captures: [{ ...snapshot(), componentSettings: settings }],
    });
    assert.deepEqual(readNotebook(memory(raw)), []);
  }
  const storage = memory();
  const withExtraFields = snapshot();
  withExtraFields.componentSettings.R1.token = "ne-jamais-copier";
  assert.equal(writeNotebook(storage, [withExtraFields]), true);
  assert.equal(
    storage.values.get(notebookStorageKey).includes("ne-jamais-copier"),
    false,
  );
  assert.equal(
    describeNotebookChanges(baseline, baseline).incompleteProvenance,
    false,
  );
});

const pulse = () => ({
  kind: "pulse",
  low: 0,
  high: 5,
  delay: 0,
  rise: 0.00001,
  fall: 0.00001,
  width: 0.0005,
  period: 0.001,
});

test("les changements de niveau et période PULSE sont capturés comme signal comparable", () => {
  const project = circuit();
  project.components[0].waveform = pulse();
  const baseline = createNotebookCapture(project, result(), nets(), false);
  for (const change of [{ high: 3.3 }, { period: 0.002 }]) {
    project.components[0].waveform = { ...pulse(), ...change };
    const candidate = createNotebookCapture(project, result(), nets(), false);
    assert.equal(compareNotebookCaptures(baseline, candidate).comparable, true);
    assert.deepEqual(describeNotebookChanges(baseline, candidate), {
      changes: [{ id: "V1", fields: ["waveform"] }],
      incompleteProvenance: false,
    });
  }
  assert.equal(baseline.componentSettings.V1.waveform.high, 5);
  const storage = memory();
  assert.equal(writeNotebook(storage, [baseline]), true);
  assert.deepEqual(
    readNotebook(storage)[0].componentSettings.V1.waveform,
    pulse(),
  );
  project.components[0].waveform = undefined;
  const dc = createNotebookCapture(project, result(), nets(), false);
  assert.equal(dc.componentSettings.V1.waveform, null);
  assert.deepEqual(describeNotebookChanges(baseline, dc).changes, [
    { id: "V1", fields: ["waveform"] },
  ]);
});

test("les signaux utilisent une représentation canonique et ne recopient aucun champ étranger", () => {
  const project = circuit();
  const stimulus = pulse();
  project.components[0].waveform = {
    ...stimulus,
    token: "signal-confidentiel",
    private: { arbitrary: true },
  };
  const first = createNotebookCapture(project, result(), nets(), false);
  project.components[0].waveform = Object.fromEntries(
    Object.entries(stimulus).reverse(),
  );
  const second = createNotebookCapture(project, result(), nets(), false);
  assert.deepEqual(describeNotebookChanges(first, second), {
    changes: [],
    incompleteProvenance: false,
  });
  assert.deepEqual(Object.keys(first.componentSettings.V1.waveform), [
    "kind",
    "low",
    "high",
    "delay",
    "rise",
    "fall",
    "width",
    "period",
  ]);
  const storage = memory();
  first.componentSettings.V1.waveform = {
    ...stimulus,
    token: "signal-confidentiel",
  };
  assert.equal(writeNotebook(storage, [first]), true);
  assert.equal(
    storage.values.get(notebookStorageKey).includes("signal-confidentiel"),
    false,
  );
  assert.deepEqual(
    readNotebook(storage)[0].componentSettings.V1.waveform,
    stimulus,
  );
});

test("le carnet refuse les signaux incomplets, non finis ou hors contrat sans borner arbitrairement leur durée", () => {
  const invalid = [
    {},
    [],
    { ...pulse(), kind: "sine" },
    { ...pulse(), high: 1000001 },
    { ...pulse(), low: -1000001 },
    { ...pulse(), high: "5" },
    { ...pulse(), delay: -1 },
    { ...pulse(), rise: 0 },
    { ...pulse(), fall: -1 },
    { ...pulse(), width: 0 },
    { ...pulse(), period: 0 },
    { ...pulse(), period: 0.0001 },
    { ...pulse(), delay: Infinity },
    { ...pulse(), high: NaN },
  ];
  const missing = pulse();
  delete missing.width;
  invalid.push(missing);
  for (const waveform of invalid) {
    const project = circuit();
    project.components[0].waveform = waveform;
    assert.equal(createNotebookCapture(project, result(), nets(), false), null);
    const capture = snapshot();
    capture.componentSettings.V1.waveform = waveform;
    assert.deepEqual(
      readNotebook(memory(JSON.stringify({ version: 1, captures: [capture] }))),
      [],
    );
  }
  const project = circuit();
  project.components[0].waveform = { ...pulse(), delay: 100, period: 1000 };
  assert.ok(createNotebookCapture(project, result(), nets(), false));
  project.components[0].waveform = {
    ...pulse(),
    rise: 0.1,
    width: 0.2,
    fall: 0.1,
    period: 0.4,
  };
  assert.ok(createNotebookCapture(project, result(), nets(), false));
});

test("les captures précédant les signaux restent lisibles avec provenance explicitement partielle", () => {
  const previous = snapshot();
  delete previous.componentSettings.V1.waveform;
  const loaded = readNotebook(
    memory(JSON.stringify({ version: 1, captures: [previous] })),
  )[0];
  assert.ok(loaded);
  assert.equal(loaded.componentSettings.V1.waveform, undefined);
  assert.equal(compareNotebookCaptures(loaded, snapshot()).comparable, true);
  assert.equal(
    describeNotebookChanges(loaded, snapshot()).incompleteProvenance,
    true,
  );
});

const transientResult = () => ({
  ...result(),
  analysis: { kind: "tran", startup: true },
  time: [0, 0.001, 0.004, 0.01],
  simulation_id: "simulation_0123456789abcdef",
});
const replayedResult = () => ({
  ...transientResult(),
  sample_index: 1,
  sample_time: 0.001,
  sample_count: 4,
  voltages: { 0: 0, n1: 2 },
  currents: { V1: -0.002, R1: 0.002 },
});

test("une capture de relecture conserve les mesures affichées et leur véritable échantillon", () => {
  const simulation = replayedResult();
  const capture = createNotebookCapture(circuit(), simulation, nets(), false);
  assert.equal(capture.sampleIndex, 1);
  assert.equal(capture.sampleTime, 0.001);
  assert.equal(capture.sampleCount, 4);
  assert.equal(capture.simulationId, simulation.simulation_id);
  assert.deepEqual(JSON.parse(capture.analysisKey), {
    kind: "tran",
    time: 0.001,
    startup: true,
  });
  assert.match(capture.analysisLabel, /t = 0\.001000 s.*échantillon 2\/4/);
  assert.equal(
    capture.measurements.find((measurement) => measurement.id === "I:R1").value,
    0.002,
  );
  assert.equal(
    capture.measurements.find(
      (measurement) =>
        measurement.unit === "V" && measurement.label === "Alimentation",
    ).value,
    2,
  );
  simulation.currents.R1 = 0.005;
  simulation.time[1] = 0.002;
  simulation.simulation_id = "autre_calcul";
  assert.equal(capture.sampleTime, 0.001);
  assert.equal(
    capture.measurements.find((measurement) => measurement.id === "I:R1").value,
    0.002,
  );
  const storage = memory();
  assert.equal(writeNotebook(storage, [capture]), true);
  assert.deepEqual(readNotebook(storage), [capture]);
});

test("la capture sépare la révision visuelle de la provenance du calcul affiché", () => {
  const project = { ...circuit(), revision: 7 };
  const simulation = {
    ...replayedResult(),
    circuit_fingerprint: "a".repeat(64),
  };
  const capture = createNotebookCapture(project, simulation, nets(), false);
  assert.equal(capture.revision, 7);
  assert.equal(capture.sourceRevision, 3);
  assert.equal(capture.circuitFingerprint, "a".repeat(64));
  assert.equal(capture.simulationId, simulation.simulation_id);
  const storage = memory();
  assert.equal(writeNotebook(storage, [capture]), true);
  assert.deepEqual(readNotebook(storage), [capture]);
  simulation.circuit_fingerprint = "nouvelle_empreinte";
  simulation.project_revision = 7;
  assert.equal(capture.sourceRevision, 3);
  assert.equal(capture.circuitFingerprint, "a".repeat(64));
  const previous = { ...capture };
  delete previous.sourceRevision;
  delete previous.circuitFingerprint;
  assert.deepEqual(
    readNotebook(memory(JSON.stringify({ version: 1, captures: [previous] }))),
    [previous],
  );
});

test("une provenance de calcul incohérente ou malformée ne peut être capturée ou stockée", () => {
  for (const sourceRevision of [-1, 4, 1.5, "3", NaN, Infinity]) {
    assert.equal(
      createNotebookCapture(
        circuit(),
        { ...replayedResult(), project_revision: sourceRevision },
        nets(),
        false,
      ),
      null,
    );
    const capture = { ...snapshot(), sourceRevision };
    assert.deepEqual(
      readNotebook(memory(JSON.stringify({ version: 1, captures: [capture] }))),
      [],
    );
  }
  for (const circuitFingerprint of [
    null,
    "",
    "foreign fingerprint",
    "../private",
    "x".repeat(129),
  ]) {
    assert.equal(
      createNotebookCapture(
        circuit(),
        { ...replayedResult(), circuit_fingerprint: circuitFingerprint },
        nets(),
        false,
      ),
      null,
    );
    const capture = { ...snapshot(), circuitFingerprint };
    assert.deepEqual(
      readNotebook(memory(JSON.stringify({ version: 1, captures: [capture] }))),
      [],
    );
  }
});

test("le dernier point est identifié sans override et une capture OP ne reçoit pas d’instant", () => {
  const capture = createNotebookCapture(
    circuit(),
    transientResult(),
    nets(),
    false,
  );
  assert.equal(capture.sampleIndex, 3);
  assert.equal(capture.sampleTime, 0.01);
  assert.equal(capture.sampleCount, 4);
  assert.match(capture.analysisLabel, /échantillon 4\/4/);
  assert.equal(notebookHasIncompleteSampleProvenance(capture), false);
  const atZero = createNotebookCapture(
    circuit(),
    { ...replayedResult(), sample_index: 0, sample_time: 0 },
    nets(),
    false,
  );
  assert.equal(atZero.sampleTime, 0);
  assert.match(atZero.analysisLabel, /échantillon 1\/4/);
  const dc = createNotebookCapture(
    circuit(),
    { ...result(), simulation_id: "calcul_op" },
    nets(),
    false,
  );
  assert.equal(dc.simulationId, "calcul_op");
  for (const key of ["sampleTime", "sampleIndex", "sampleCount"])
    assert.equal(Object.hasOwn(dc, key), false);
  assert.equal(
    createNotebookCapture(
      circuit(),
      { ...result(), sample_index: 0, sample_time: 0, sample_count: 1 },
      nets(),
      false,
    ),
    null,
  );
});

test("un override partiel, incohérent ou non fini ne peut attribuer les mesures à un autre instant", () => {
  const mutations = [
    (simulation) => {
      delete simulation.sample_time;
    },
    (simulation) => {
      simulation.sample_index = -1;
    },
    (simulation) => {
      simulation.sample_index = 1.5;
    },
    (simulation) => {
      simulation.sample_index = 4;
    },
    (simulation) => {
      simulation.sample_index = true;
    },
    (simulation) => {
      simulation.sample_count = 0;
    },
    (simulation) => {
      simulation.sample_count = 6001;
    },
    (simulation) => {
      simulation.sample_count = 3;
    },
    (simulation) => {
      simulation.sample_time = 0.004;
    },
    (simulation) => {
      simulation.sample_time = -0.001;
    },
    (simulation) => {
      simulation.sample_time = Infinity;
    },
    (simulation) => {
      simulation.time[2] = 0.0005;
    },
    (simulation) => {
      simulation.time[2] = NaN;
    },
    (simulation) => {
      simulation.time = [];
    },
  ];
  for (const mutate of mutations) {
    const simulation = replayedResult();
    mutate(simulation);
    assert.equal(
      createNotebookCapture(circuit(), simulation, nets(), false),
      null,
    );
  }
  for (const simulation_id of [
    null,
    "",
    "x".repeat(129),
    "un calcul",
    "../secret",
    "opaque\nID",
  ])
    assert.equal(
      createNotebookCapture(
        circuit(),
        { ...replayedResult(), simulation_id },
        nets(),
        false,
      ),
      null,
    );
});

test("le stockage rejette une provenance temporelle fausse plutôt que de la transformer en capture ancienne", () => {
  const capture = createNotebookCapture(
    circuit(),
    replayedResult(),
    nets(),
    false,
  );
  const mutations = [
    (entry) => {
      delete entry.sampleCount;
    },
    (entry) => {
      entry.sampleIndex = 0.5;
    },
    (entry) => {
      entry.sampleIndex = 4;
    },
    (entry) => {
      entry.sampleCount = 0;
    },
    (entry) => {
      entry.sampleCount = 6001;
    },
    (entry) => {
      entry.sampleTime = "0.001";
    },
    (entry) => {
      entry.sampleTime = Infinity;
    },
    (entry) => {
      entry.simulationId = "x".repeat(129);
    },
    (entry) => {
      entry.simulationId = "source inconnue";
    },
    (entry) => {
      entry.analysisKey = JSON.stringify({
        kind: "tran",
        time: 0.01,
        startup: true,
      });
    },
    (entry) => {
      entry.analysisKey = JSON.stringify({ kind: "op" });
    },
  ];
  for (const mutate of mutations) {
    const entry = structuredClone(capture);
    mutate(entry);
    assert.deepEqual(
      readNotebook(memory(JSON.stringify({ version: 1, captures: [entry] }))),
      [],
    );
  }
});

test("la comparaison exige le même instant physique, sans confondre indice adaptatif et identifiant du calcul", () => {
  const first = createNotebookCapture(
    circuit(),
    replayedResult(),
    nets(),
    false,
  );
  const otherTime = createNotebookCapture(
    circuit(),
    { ...replayedResult(), sample_index: 2, sample_time: 0.004 },
    nets(),
    false,
  );
  const different = compareNotebookCaptures(first, otherTime);
  assert.equal(different.comparable, false);
  assert.match(different.reason, /même instant/);
  assert.deepEqual(different.rows, []);
  const adapted = {
    ...replayedResult(),
    simulation_id: "nouveau_calcul",
    time: [0, 0.0005, 0.001, 0.004, 0.01],
    sample_index: 2,
    sample_count: 5,
    currents: { V1: -0.001, R1: 0.001 },
  };
  const second = createNotebookCapture(circuit(), adapted, nets(), false);
  const comparison = compareNotebookCaptures(first, second);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.rows.find((row) => row.id === "I:R1").delta, -0.001);
});

test("les anciens TRAN restent lisibles et comparables à leur instant enregistré avec provenance partielle", () => {
  const current = createNotebookCapture(
    circuit(),
    transientResult(),
    nets(),
    false,
  );
  const old = { ...current, analysisLabel: "TRAN · t = 0.01000 s" };
  for (const key of [
    "sampleIndex",
    "sampleTime",
    "sampleCount",
    "simulationId",
  ])
    delete old[key];
  const [loaded] = readNotebook(
    memory(JSON.stringify({ version: 1, captures: [old] })),
  );
  assert.ok(loaded);
  assert.equal(loaded.sampleTime, undefined);
  assert.equal(notebookHasIncompleteSampleProvenance(loaded), true);
  assert.equal(compareNotebookCaptures(loaded, current).comparable, true);
  assert.equal(
    describeNotebookChanges(loaded, current).incompleteProvenance,
    true,
  );
  assert.equal(notebookHasIncompleteSampleProvenance(snapshot()), false);
});
