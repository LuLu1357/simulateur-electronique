import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/scope.ts", import.meta.url),
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
  timeRange,
  nearestSampleIndex,
  curveRange,
  zoomTimeRange,
  scopeCsv,
  plotFraction,
  scopeDisplayCursor,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);

test("le curseur choisit un échantillon réel, avec priorité au premier à distance égale", () => {
  assert.equal(nearestSampleIndex([0, 0.1, 0.2, 0.7], 0.18), 2);
  assert.equal(nearestSampleIndex([0, 1, 2], 0.5), 0);
  assert.equal(nearestSampleIndex([0, 1, 2], -10), 0);
  assert.equal(nearestSampleIndex([0, 1, 2], 10), 2);
  assert.equal(nearestSampleIndex([0, 1, 2], 0, { start: 0.5, end: 2 }), 1);
  assert.equal(nearestSampleIndex([0, 1, 2], 0, { start: 4, end: 8 }), -1);
});
test("le curseur contrôlé conserve le point affiché même hors de la fenêtre zoomée", () => {
  const time = [0, 0.001, 0.004, 0.01];
  const zoom = { start: 0, end: 0.002 };
  assert.deepEqual(scopeDisplayCursor(time, 3, zoom, true), {
    index: 3,
    inView: false,
  });
  assert.deepEqual(scopeDisplayCursor(time, 1, zoom, true), {
    index: 1,
    inView: true,
  });
  // L’usage autonome garde son curseur dans la fenêtre observée.
  assert.deepEqual(scopeDisplayCursor(time, 3, zoom, false), {
    index: 1,
    inView: true,
  });
  assert.deepEqual(
    scopeDisplayCursor(time, 0, { start: 0.004, end: 0.01 }, true),
    {
      index: 0,
      inView: false,
    },
  );
  for (const index of [-1, 1.5, 4, NaN, Infinity])
    assert.deepEqual(scopeDisplayCursor(time, index, zoom, true), {
      index: -1,
      inView: false,
    });
  assert.deepEqual(scopeDisplayCursor(time, 0, null, true), {
    index: -1,
    inView: false,
  });
});
test("les temps invalides ne produisent pas de fausse mesure", () => {
  assert.equal(nearestSampleIndex([], 0), -1);
  assert.equal(nearestSampleIndex([NaN, null, "1", Infinity], 0), -1);
  assert.equal(nearestSampleIndex([0, NaN, 0.5], 0.4), 2);
  assert.equal(nearestSampleIndex([0, 1], NaN), -1);
  assert.deepEqual(timeRange([null, NaN, 4, 1, Infinity]), {
    start: 1,
    end: 4,
  });
  assert.equal(timeRange([]), null);
  assert.deepEqual(timeRange([0]), { start: 0, end: 0 });
});
test("chaque unité dispose de bornes finies limitées à la fenêtre temporelle", () => {
  const data = [
    { id: "V", label: "Sortie", unit: "V", values: [0, 2, -3, 50] },
  ];
  const range = curveRange(data, [0, 1, 2, 3], { start: 0, end: 2 });
  assert.ok(range.min < -3 && range.max > 2);
  assert.ok(range.max < 50);
  assert.deepEqual(
    curveRange([{ ...data[0], values: [NaN, 0, Infinity] }], [0, 1, 2], {
      start: 0,
      end: 2,
    }),
    { min: -1, max: 1 },
  );
  const many = Array.from({ length: 300000 }, (_, i) => i / 1000);
  assert.doesNotThrow(() =>
    curveRange([{ ...data[0], values: many }], many, { start: 0, end: 300 }),
  );
});

test("les coordonnées du graphe restent finies avec des valeurs extrêmes ou constantes", () => {
  assert.equal(plotFraction(0, -Number.MAX_VALUE, Number.MAX_VALUE), 0.5);
  assert.equal(
    plotFraction(Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE),
    1,
  );
  assert.equal(
    plotFraction(-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE),
    0,
  );
  assert.equal(plotFraction(2, 2, 2), 0.5);
  assert.equal(plotFraction(NaN, 0, 1), 0.5);
  assert.equal(plotFraction(-1, 0, 1), 0);
  assert.equal(plotFraction(2, 0, 1), 1);
});
test("le zoom reste dans les données et conserve la largeur près des bords", () => {
  const full = { start: 0, end: 10 };
  assert.deepEqual(zoomTimeRange(full, full, 5, 0.5), { start: 2.5, end: 7.5 });
  assert.deepEqual(zoomTimeRange(full, full, 0, 0.5), { start: 0, end: 5 });
  assert.deepEqual(zoomTimeRange(full, full, 10, 0.5), { start: 5, end: 10 });
  assert.deepEqual(zoomTimeRange(full, { start: 2, end: 8 }, 5, 2), full);
  for (const factor of [0, -1, NaN, Infinity])
    assert.deepEqual(zoomTimeRange(full, full, 5, factor), full);
  assert.deepEqual(
    zoomTimeRange({ start: 0, end: 0 }, { start: 0, end: 0 }, 0, 0.5),
    { start: 0, end: 0 },
  );
});
test("le CSV conserve tous les temps et les valeurs réelles, même hors fenêtre du curseur", () => {
  const csv = scopeCsv(
    [0, 0.00001, 0.00002],
    [
      { id: "V", label: "V(out)", unit: "V", values: [0, 1.23456789, 5] },
      { id: "I", label: "R1", unit: "A", values: [-0.005, -0.003, 0] },
    ],
  );
  assert.equal(
    csv,
    "temps [s],V(out) [V],R1 [A]\r\n0,0,-0.005\r\n0.00001,1.23456789,-0.003\r\n0.00002,5,0\r\n",
  );
});
test("le CSV échappe les libellés et laisse vides les valeurs absentes ou non finies", () => {
  const csv = scopeCsv(
    [0, NaN, 1],
    [
      {
        id: "x",
        label: 'une "sonde",\npositive',
        unit: "V",
        values: [Infinity, 2, 3],
      },
    ],
  );
  assert.equal(
    csv,
    'temps [s],"une ""sonde"",\npositive [V]"\r\n0,\r\n1,3\r\n',
  );
  assert.match(
    scopeCsv([0], [{ id: "x", label: "=1+1", unit: "V", values: [-2] }]),
    /\'=1\+1 \[V\]/,
  );
  assert.ok(
    scopeCsv(
      [0],
      [{ id: "x", label: "test", unit: "V", values: [-2] }],
    ).includes("0,-2"),
  );
});
