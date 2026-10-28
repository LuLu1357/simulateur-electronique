import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/units.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { parseEngineeringValue } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);

test("les valeurs SI acceptent virgule française, exposant et unités explicites", () => {
  for (const [text, unit, value] of [
    ["4.7k", "Ω", 4700],
    ["4,7 kΩ", "Ω", 4700],
    ["4,7\u202fkΩ", "Ω", 4700],
    ["1 µF", "F", 1e-6],
    ["1 μF", "F", 1e-6],
    ["1uF", "F", 1e-6],
    ["10n", "F", 1e-8],
    ["10 mH", "H", 0.01],
    ["4,7 µH", "H", 4.7e-6],
    ["1 H", "H", 1],
    ["5 V", "V", 5],
    ["-5V", "V", -5],
    ["+2.5e-3 V", "V", 0.0025],
    [".5 V", "V", 0.5],
    ["1 Ohm", "Ω", 1],
    ["1 ohms", "Ω", 1],
    ["1 Ω", "Ω", 1],
    ["1000", "Ω", 1000],
    ["0", "", 0],
  ])
    assert.equal(parseEngineeringValue(text, unit), value, `${text} ${unit}`);
  assert.ok(Math.abs(parseEngineeringValue("100uH", "H") - 1e-4) < 1e-18);
});

test("milli et méga restent distincts ; aucune conversion vers une autre grandeur", () => {
  assert.equal(parseEngineeringValue("1mV", "V"), 0.001);
  assert.equal(parseEngineeringValue("1MV", "V"), 1e6);
  assert.equal(parseEngineeringValue("2kΩ", "F"), null);
  assert.equal(parseEngineeringValue("5 V", "Ω"), null);
  assert.equal(parseEngineeringValue("10 mF", "H"), null);
  assert.equal(parseEngineeringValue("10 mH", "F"), null);
  assert.equal(parseEngineeringValue("1 h", "H"), null);
  assert.equal(parseEngineeringValue("1m", ""), null);
  assert.equal(parseEngineeringValue("1 Ω", ""), null);
});

test("expressions, séparateurs ambigus et dépassements sont rejetés sans évaluation", () => {
  for (const input of [
    "",
    "  ",
    "1+2",
    "1/3",
    "Math.PI",
    "Infinity",
    "NaN",
    "1e999",
    "1e-999",
    "1,2.3",
    "1 000 Ω",
    "5 VV",
    "2 megaΩ",
    "1kkΩ",
    "0x10",
    "1;alert(1)",
    "2\n3",
    "1 kV F",
  ])
    assert.equal(parseEngineeringValue(input, "Ω"), null, input);
  assert.equal(parseEngineeringValue("0e-999", "V"), 0);
  assert.equal(parseEngineeringValue("1", "Hz"), null);
});
