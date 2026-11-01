import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = ts.transpileModule(
  await readFile(
    new URL("../src/measurementChannels.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const {
  filterMeasurementChannels,
  initialMeasurementSelection,
  reconcileMeasurementSelection,
} = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

function curve(id, label, unit, values = [1, 2]) {
  return { id, label, unit, values };
}
function fixture() {
  return [
    curve("net_32", "Référence régulée", "V"),
    curve("I:R1", "I(R1)", "A"),
    curve("I:Q1.b", "Courant de base Q1", "A"),
    curve("net_93", "Étage de sortie", "V"),
    curve("diagnostic", "Mesure particulière", "Ω"),
  ];
}

test("la recherche retrouve identifiant, libellé et référence réellement fournie", () => {
  const curves = fixture();
  assert.deepEqual(filterMeasurementChannels(curves, "net_32"), [curves[0]]);
  assert.deepEqual(filterMeasurementChannels(curves, "référence"), [curves[0]]);
  assert.deepEqual(filterMeasurementChannels(curves, "R1"), [curves[1]]);
  assert.deepEqual(filterMeasurementChannels(curves, "I:Q1.b"), [curves[2]]);
  assert.deepEqual(filterMeasurementChannels(curves, "Q2"), []);
});

test("accents, casse et espaces ne gênent pas une recherche à plusieurs termes", () => {
  const curves = fixture();
  for (const query of ["  REFERENCE   REGULEE ", "réFÉrence\tRÉGULÉE"])
    assert.deepEqual(filterMeasurementChannels(curves, query), [curves[0]]);
  assert.deepEqual(filterMeasurementChannels(curves, "q1 BASE"), [curves[2]]);
  assert.deepEqual(filterMeasurementChannels(curves, "étage net_93"), [
    curves[3],
  ]);
  assert.deepEqual(filterMeasurementChannels(curves, "reference sortie"), []);
});

test("les mots d'unité français retrouvent les mesures sans inventer de métadonnées", () => {
  const curves = fixture();
  for (const query of ["volt", "VOLTS", "tension", "tensions"])
    assert.deepEqual(filterMeasurementChannels(curves, query), [
      curves[0],
      curves[3],
    ]);
  for (const query of ["ampère", "AMPERES", "courants"])
    assert.deepEqual(filterMeasurementChannels(curves, query), [
      curves[1],
      curves[2],
    ]);
  assert.deepEqual(filterMeasurementChannels(curves, "Ω"), [curves[4]]);
  assert.deepEqual(filterMeasurementChannels(curves, "V", "voltage"), [
    curves[0],
    curves[3],
  ]);
  assert.deepEqual(filterMeasurementChannels(curves, "A", "current"), [
    curves[1],
    curves[2],
  ]);
  // net_32 ne contient aucune relation permettant de l'associer à R1.
  assert.deepEqual(filterMeasurementChannels(curves, "R1", "voltage"), []);
});

test("les filtres V/A se combinent à la recherche et Tous garde les autres unités", () => {
  const curves = fixture();
  assert.deepEqual(filterMeasurementChannels(curves, "", "voltage"), [
    curves[0],
    curves[3],
  ]);
  assert.deepEqual(filterMeasurementChannels(curves, "", "current"), [
    curves[1],
    curves[2],
  ]);
  assert.deepEqual(filterMeasurementChannels(curves, "Q1", "current"), [
    curves[2],
  ]);
  assert.deepEqual(filterMeasurementChannels(curves, "Q1", "voltage"), []);
  assert.deepEqual(filterMeasurementChannels(curves, "   ", "all"), curves);
});

test("aucune courbe n'est masquée par un plafond, même avec 270 canaux", () => {
  const curves = Array.from({ length: 270 }, (_, index) =>
    curve(`I:Q${index}.b`, `I(Q${index}.b)`, "A"),
  );
  const all = filterMeasurementChannels(curves, "", "all");
  assert.equal(all.length, 270);
  assert.deepEqual(all, curves);
  assert.ok(all.every((entry, index) => entry === curves[index]));
  assert.deepEqual(filterMeasurementChannels(curves, "I:Q269.b"), [
    curves[269],
  ]);
});

test("un libellé long reste intégralement consultable et recherchable jusqu'à la fin", () => {
  const long = curve("net_long", "Étage ".repeat(500) + "Sortie_unique", "V");
  assert.deepEqual(filterMeasurementChannels([long], "SORTIE_UNIQUE"), [long]);
  assert.deepEqual(filterMeasurementChannels([long], "sortie_unique étage"), [
    long,
  ]);
  assert.equal(filterMeasurementChannels([long], "introuvable").length, 0);
});

test("les entrées vides et la recherche sans résultat sont explicites", () => {
  assert.deepEqual(filterMeasurementChannels([], "Q1", "all"), []);
  assert.deepEqual(filterMeasurementChannels(fixture(), "introuvable"), []);
  assert.deepEqual(initialMeasurementSelection([]), []);
  assert.deepEqual(reconcileMeasurementSelection(["absent"], []), []);
});

test("seul le premier affichage propose trois tensions, ou trois mesures sans tension", () => {
  const curves = [
    curve("I:R1", "I(R1)", "A"),
    ...Array.from({ length: 4 }, (_, index) =>
      curve(`net_${index}`, `V(net_${index})`, "V"),
    ),
  ];
  assert.deepEqual(initialMeasurementSelection(curves), [
    "net_0",
    "net_1",
    "net_2",
  ]);
  const currents = Array.from({ length: 4 }, (_, index) =>
    curve(`I:R${index}`, `I(R${index})`, "A"),
  );
  assert.deepEqual(initialMeasurementSelection(currents), [
    "I:R0",
    "I:R1",
    "I:R2",
  ]);
});

test("un résultat compatible conserve les choix dans leur ordre, sans imposer l'ordre des nouvelles courbes", () => {
  const curves = fixture();
  const choices = ["I:Q1.b", "net_32"];
  assert.deepEqual(
    reconcileMeasurementSelection(choices, curves.toReversed()),
    ["I:Q1.b", "net_32"],
  );
  assert.deepEqual(
    reconcileMeasurementSelection(["I:R1", "I:R1", "net_32"], curves),
    ["I:R1", "net_32"],
  );
});

test("disparition et désélection totale n'ajoutent jamais une autre mesure silencieusement", () => {
  const curves = fixture();
  assert.deepEqual(
    reconcileMeasurementSelection(["I:absent", "I:R1"], curves),
    ["I:R1"],
  );
  assert.deepEqual(reconcileMeasurementSelection(["I:absent"], curves), []);
  assert.deepEqual(reconcileMeasurementSelection([], curves), []);
});

test("filtrer et réconcilier ne modifient ni les objets source ni les valeurs indisponibles", () => {
  const values = [NaN, undefined, null, Infinity, -0];
  const curves = fixture();
  curves.push(curve("I:missing", "Mesure incomplète", "A", values));
  const before = structuredClone(curves);
  for (const entry of curves) {
    Object.freeze(entry.values);
    Object.freeze(entry);
  }
  Object.freeze(curves);
  const result = filterMeasurementChannels(curves, "missing", "current");
  assert.equal(result[0], curves.at(-1));
  assert.equal(result[0].values, values);
  reconcileMeasurementSelection(["I:missing"], curves);
  initialMeasurementSelection(curves);
  assert.deepEqual(curves, before);
  assert.ok(Number.isNaN(result[0].values[0]));
  assert.equal(result[0].values[1], undefined);
  assert.equal(result[0].values[2], null);
});
