import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/clipboard.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { serializeCircuitFragment, parseCircuitFragment, fragmentPasteOffset } =
  await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.outputText).toString("base64")
  );
const catalog = Object.fromEntries(
  [
    ["resistor", ["p", "n"], []],
    ["capacitor", ["p", "n"], []],
    ["potentiometer", ["p", "w", "n"], []],
    ["voltage_source", ["p", "n"], []],
    ["led", ["a", "k"], ["generic_led_red", "generic_led_green"]],
    ["ground", ["g"], []],
  ].map(([kind, pins, models]) => [
    kind,
    {
      pins: pins.map((name) => ({ name })),
      models: models.map((id) => ({ id })),
    },
  ]),
);
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
const component = (id, kind, extra = {}) => ({
  id,
  kind,
  label: id,
  value: 1000,
  pins: Object.fromEntries(
    catalog[kind].pins.map(({ name }) => [name, `${id}.${name}`]),
  ),
  ...extra,
});
const project = {
  id: "private_project",
  title: "Titre privé",
  revision: 9,
  metadata: { secret: "must-never-copy" },
  components: [
    component("R1", "resistor"),
    component("C1", "capacitor", { value: 1e-6, initial_voltage: 1.25 }),
    component("RV1", "potentiometer", { value: 1e4, position: 0.2 }),
    component("V1", "voltage_source", { value: 5, waveform }),
    component("D1", "led", { value: 0, model: "generic_led_green" }),
    component("G1", "ground", { value: 0 }),
  ],
  schematic: Object.fromEntries(
    ["R1", "C1", "RV1", "V1", "D1", "G1"].map((id, i) => [
      id,
      { x: 100 + i * 100, y: 200, rotation: i % 2 ? 90 : 0 },
    ]),
  ),
  junctions: [{ id: "J1", x: 150, y: 150 }],
  wires: [
    {
      id: "W1",
      a: "R1.n",
      b: "J1",
      color: "#eac06c",
      waypoints: [{ x: 110, y: 120 }],
    },
    { id: "W2", a: "J1", b: "C1.p" },
    { id: "W3", a: "C1.n", b: "V1.p" },
  ],
  breadboard: { placements: { "R1.p": "a1", "R1.n": "a5" }, rail_splits: true },
  ui: { selected: [], annotations: [{ text: "observation privée" }] },
  simulation: { currents: { R1: 0.005 } },
};
const all = project.components.map((c) => c.id).concat("J1");
const fragment = () => JSON.parse(serializeCircuitFragment(project, all));
const read = (value) => parseCircuitFragment(JSON.stringify(value), catalog);

test("copier prend les objets sélectionnés et leurs seuls fils internes, sans données du projet", () => {
  const before = JSON.stringify(project);
  const text = serializeCircuitFragment(project, ["R1", "C1", "J1", "W3"]);
  const copy = read(JSON.parse(text));
  assert.deepEqual(
    copy.components.map((c) => c.id),
    ["R1", "C1"],
  );
  assert.deepEqual(
    copy.wires.map((w) => w.id),
    ["W1", "W2"],
  );
  assert.deepEqual(copy.wires[0].waypoints, [{ x: 110, y: 120 }]);
  assert.equal(copy.wires[0].color, "#eac06c");
  for (const field of [
    "metadata",
    "breadboard",
    "simulation",
    "ui",
    "title",
    "private_project",
    "must-never-copy",
  ])
    assert.equal(Object.hasOwn(JSON.parse(text), field), false, field);
  assert.equal(text.includes("must-never-copy"), false);
  assert.equal(JSON.stringify(project), before);
  assert.equal(serializeCircuitFragment(project, ["W1", "absent"]), null);
});

test("aller-retour conserve les réglages physiques, modèles, signal et rotation", () => {
  const copy = read(fragment());
  assert.equal(
    copy.components.find((c) => c.id === "C1").initial_voltage,
    1.25,
  );
  assert.equal(copy.components.find((c) => c.id === "RV1").position, 0.2);
  assert.equal(
    copy.components.find((c) => c.id === "D1").model,
    "generic_led_green",
  );
  assert.deepEqual(
    copy.components.find((c) => c.id === "V1").waveform,
    waveform,
  );
  assert.equal(copy.schematic.C1.rotation, 90);
  copy.components.find((c) => c.id === "V1").waveform.high = 3;
  assert.equal(waveform.high, 5);
});

test("texte ordinaire, projet JSON complet et format étranger restent au navigateur", () => {
  for (const text of [
    "",
    "Bonjour",
    "atelier.circuit-fragment est du texte",
    '{"x":',
    JSON.stringify(project),
    '{"format":"foreign","version":1}',
  ])
    assert.equal(parseCircuitFragment(text, catalog), null);
  assert.throws(
    () =>
      parseCircuitFragment('{"format":"atelier.circuit-fragment",', catalog),
    /invalides/,
  );
  assert.throws(() => read({ ...fragment(), version: 2 }), /version/);
});

test("le lecteur reconstruit uniquement les champs autorisés, sans accepter d’opérations", () => {
  const raw = fragment();
  raw.operations = [{ type: "remove_component", id: "R1" }];
  raw.metadata = { token: "secret" };
  raw.components[0].arbitrary = { execute: "do not run" };
  raw.components[0].pins.extra = "R1.extra";
  assert.throws(() => read(raw));
  delete raw.components[0].pins.extra;
  const copy = read(raw);
  assert.equal(copy.operations, undefined);
  assert.equal(copy.metadata, undefined);
  assert.equal(copy.components[0].arbitrary, undefined);
});

test("les identifiants, bornes canoniques et connexions internes sont contrôlés", () => {
  const mutations = [
    (p) => {
      p.components[1].id = "R1";
    },
    (p) => {
      p.junctions[0].id = "R1.p";
    },
    (p) => {
      p.wires[0].id = "C1.n";
    },
    (p) => {
      p.components[0].pins.p = "V1.p";
    },
    (p) => {
      p.components[0].id = "../escape";
    },
    (p) => {
      p.wires[0].b = "external.p";
    },
    (p) => {
      p.wires[0].b = p.wires[0].a;
    },
    (p) => {
      p.wires.push({ id: "W99", a: p.wires[0].b, b: p.wires[0].a });
    },
    (p) => {
      p.components[0].kind = "constructor";
    },
    (p) => {
      p.components[0].kind = "unknown";
    },
  ];
  for (const mutate of mutations) {
    const raw = fragment();
    mutate(raw);
    assert.throws(() => read(raw), /invalides|doublons/);
  }
});

test("valeurs non finies, rotation libre, modèle étranger et paramètres mal attribués sont rejetés", () => {
  const mutations = [
    (p) => {
      p.components[0].value = null;
    },
    (p) => {
      p.schematic.R1.rotation = 45;
    },
    (p) => {
      p.components[4].model = "generic_npn";
    },
    (p) => {
      p.components[0].position = 0.5;
    },
    (p) => {
      p.components[2].position = 1.5;
    },
    (p) => {
      p.components[0].initial_voltage = 2;
    },
    (p) => {
      p.components[0].waveform = waveform;
    },
    (p) => {
      p.components[3].waveform.period = 0.0001;
    },
    (p) => {
      p.wires[0].color = "url(https://invalid)";
    },
    (p) => {
      p.wires[0].waypoints[0].x = 1e7;
    },
  ];
  for (const mutate of mutations) {
    const raw = fragment();
    mutate(raw);
    assert.throws(() => read(raw), /invalides/);
  }
  assert.throws(
    () =>
      parseCircuitFragment(
        JSON.stringify(fragment()).replace('"value":1000', '"value":1e309'),
        catalog,
      ),
    /invalides/,
  );
});

test("les tailles limitent le coût en opérations et en octets avant tout collage", () => {
  const raw = fragment();
  raw.components = [];
  raw.schematic = {};
  raw.wires = [];
  raw.junctions = Array.from({ length: 499 }, (_, i) => ({
    id: `J${i}`,
    x: i,
    y: 0,
  }));
  assert.equal(read(raw).junctions.length, 499);
  raw.junctions.push({ id: "J999", x: 0, y: 0 });
  assert.throws(() => read(raw));
  const costly = fragment();
  costly.junctions.push(
    ...Array.from({ length: 498 }, (_, i) => ({
      id: `X${i}`,
      x: i,
      y: 0,
    })),
  );
  assert.throws(() => read(costly), /trop grande/);
  const tooLarge = { ...fragment(), padding: "é".repeat(600_000) };
  assert.throws(() => read(tooLarge));
});

test("un identifiant maximal du projet peut être copié même si sa borne a un suffixe", () => {
  const id = "R".repeat(80);
  const raw = {
    ...fragment(),
    components: [component(id, "resistor")],
    schematic: { [id]: { x: 100, y: 100 } },
    junctions: [],
    wires: [],
  };
  assert.equal(read(raw).components[0].id, id);
});

test("le collage centre la géométrie sans altérer l’instantané", () => {
  const copy = read(fragment());
  const before = JSON.stringify(copy);
  const offset = fragmentPasteOffset(copy, { x: 450, y: 180 });
  assert.deepEqual(offset, { x: 100, y: 5 });
  assert.equal(JSON.stringify(copy), before);
});
