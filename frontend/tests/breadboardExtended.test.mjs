import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../src/breadboard.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const {
  orderedPins,
  defaultFootprint,
  insertionFootprint,
  boardGroup,
  translateFootprint,
  ledVisualState,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
const led = { id: "L1", kind: "led", pins: { a: "L1.a", k: "L1.k" } };
const pot = {
  id: "POT1",
  kind: "potentiometer",
  pins: { p: "POT1.p", w: "POT1.w", n: "POT1.n" },
};
const empty = () => ({
  components: [],
  junctions: [],
  wires: [],
  breadboard: { placements: {}, rail_splits: true },
});

test("LED and potentiometer footprints retain every electrical terminal in defined order", () => {
  assert.deepEqual(
    orderedPins(led).map(([name]) => name),
    ["a", "k"],
  );
  assert.deepEqual(
    orderedPins(pot).map(([name]) => name),
    ["p", "w", "n"],
  );
  for (const component of [led, pot]) {
    const project = { ...empty(), components: [component] };
    const proposal = defaultFootprint(project, component.id, "c10");
    assert.equal(proposal.ok, true, proposal.message);
    assert.equal(
      Object.keys(proposal.placements).length,
      Object.keys(component.pins).length,
    );
    assert.equal(
      new Set(
        Object.values(proposal.placements).map((hole) => boardGroup(hole)),
      ).size,
      Object.keys(component.pins).length,
    );
  }
});

test("palette insertion validates the whole footprint without mutating the active project", () => {
  const project = empty();
  const before = structuredClone(project);
  const proposal = insertionFootprint(project, pot, "h10");
  assert.equal(proposal.ok, true, proposal.message);
  assert.deepEqual(proposal.placements, {
    "POT1.p": "h10",
    "POT1.w": "h11",
    "POT1.n": "h12",
  });
  assert.deepEqual(project, before);
  assert.equal(insertionFootprint(project, pot, "c29").ok, false);
  assert.equal(
    insertionFootprint({ ...project, components: [pot] }, pot, "h10").ok,
    false,
  );
});

test("a collision on the wiper or final potentiometer terminal rejects all placement operations", () => {
  const project = empty();
  project.components = [pot, { id: "G1", kind: "ground", pins: { g: "G1.g" } }];
  for (const hole of ["c11", "c12"]) {
    project.breadboard.placements = { "G1.g": hole };
    const proposal = defaultFootprint(project, pot.id, "c10");
    assert.equal(proposal.ok, false);
    assert.deepEqual(proposal.operations, []);
  }
});

test("moving the potentiometer preserves all three pin offsets and frees old holes first", () => {
  const project = { ...empty(), components: [pot] };
  project.breadboard.placements = {
    "POT1.p": "h10",
    "POT1.w": "h11",
    "POT1.n": "h12",
  };
  const proposal = translateFootprint(project, pot.id, "h11");
  assert.equal(proposal.ok, true, proposal.message);
  assert.deepEqual(proposal.placements, {
    "POT1.p": "h11",
    "POT1.w": "h12",
    "POT1.n": "h13",
  });
  assert.deepEqual(
    proposal.operations.slice(0, 3).map((operation) => operation.hole),
    [null, null, null],
  );
});

test("LED light never guesses missing or stale currents and reverse current stays dark", () => {
  for (const current of [undefined, null, NaN, Infinity, -Infinity, "0.01"])
    assert.deepEqual(ledVisualState(current), {
      state: "unknown",
      intensity: 0,
    });
  assert.deepEqual(ledVisualState(0.01, true), {
    state: "unknown",
    intensity: 0,
  });
  for (const current of [-10, -0.01, 0, 1e-7, 1e-6])
    assert.deepEqual(ledVisualState(current), { state: "off", intensity: 0 });
});

test("LED current threshold and symbolic brightness are finite, bounded and monotonic", () => {
  let previous = 0;
  for (const current of [1e-5, 1e-3, 0.005, 0.02, 0.021, Number.MAX_VALUE]) {
    const result = ledVisualState(current);
    assert.ok(
      Number.isFinite(result.intensity) &&
        result.intensity >= previous &&
        result.intensity <= 1,
    );
    assert.equal(result.state, current > 0.02 ? "overcurrent" : "on");
    previous = result.intensity;
  }
  assert.equal(ledVisualState(0.02).intensity, 1);
});
