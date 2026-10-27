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
    strict: true,
  },
});
const {
  boardHolePoint,
  snapBoardHole,
  parseBoardHole,
  boardGroup,
  translateFootprint,
  defaultFootprint,
  rotateFootprint,
  rigidJumperPath,
  placeBoardPin,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);
function project() {
  return {
    components: [
      { id: "R1", kind: "resistor", pins: { p: "R1.p", n: "R1.n" } },
      { id: "Q1", kind: "npn", pins: { c: "Q1.c", b: "Q1.b", e: "Q1.e" } },
    ],
    junctions: [],
    wires: [{ id: "W1", a: "R1.p", b: "Q1.c" }],
    breadboard: {
      rail_splits: true,
      placements: {
        "R1.p": "c5",
        "R1.n": "c8",
        "Q1.c": "h15",
        "Q1.b": "h16",
        "Q1.e": "h17",
      },
    },
  };
}
test("420 trous valides, limites strictes et aimantation au plus proche", () => {
  assert.deepEqual(parseBoardHole("c5"), { row: "c", column: 5 });
  for (const id of ["a0", "a31", "a01", "k1", "rail_top_p31"])
    assert.equal(boardHolePoint(id), null);
  const p = boardHolePoint("c5");
  assert.equal(snapBoardHole(p[0] + 2, p[1] - 3), "c5");
  assert.equal(snapBoardHole(-100, -100), null);
  assert.equal(snapBoardHole(NaN, 0), null);
});
test("bandes5trous, deuxcôtésdistincts et coupure15 respectés", () => {
  assert.equal(boardGroup("a5"), boardGroup("e5"));
  assert.notEqual(boardGroup("e5"), boardGroup("f5"));
  assert.notEqual(boardGroup("rail_top_p15"), boardGroup("rail_top_p16"));
  assert.equal(
    boardGroup("rail_top_p15", false),
    boardGroup("rail_top_p16", false),
  );
});
test("translation rigide du corps garde lesécarts et lesfils", () => {
  const p = project(),
    before = structuredClone(p);
  const proposal = translateFootprint(p, "R1", "h6");
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.placements, { "R1.p": "h6", "R1.n": "h9" });
  assert.deepEqual(p, before);
  assert.deepEqual(
    proposal.operations.slice(0, 2).map((o) => o.hole),
    [null, null],
  );
  assert.equal(proposal.operations.length, 4);
});
test("translation3pattes libère toutes lesanciennespattesavantreplacer", () => {
  const p = project(),
    proposal = translateFootprint(p, "Q1", "h16");
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.placements, {
    "Q1.c": "h16",
    "Q1.b": "h17",
    "Q1.e": "h18",
  });
  assert.deepEqual(
    proposal.operations.slice(0, 3).map((o) => o.hole),
    [null, null, null],
  );
});
test("collision etsortieplaque refusées sansopérationpartielle", () => {
  const p = project();
  for (const proposal of [
    translateFootprint(p, "R1", "h15"),
    translateFootprint(p, "R1", "c29"),
  ]) {
    assert.equal(proposal.ok, false);
    assert.deepEqual(proposal.operations, []);
  }
});
test("déplacerune patte ne déplace pasles autres", () => {
  const p = project(),
    proposal = placeBoardPin(p, "R1.p", "a9");
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.placements, { "R1.p": "a9" });
  assert.equal(placeBoardPin(p, "X1.p", "a9").ok, false);
});
test("empreintepassive/BJT explicite sanscourt-circuitinterne", () => {
  const p = project();
  for (const [id, hole, count] of [
    ["R1", "c10", 2],
    ["Q1", "c20", 3],
  ]) {
    const proposal = defaultFootprint(p, id, hole);
    assert.equal(proposal.ok, true);
    assert.equal(
      new Set(Object.values(proposal.placements).map((h) => boardGroup(h)))
        .size,
      count,
    );
  }
  assert.equal(defaultFootprint(p, "R1", "rail_top_p5").ok, false);
});
test("rotation90possibleàchevalsurlesdeuxbanques,sansfusionnerbornes", () => {
  const p = project();
  p.breadboard.placements["R1.p"] = "e5";
  p.breadboard.placements["R1.n"] = "e8";
  const proposal = rotateFootprint(p, "R1");
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.placements, { "R1.p": "e5", "R1.n": "f5" });
  p.breadboard.placements["R1.p"] = "a5";
  p.breadboard.placements["R1.n"] = "a8";
  assert.equal(rotateFootprint(p, "R1").ok, false);
});
test("cavaliers rigides composésuniquementdedroitesorthogonales", () => {
  for (const [a, b] of [
    [
      [10, 20],
      [100, 20],
    ],
    [
      [10, 20],
      [10, 200],
    ],
    [
      [10, 20],
      [100, 200],
    ],
  ]) {
    const path = rigidJumperPath(a, b);
    assert.match(path, /^M/);
    assert.doesNotMatch(path, /[QqCcSsAa]/);
    assert.match(path, /[HV]/);
  }
});

test("lescorpsnepeuventpas sechevauchermêmesilestroussontdistincts", () => {
  const p = project();
  p.components.push({
    id: "R2",
    kind: "resistor",
    pins: { p: "R2.p", n: "R2.n" },
  });
  const proposal = defaultFootprint(p, "R2", "c6");
  assert.equal(proposal.ok, false);
  assert.match(proposal.message, /recouvrirait R1/);
});
test("lesbornespartiellementimplantéesnepeuventpasêtretranslatéescommecorpsrigide", () => {
  const p = project();
  delete p.breadboard.placements["R1.n"];
  assert.equal(translateFootprint(p, "R1", "h6").ok, false);
  assert.equal(defaultFootprint(p, "R1", "h6").ok, true);
});
