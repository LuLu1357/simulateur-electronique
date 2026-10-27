import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/sweep.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { sweepValues, sweepCsv } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);

test("les séries linéaires et logarithmiques conservent leurs bornes dans les deux sens", () => {
  assert.deepEqual(sweepValues(1000, 4000, 4), [1000, 2000, 3000, 4000]);
  assert.deepEqual(sweepValues(5, -5, 3), [5, 0, -5]);
  const logarithmic = sweepValues(10, 10000, 4, true);
  for (let i = 0; i < 4; i++)
    assert.ok(Math.abs(logarithmic[i] / 10 ** (i + 1) - 1) < 1e-12);
  assert.deepEqual(sweepValues(100, 1, 3, true), [100, 10, 1]);
});
test("les demandes dégénérées et non finies sont refusées, les limites sont bornées", () => {
  for (const count of [0, 1, 17, 2.5, NaN, Infinity])
    assert.equal(sweepValues(1, 2, count), null);
  for (const [a, b] of [
    [0, 0],
    [NaN, 2],
    [1, Infinity],
  ])
    assert.equal(sweepValues(a, b, 4), null);
  assert.equal(sweepValues(0, 10, 4, true), null);
  assert.equal(sweepValues(-1, 10, 4, true), null);
  const extreme = sweepValues(-Number.MAX_VALUE, Number.MAX_VALUE, 16);
  assert.equal(extreme.length, 16);
  assert.ok(extreme.every(Number.isFinite));
});
test("le CSV conserve des mesures signées et ne transforme pas les échecs en zéros", () => {
  const report = {
    rows: [
      { value: 1000, voltage: 5, current: -0.005, status: "success" },
      { value: 2000, voltage: null, current: null, status: "error" },
      {
        value: 3000,
        voltage: NaN,
        current: Infinity,
        status: 'erreur,"citée"',
      },
    ],
  };
  assert.equal(
    sweepCsv(report),
    'parameter_value_SI,voltage_V,current_A,status\r\n1000,5,-0.005,"success"\r\n2000,,,"error"\r\n3000,,,"erreur,""citée"""\r\n',
  );
});
