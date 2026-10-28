import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const dataUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const typesUrl = dataUrl(
  compile(await readFile(new URL("../src/types.ts", import.meta.url), "utf8")),
);
const source = compile(
  await readFile(new URL("../src/circuitSearch.ts", import.meta.url), "utf8"),
).replace(/from ["']\.\/types["']/g, `from "${typesUrl}"`);
const { buildCircuitSearchIndex, searchCircuitTargets } = await import(
  dataUrl(source)
);

function fixture() {
  return {
    project: {
      id: "search",
      components: [
        {
          id: "R10",
          kind: "resistor",
          label: "R10",
          value: 1000,
          pins: { p: "R10.p", n: "R10.n" },
        },
        {
          id: "R1",
          kind: "resistor",
          label: "Réglage précis",
          value: 4700,
          pins: { p: "R1.p", n: "R1.n" },
        },
        {
          id: "Q1",
          kind: "npn",
          label: "Étage de sortie",
          value: 0,
          model: "generic_npn",
          pins: { c: "Q1.c", b: "Q1.b", e: "Q1.e" },
        },
        {
          id: "L1",
          kind: "inductor",
          label: "L1",
          value: 0.01,
          pins: { p: "L1.p", n: "L1.n" },
        },
      ],
      schematic: {
        R10: { x: 100, y: 100 },
        R1: { x: 300, y: 100, rotation: 90 },
        Q1: { x: 500, y: 200 },
        L1: { x: 700, y: 100 },
      },
      junctions: [{ id: "J1", x: 400, y: 100 }],
      wires: [
        { id: "W1", a: "R1.n", b: "J1", waypoints: [{ x: 350, y: 180 }] },
        { id: "W2", a: "J1", b: "Q1.b" },
      ],
      net_labels: { "R1.n": "Alimentation régulée", J1: "VCC" },
      breadboard: { placements: { "R1.p": "a1" }, rail_splits: true },
    },
    topology: {
      nets: [
        {
          id: "net_vcc",
          name: "Alimentation régulée",
          points: ["R1.n", "J1", "Q1.b"],
          holes: ["a1", "b1"],
        },
        { id: "R1", name: "Référence", points: ["R10.p"] },
        { id: "unused", name: "Bande vide", points: [], holes: ["c30"] },
      ],
      terminal_to_net: {
        "R1.n": "net_vcc",
        J1: "net_vcc",
        "Q1.b": "net_vcc",
        "R10.p": "R1",
      },
    },
    catalog: {
      resistor: { name: "Résistance", unit: "Ω", models: [] },
      npn: {
        name: "Transistor NPN",
        unit: "",
        models: [{ id: "generic_npn", label: "Bipolaire générique" }],
      },
      inductor: { name: "Inductance", unit: "H", models: [] },
    },
  };
}
const lookup = (index, key) => index.find((target) => target.key === key);

test("l’index sépare les identifiants de chaque type et prépare sélection ou surlignage", () => {
  const index = buildCircuitSearchIndex(fixture());
  const component = lookup(index, "component:R1"),
    net = lookup(index, "net:R1");
  assert.ok(component && net);
  assert.deepEqual(component.selected, ["R1"]);
  assert.deepEqual(component.highlights, []);
  assert.deepEqual(net.selected, []);
  assert.deepEqual(net.highlights, ["R1"]);
  assert.equal(component.label, "R1 · Réglage précis");
  assert.match(component.detail, /Résistance.*4\.7 kΩ/);
  assert.equal(lookup(index, "net:unused"), undefined);
  assert.equal(new Set(index.map((target) => target.key)).size, index.length);
});

test("recherche sans accents et tous mots, noms, modèles et valeurs SI", () => {
  const index = buildCircuitSearchIndex(fixture());
  for (const query of [
    "RESISTANCE REGLAGE",
    "précis résistance",
    "resistance 4700",
    "4,7kΩ",
    "R1 4.7 kohm",
  ])
    assert.deepEqual(
      searchCircuitTargets(index, query)
        .filter((target) => target.kind === "component")
        .map((target) => target.id),
      ["R1"],
    );
  assert.deepEqual(
    searchCircuitTargets(index, "bipolaire générique").map(
      (target) => target.id,
    ),
    ["Q1"],
  );
  assert.deepEqual(
    searchCircuitTargets(index, "bobine 10mH").map((target) => target.id),
    ["L1"],
  );
  assert.deepEqual(searchCircuitTargets(index, "R1 introuvable"), []);
});

test("l’identifiant exact précède ses préfixes et les références dans d’autres objets", () => {
  const index = buildCircuitSearchIndex(fixture());
  const found = searchCircuitTargets(index, "r1");
  assert.equal(found[0].key, "component:R1");
  assert.equal(found[1].key, "net:R1");
  assert.ok(
    found.findIndex((target) => target.id === "R10") <
      found.findIndex((target) => target.id === "W1"),
  );
});

test("les fils trouvent leurs bornes et noms de réseau, les réseaux tous leurs alias", () => {
  const index = buildCircuitSearchIndex(fixture());
  assert.deepEqual(
    searchCircuitTargets(index, "fil R1.n").map((target) => target.id),
    ["W1"],
  );
  assert.deepEqual(
    searchCircuitTargets(index, "câble VCC").map((target) => target.id),
    ["W1", "W2"],
  );
  const found = searchCircuitTargets(index, "reseau VCC regulee");
  assert.deepEqual(
    found.map((target) => target.id),
    ["net_vcc"],
  );
  assert.match(found[0].label, /Alimentation régulée/);
  assert.match(found[0].detail, /VCC/);
});

test("les géométries utilisent les bornes tournées et jonctions du schéma, jamais les trous", () => {
  const index = buildCircuitSearchIndex(fixture());
  const wire = lookup(index, "wire:W1");
  assert.equal(wire.points.length, 3);
  assert.ok(Math.abs(wire.points[0].x - 300) < 1e-10);
  assert.ok(Math.abs(wire.points[0].y - 148) < 1e-10);
  assert.deepEqual(wire.points[1], { x: 350, y: 180 });
  assert.deepEqual(wire.points[2], { x: 400, y: 100 });
  const net = lookup(index, "net:net_vcc");
  assert.equal(net.points.length, 3);
  assert.deepEqual(lookup(index, "component:R1").points, [{ x: 300, y: 100 }]);
  assert.deepEqual(lookup(index, "junction:J1").points, [{ x: 400, y: 100 }]);
});

test("positions absentes, non finies et bandes vides ne donnent pas de cadrage inventé", () => {
  const state = fixture();
  delete state.project.schematic.R1;
  state.project.schematic.Q1.x = Infinity;
  state.project.wires[0].waypoints[0].x = NaN;
  state.project.junctions[0].y = Infinity;
  state.topology.nets.push({
    id: "only_holes",
    points: ["a1", "b1"],
    holes: ["a1", "b1"],
  });
  const index = buildCircuitSearchIndex(state);
  assert.deepEqual(lookup(index, "component:R1").points, []);
  assert.deepEqual(lookup(index, "component:Q1").points, []);
  assert.deepEqual(lookup(index, "wire:W1").points, []);
  assert.deepEqual(lookup(index, "net:net_vcc").points, []);
  assert.equal(lookup(index, "net:only_holes"), undefined);
  assert.ok(lookup(index, "net:net_vcc")); // Un réseau logique sans position reste recherchable.
});

test("les résultats sont bornés sans tronquer l’index complet ni modifier son ordre", () => {
  const original = buildCircuitSearchIndex(fixture());
  const index = Array.from({ length: 85 }, (_, i) => ({
    ...original[0],
    key: `component:X${i}`,
    id: `X${i}`,
    label: `X${i}`,
    searchText: `x${i}`,
  }));
  const before = JSON.stringify(index);
  assert.equal(searchCircuitTargets(index, "").length, 60);
  assert.equal(searchCircuitTargets(index, "", 61).length, 61);
  assert.equal(searchCircuitTargets(index, "", 100).length, 85);
  assert.equal(searchCircuitTargets(index, "", 0).length, 0);
  assert.equal(searchCircuitTargets(index, "", -1).length, 0);
  assert.equal(searchCircuitTargets(index, "", Infinity).length, 60);
  assert.equal(searchCircuitTargets(index, "", 2.9).length, 2);
  assert.equal(JSON.stringify(index), before);
});

test("construire et utiliser l’index ne modifie pas le circuit, même si le résultat est manipulé", () => {
  const state = fixture(),
    before = JSON.stringify(state);
  const index = buildCircuitSearchIndex(state);
  searchCircuitTargets(index, "R1");
  lookup(index, "wire:W1").points[1].x = -100;
  lookup(index, "component:R1").selected.push("Q1");
  assert.equal(JSON.stringify(state), before);
  const empty = fixture();
  empty.project.components = [];
  empty.project.wires = [];
  empty.project.junctions = [];
  empty.topology.nets = [{ id: "unused", points: [], holes: ["a1"] }];
  assert.deepEqual(buildCircuitSearchIndex(empty), []);
});

test("les alias d’un grand réseau sont partagés entre les objets et restent tous recherchables", () => {
  const state = fixture();
  state.project.components = Array.from({ length: 300 }, (_, i) => ({
    id: `Q${i}`,
    kind: "npn",
    label: `Q${i}`,
    value: 0,
    pins: { c: `Q${i}.c`, b: `Q${i}.b`, e: `Q${i}.e` },
  }));
  state.project.schematic = Object.fromEntries(
    state.project.components.map((c, i) => [c.id, { x: i * 100, y: 100 }]),
  );
  state.project.junctions = Array.from({ length: 1000 }, (_, i) => ({
    id: `J${i}`,
    x: i * 10,
    y: 200,
  }));
  const members = [
    ...state.project.components.flatMap((c) => Object.values(c.pins)),
    ...state.project.junctions.map((j) => j.id),
  ];
  const alias = (i) =>
    (`Étiquette_${String(i).padStart(4, "0")}_` + "x".repeat(80)).slice(0, 80);
  state.project.net_labels = Object.fromEntries(
    members.map((id, i) => [id, alias(i)]),
  );
  state.project.wires = Array.from({ length: 1200 }, (_, i) => ({
    id: `W${i}`,
    a: members[i],
    b: members[i + 1],
  }));
  state.topology.nets = [
    { id: "net_big", name: "Grand réseau", points: members },
  ];
  state.topology.terminal_to_net = Object.fromEntries(
    members.map((id) => [id, "net_big"]),
  );
  const index = buildCircuitSearchIndex(state);
  const net = lookup(index, "net:net_big");
  const shared = net.relatedText[0];
  assert.ok(shared.length > 150_000);
  for (const target of index) {
    assert.equal(target.relatedText.length, 1);
    assert.equal(target.relatedText[0], shared);
    assert.equal(target.searchText.includes("etiquette_1899_"), false);
  }
  assert.ok(net.detail.length < 250);
  assert.ok(
    index.reduce((total, target) => total + target.searchText.length, 0) <
      shared.length * 10,
  );
  assert.equal(
    searchCircuitTargets(index, "etiquette_0000 etiquette_1899", 61).length,
    61,
  );
  assert.equal(
    searchCircuitTargets(index, "Q299 etiquette_0000", 1)[0].key,
    "component:Q299",
  );
  assert.deepEqual(
    searchCircuitTargets(index, "etiquette_1899 introuvable"),
    [],
  );
});
