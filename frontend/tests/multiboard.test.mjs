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
const url = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const helpers = await import(
  url(
    compile(
      await readFile(new URL("../src/breadboard.ts", import.meta.url), "utf8"),
    ),
  )
);
const typesUrl = url(
  compile(await readFile(new URL("../src/types.ts", import.meta.url), "utf8")),
);
const { boardLinks } = await import(
  url(
    compile(
      await readFile(
        new URL("../src/connectivity.ts", import.meta.url),
        "utf8",
      ),
    ).replace(/from ["']\.\/types["']/g, `from "${typesUrl}"`),
  )
);
const {
  parseBoardHole,
  boardHolePoint,
  boardGroup,
  boardNumber,
  boardHolesOnBoard,
  defaultFootprint,
  translateFootprint,
  rotateFootprint,
  placeBoardPin,
  adjacentBoardHole,
} = helpers;
function project() {
  return {
    components: [
      { id: "R1", kind: "resistor", pins: { p: "R1.p", n: "R1.n" } },
      { id: "R2", kind: "resistor", pins: { p: "R2.p", n: "R2.n" } },
    ],
    junctions: [],
    wires: [],
    breadboard: {
      board_count: 2,
      rail_splits: true,
      placements: {
        "R1.p": "c5",
        "R1.n": "c8",
        "R2.p": "2:c5",
        "R2.n": "2:c8",
      },
    },
  };
}

test("les noms sont canoniques, les coordonnées sont locales et les bandes restent séparées", () => {
  assert.deepEqual(parseBoardHole("a1"), { row: "a", column: 1 });
  assert.deepEqual(parseBoardHole("2:c5"), { row: "c", column: 5, board: 2 });
  for (const bad of ["1:a1", "0:a1", "5:a1", "02:a1", "2:a01"])
    assert.equal(parseBoardHole(bad), null);
  assert.deepEqual(boardHolePoint("2:c5"), boardHolePoint("c5"));
  assert.equal(boardNumber("4:a1"), 4);
  assert.equal(boardHolesOnBoard(2).length, 420);
  assert.equal(new Set(boardHolesOnBoard(2)).size, 420);
  assert.equal(boardGroup("2:a5"), boardGroup("2:e5"));
  assert.notEqual(boardGroup("a5"), boardGroup("2:a5"));
  assert.equal(adjacentBoardHole("2:c5", 1, 1), "2:d6");
});
test("un corps présent sur une autre plaque ne crée pas de fausse collision", () => {
  const p = project();
  const result = defaultFootprint(p, "R1", "2:h15");
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.placements, { "R1.p": "2:h15", "R1.n": "2:h18" });
  assert.equal(
    defaultFootprint(p, "R1", "2:c5").ok,
    false,
    "vraie collision sur la même plaque",
  );
  const one = structuredClone(p);
  one.components = one.components.filter((c) => c.id !== "R2");
  delete one.breadboard.placements["R2.p"];
  delete one.breadboard.placements["R2.n"];
  assert.equal(
    defaultFootprint(one, "R1", "2:c5").ok,
    true,
    "mêmes coordonnées locales autorisées sur une autre plaque",
  );
});
test("une patte ne peut pas laisser un composant physique entre deux plaques", () => {
  const p = project(),
    before = structuredClone(p);
  const result = placeBoardPin(p, "R1.p", "2:a10");
  assert.equal(result.ok, false);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(p, before);
});
test("translation et rotation conservent la plaque cible et toutes les pattes", () => {
  const p = project();
  const shifted = translateFootprint(p, "R1", "2:h15");
  assert.equal(shifted.ok, true, shifted.message);
  assert.deepEqual(shifted.placements, { "R1.p": "2:h15", "R1.n": "2:h18" });
  const rotated = rotateFootprint(p, "R2", 2);
  assert.equal(rotated.ok, true, rotated.message);
  assert.ok(
    Object.values(rotated.placements).every((hole) => hole.startsWith("2:")),
  );
});
test("les continuités schématiques implicites respectent les préfixes de plaques", () => {
  const p = project();
  p.breadboard.placements = {
    "R1.p": "a1",
    "R1.n": "2:a1",
    "R2.p": "e1",
    "R2.n": "2:e1",
  };
  const links = boardLinks(p);
  assert.equal(links.length, 2);
  assert.ok(links.some((link) => link.a === "R1.p" && link.b === "R2.p"));
  assert.ok(
    links.some(
      (link) =>
        link.a === "R1.n" && link.b === "R2.n" && link.group === "2:AE1",
    ),
  );
});
test("un placement sur une plaque non créée est refusé", () => {
  const p = project();
  p.breadboard.board_count = 1;
  assert.equal(defaultFootprint(p, "R1", "2:h15").ok, false);
});
