import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/boardLabels.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { layoutBoardLabels, boardLabelExcerpt, boardHoleCaption } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const overlap = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test("V1/R1/G1 sur les rails voisins reçoivent des repères distincts, hors des trous", () => {
  const circuit = {
    placements: {
      "V1.p": "rail_top_p1",
      "V1.n": "rail_top_n1",
      "R1.p": "rail_top_p2",
      "R1.n": "rail_top_n2",
      "G1.g": "rail_top_n3",
    },
    candidates: [
      { id: "V1", x: 92, y: 15, width: 110, callout: true },
      { id: "R1", x: 118, y: 15, width: 105, callout: true },
      { id: "G1", x: 144, y: 41, width: 140, callout: true },
    ],
  };
  const before = structuredClone(circuit);
  const result = layoutBoardLabels(circuit.candidates);
  const labels = Array.from(result.labels.values());
  assert.equal(labels.length, 3);
  for (const label of labels) {
    assert.equal(label.mode, "callout");
    assert.ok(label.y + label.height < 0);
    assert.ok(label.x >= 0 && label.x + label.width <= 940);
    assert.ok(label.y >= -result.headerHeight);
  }
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.equal(overlap(labels[i], labels[j]), false);
  assert.deepEqual(
    circuit,
    before,
    "Les emplacements physiques restent strictement inchangés.",
  );
});

test("les composants espacés gardent leur légende près du corps sans bandeau supplémentaire", () => {
  const result = layoutBoardLabels([
    { id: "R1", x: 131, y: 145, width: 90 },
    { id: "C1", x: 261, y: 145, width: 90 },
    { id: "R2", x: 391, y: 327, width: 90 },
  ]);
  assert.equal(result.headerHeight, 0);
  assert.ok(
    Array.from(result.labels.values()).every(
      (label) => label.mode === "inline",
    ),
  );
  assert.equal(result.labels.get("C1").x, 261);
  assert.equal(result.labels.get("C1").y, 145);
});

test("une collision de textes est résolue quel que soit l'ordre des composants", () => {
  const items = [
    { id: "R1", x: 200, y: 145, width: 110 },
    { id: "R2", x: 220, y: 145, width: 110 },
  ];
  const first = layoutBoardLabels(items),
    second = layoutBoardLabels(items.toReversed());
  for (const id of ["R1", "R2"])
    assert.deepEqual(first.labels.get(id), second.labels.get(id));
  assert.equal(first.labels.get("R1").mode, "callout");
  assert.equal(overlap(first.labels.get("R1"), first.labels.get("R2")), false);
});

test("les cartouches reviennent à la ligne sans collision ni rognage du viewBox", () => {
  const result = layoutBoardLabels(
    Array.from({ length: 18 }, (_, i) => ({
      id: `V${i}`,
      x: 92 + i * 26,
      y: 15,
      width: 130,
      callout: true,
    })),
  );
  const labels = Array.from(result.labels.values());
  assert.ok(new Set(labels.map((label) => label.y)).size > 1);
  for (let i = 0; i < labels.length; i++) {
    assert.ok(
      labels[i].y >= -result.headerHeight && labels[i].y + labels[i].height < 0,
    );
    assert.ok(labels[i].x + labels[i].width <= 940);
    for (let j = i + 1; j < labels.length; j++)
      assert.equal(overlap(labels[i], labels[j]), false);
  }
});

test("un libellé dépassant le bord est déplacé et toute abréviation reste indiquée", () => {
  assert.equal(
    layoutBoardLabels([{ id: "V1", x: 40, y: 140, width: 180 }]).labels.get(
      "V1",
    ).mode,
    "callout",
  );
  assert.equal(
    boardLabelExcerpt("Résistance de limitation", 12),
    "Résistance …",
  );
  assert.equal(boardLabelExcerpt("5 V", 12), "5 V");
  assert.equal(boardLabelExcerpt("🔋 Source", 4), "🔋 S…");
});

test("les repères de trous distinguent polarité, haut et bas, sur chaque plaque", () => {
  assert.equal(boardHoleCaption("rail_top_p1"), "haut +1");
  assert.equal(boardHoleCaption("2:rail_top_n3"), "haut −3");
  assert.equal(boardHoleCaption("rail_bottom_p15"), "bas +15");
  assert.equal(boardHoleCaption("4:rail_bottom_n20"), "bas −20");
  assert.equal(boardHoleCaption("2:c6"), "c6");
});
