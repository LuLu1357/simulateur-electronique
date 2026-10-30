import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/schematicLabels.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { schematicLabels, schematicLabelBounds, schematicLabelFitPoints } = await import(
  "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
);
const kinds = ["resistor", "voltage_source", "capacitor", "inductor", "switch", "button",
  "diode", "led", "npn", "pnp", "potentiometer", "ground", "voltage_probe", "current_probe"];
function pins(kind, rotation) {
  const original = kind === "ground" ? [[0, -28]]
    : ["npn", "pnp"].includes(kind) ? [[32, -34], [-44, 0], [32, 34]]
      : kind === "potentiometer" ? [[-48, 0], [0, -48], [48, 0]] : [[-48, 0], [48, 0]];
  const a = rotation * Math.PI / 180;
  return original.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
}
function box(anchor, text, font) {
  const width = text.length * font * .7;
  return { left: anchor.x - (anchor.textAnchor === "middle" ? width / 2 : 0),
    right: anchor.x + (anchor.textAnchor === "middle" ? width / 2 : width), top: anchor.y - font, bottom: anchor.y + 4 };
}
test("les 14 symboles aux quatre rotations gardent les textes hors des cibles de bornes", () => {
  for (const kind of kinds) for (const rotation of [0, 90, 180, 270]) {
    const labels = schematicLabels(kind, rotation);
    const texts = kind === "ground" ? { name: "G1" } : { name: "V1", value: "5 V", current: "9.259 mA" };
    const boxes = Object.entries(texts).map(([key, text]) => box(labels[key], text,
      key === "name" ? 16 : key === "value" ? 14 : 12));
    for (const rect of boxes) for (const [x, y] of pins(kind, rotation)) {
      const dx = Math.max(rect.left - x, x - rect.right, 0), dy = Math.max(rect.top - y, y - rect.bottom, 0);
      assert.ok(Math.hypot(dx, dy) > 11, `${kind} ${rotation}° : une cible de borne recouvre un texte`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top,
        `${kind} ${rotation}° : nom, valeur et courant se superposent`);
    }
  }
});
test("une source ou résistance verticale place nom et valeur à côté, sans tourner le texte", () => {
  for (const kind of ["voltage_source", "resistor"]) for (const rotation of [90, 270, -90, 450]) {
    const layout = schematicLabels(kind, rotation);
    assert.equal(layout.value.textAnchor, "start");
    assert.ok(layout.value.x >= 40);
    assert.notEqual(layout.value.y, 47);
  }
});
test("la DEL, le potentiomètre et les BJT réservent une colonne distincte du courant", () => {
  for (const kind of ["led", "potentiometer", "npn", "pnp"]) {
    const layout = schematicLabels(kind);
    assert.ok(layout.name.x >= 62);
    assert.ok(layout.current.y - layout.value.y >= 22);
  }
});
test("le cadrage ajoute seulement les dépassements des libellés longs, sans bouger le composant", () => {
  const position = { x: 200, y: 300 }, before = structuredClone(position);
  const labels = schematicLabels("voltage_source", 90);
  const short = schematicLabelBounds(labels, { name: "V1", value: "5 V" });
  assert.deepEqual(schematicLabelFitPoints(position, short), [position, position]);
  const long = schematicLabelBounds(labels, { name: "V1", value: "0 V ↔ 5 V · 100 kHz · impulsion de test" });
  const points = schematicLabelFitPoints(position, long);
  assert.ok(points[1].x > position.x);
  assert.ok(points[1].x + 100 >= position.x + long.x + long.width);
  assert.deepEqual(position, before);
});
test("les géométries restent finies et les appels sont indépendants", () => {
  assert.deepEqual(schematicLabels("resistor", NaN), schematicLabels("resistor", 0));
  const first = schematicLabels("ground");
  first.name.x = 999;
  assert.equal(schematicLabels("ground").name.x, 34);
  for (const rotation of [0, 90, 180, 270]) for (const label of Object.values(schematicLabels("npn", rotation)))
    assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y));
});
