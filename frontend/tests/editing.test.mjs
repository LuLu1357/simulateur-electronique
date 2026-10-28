import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/editing.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const {
  rotationOperations,
  moveSelectionOperations,
  selectedInBox,
  duplicateSelectionOperations,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const project = {
  components: [
    { id: "R1", pins: { p: "R1.p", n: "R1.n" } },
    { id: "V1", pins: { p: "V1.p", n: "V1.n" } },
  ],
  schematic: { R1: { x: 100, y: 200 }, V1: { x: 300, y: 80, rotation: 270 } },
  wires: [{ id: "W1", a: "R1.p", b: "V1.p" }],
};
test("la rotation horaire conserve les positions, les bornes et le projet", () => {
  const before = JSON.stringify(project);
  assert.deepEqual(rotationOperations(project, ["R1"]), [
    { type: "move_component", id: "R1", x: 100, y: 200, rotation: 90 },
  ]);
  assert.equal(JSON.stringify(project), before);
});
test("la rotation boucle de 270 à 0 et fonctionne dans le sens inverse", () => {
  assert.equal(rotationOperations(project, ["V1"])[0].rotation, 0);
  assert.equal(rotationOperations(project, ["R1"], -1)[0].rotation, 270);
});
test("les fils et sélections absentes ne produisent aucune rotation", () => {
  assert.deepEqual(rotationOperations(project, ["W1", "absent"]), []);
  assert.equal(rotationOperations(project, ["R1", "V1"]).length, 2);
});

const selectedProject = {
  components: [
    {
      id: "R1",
      kind: "resistor",
      label: "R1",
      value: 1000,
      pins: { p: "R1.p", n: "R1.n" },
    },
    {
      id: "C1",
      kind: "capacitor",
      label: "Filtre",
      value: 1e-6,
      initial_voltage: 2,
      pins: { p: "C1.p", n: "C1.n" },
    },
    {
      id: "RV1",
      kind: "potentiometer",
      label: "Réglage",
      value: 10000,
      position: 0.25,
      pins: { p: "RV1.p", w: "RV1.w", n: "RV1.n" },
    },
    {
      id: "D1",
      kind: "led",
      label: "Témoin",
      value: 0,
      model: "generic_led_green",
      pins: { a: "D1.a", k: "D1.k" },
    },
  ],
  schematic: {
    R1: { x: 100, y: 100, rotation: 90 },
    C1: { x: 300, y: 100 },
    RV1: { x: 400, y: 200, rotation: 270 },
    D1: { x: 600, y: 300 },
  },
  junctions: [{ id: "J1", x: 220, y: 100 }],
  wires: [
    { id: "W1", a: "R1.n", b: "J1" },
    { id: "W2", a: "J1", b: "C1.p" },
    { id: "W3", a: "C1.n", b: "RV1.p" },
    { id: "W4", a: "RV1.n", b: "D1.a" },
  ],
  breadboard: { placements: { "R1.p": "a1", "R1.n": "a5" }, rail_splits: true },
};

test("le déplacement groupé comprend composants et jonctions sans déplacer la plaque", () => {
  const before = JSON.stringify(selectedProject);
  assert.deepEqual(
    moveSelectionOperations(selectedProject, ["R1", "J1", "W1"], 10, -20),
    [
      { type: "move_component", id: "R1", x: 110, y: 80 },
      { type: "move_junction", id: "J1", x: 230, y: 80 },
    ],
  );
  assert.equal(JSON.stringify(selectedProject), before);
  assert.deepEqual(moveSelectionOperations(selectedProject, ["R1"], 0, 0), []);
  assert.deepEqual(
    moveSelectionOperations(selectedProject, ["R1"], Infinity, 0),
    [],
  );
});

test("le rectangle sélectionne les centres et jonctions dans les deux sens, bords inclus", () => {
  assert.deepEqual(
    selectedInBox(selectedProject, { x1: 100, y1: 100, x2: 300, y2: 100 }),
    ["R1", "C1", "J1"],
  );
  assert.deepEqual(
    selectedInBox(selectedProject, { x1: 300, y1: 100, x2: 100, y2: 100 }),
    ["R1", "C1", "J1"],
  );
  assert.deepEqual(
    selectedInBox(selectedProject, { x1: NaN, y1: 100, x2: 300, y2: 100 }),
    [],
  );
});

test("la duplication remappe seulement les fils internes et ne copie aucune implantation", () => {
  const before = JSON.stringify(selectedProject);
  const copy = duplicateSelectionOperations(selectedProject, [
    "R1",
    "J1",
    "C1",
    "W3",
  ]);
  assert.deepEqual(copy.selected, [
    "R1_copy",
    "C1_copy",
    "J1_copy",
    "W1_copy",
    "W2_copy",
  ]);
  assert.deepEqual(
    copy.operations.filter((op) => op.type === "connect"),
    [
      { type: "connect", id: "W1_copy", a: "R1_copy.n", b: "J1_copy" },
      { type: "connect", id: "W2_copy", a: "J1_copy", b: "C1_copy.p" },
    ],
  );
  assert.deepEqual(
    copy.operations.find((op) => op.type === "move_component"),
    { type: "move_component", id: "R1_copy", x: 130, y: 130, rotation: 90 },
  );
  const capacitor = copy.operations.find((op) => op.id === "C1_copy");
  assert.equal(capacitor.initial_voltage, 2);
  assert.equal(capacitor.label, "Filtre");
  assert.equal(
    copy.operations.find((op) => op.id === "R1_copy").label,
    "R1_copy",
  );
  assert.equal(
    copy.operations.some((op) => op.type === "place_pin"),
    false,
  );
  assert.equal(JSON.stringify(selectedProject), before);
});

test("les modèles et positions de curseur sont conservés dans une copie", () => {
  const copy = duplicateSelectionOperations(selectedProject, ["D1", "RV1"], {
    x: -50,
    y: 20,
  });
  assert.equal(
    copy.operations.find((op) => op.id === "D1_copy").model,
    "generic_led_green",
  );
  assert.equal(
    copy.operations.find((op) => op.id === "RV1_copy").position,
    0.25,
  );
  assert.deepEqual(
    copy.operations.find((op) => op.type === "move_component"),
    { type: "move_component", id: "RV1_copy", x: 350, y: 220, rotation: 270 },
  );
});

test("les identifiants de copie évitent objets et bornes existants et restent bornés", () => {
  const collision = structuredClone(selectedProject);
  collision.junctions.push(
    { id: "R1_copy", x: 0, y: 0 },
    { id: "C1_copy.p", x: 1, y: 1 },
  );
  const copy = duplicateSelectionOperations(collision, ["R1", "C1"]);
  assert.equal(
    copy.operations.find((op) => op.kind === "resistor").id,
    "R1_copy2",
  );
  assert.equal(
    copy.operations.find((op) => op.kind === "capacitor").id,
    "C1_copy2",
  );
  const long = structuredClone(selectedProject);
  const id = "R".repeat(80);
  long.components[0] = {
    ...long.components[0],
    id,
    pins: { p: id + ".p", n: id + ".n" },
  };
  long.schematic[id] = long.schematic.R1;
  const generated = duplicateSelectionOperations(long, [id]);
  for (const op of generated.operations)
    assert.match(op.id, /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
  assert.ok(generated.operations[0].id.length + 2 <= 80);
});

test("dupliquer un fil seul ou une sélection vide ne crée pas de lien vers l’original", () => {
  assert.deepEqual(duplicateSelectionOperations(selectedProject, ["W1"]), {
    operations: [],
    selected: [],
  });
  assert.deepEqual(duplicateSelectionOperations(selectedProject, []), {
    operations: [],
    selected: [],
  });
  assert.deepEqual(
    duplicateSelectionOperations(selectedProject, ["R1"], { x: NaN, y: 10 }),
    { operations: [], selected: [] },
  );
});

test("la duplication d’une source conserve une copie indépendante de son signal carré", () => {
  const project = structuredClone(selectedProject);
  const waveform = {
    kind: "pulse",
    low: 0,
    high: 5,
    delay: 0,
    rise: 1e-6,
    fall: 1e-6,
    width: 0.001,
    period: 0.002,
  };
  project.components.push({
    id: "V1",
    kind: "voltage_source",
    label: "Horloge",
    value: 5,
    waveform,
    pins: { p: "V1.p", n: "V1.n" },
  });
  project.schematic.V1 = { x: 20, y: 20 };
  const copy = duplicateSelectionOperations(project, ["V1"]);
  const created = copy.operations[0];
  assert.deepEqual(created.waveform, waveform);
  assert.notStrictEqual(created.waveform, waveform);
  created.waveform.high = 3;
  assert.equal(waveform.high, 5);
});

test("la copie de fils internes conserve la couleur et translate les points de passage", () => {
  const project = structuredClone(selectedProject);
  project.wires[0].color = "#eac06c";
  project.wires[0].waypoints = [{ x: 150, y: 50 }];
  const copy = duplicateSelectionOperations(project, ["R1", "J1"], {
    x: 40,
    y: 20,
  });
  assert.deepEqual(
    copy.operations.find((op) => op.type === "set_wire_style"),
    {
      type: "set_wire_style",
      id: "W1_copy",
      color: "#eac06c",
      waypoints: [{ x: 190, y: 70 }],
    },
  );
  assert.deepEqual(project.wires[0].waypoints, [{ x: 150, y: 50 }]);
});

test("un collage réserve aussi les identifiants et bornes du projet destinataire", () => {
  const copy = duplicateSelectionOperations(
    selectedProject,
    ["R1", "C1", "J1"],
    { x: 0, y: 0 },
    ["R1_copy.p", "C1_copy", "J1_copy", "W1_copy"],
  );
  assert.deepEqual(copy.selected, [
    "R1_copy2",
    "C1_copy2",
    "J1_copy2",
    "W1_copy2",
    "W2_copy",
  ]);
  assert.deepEqual(
    copy.operations.find((op) => op.id === "W1_copy2"),
    {
      type: "connect",
      id: "W1_copy2",
      a: "R1_copy2.n",
      b: "J1_copy2",
    },
  );
});

test("déplacer ensemble les deux extrémités translate aussi le tracé manuel, une extrémité seule le conserve", () => {
  const project = structuredClone(selectedProject);
  project.wires[0].waypoints = [{ x: 150, y: 50 }];
  const group = moveSelectionOperations(project, ["R1", "J1"], 10, 20);
  assert.deepEqual(
    group.find((op) => op.type === "set_wire_style"),
    {
      type: "set_wire_style",
      id: project.wires[0].id,
      waypoints: [{ x: 160, y: 70 }],
    },
  );
  assert.equal(
    moveSelectionOperations(project, ["R1"], 10, 20).some(
      (op) => op.type === "set_wire_style",
    ),
    false,
  );
  assert.deepEqual(project.wires[0].waypoints, [{ x: 150, y: 50 }]);
});
