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
const moduleUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const boardUrl = moduleUrl(
  compile(
    await readFile(new URL("../src/breadboard.ts", import.meta.url), "utf8"),
  ),
);
const { pinLocation } = await import(
  moduleUrl(
    compile(
      await readFile(
        new URL("../src/breadboardLocations.ts", import.meta.url),
        "utf8",
      ),
    ).replace(/from ["']\.\/breadboard["']/g, `from "${boardUrl}"`),
  )
);

test("une borne sans implantation est explicitement non implantée, quelle que soit la plaque affichée", () => {
  for (const activeBoard of [1, 2, 4]) {
    assert.deepEqual(pinLocation({ "R1.p": "c5" }, "R1.n", activeBoard), {
      status: "unplaced",
      label: "Non implantée",
    });
  }
});

test("une borne de la plaque active indique son numéro même pour la première plaque sans préfixe", () => {
  assert.deepEqual(pinLocation({ "R1.p": "c5" }, "R1.p", 1), {
    status: "active",
    board: 1,
    hole: "c5",
    label: "Plaque 1 · c5",
  });
  assert.deepEqual(pinLocation({ "R1.p": "2:c5" }, "R1.p", 2), {
    status: "active",
    board: 2,
    hole: "c5",
    label: "Plaque 2 · c5",
  });
});

test("une borne sur une autre plaque conserve sa destination globale au lieu de devenir non implantée", () => {
  assert.deepEqual(pinLocation({ "R1.n": "a1" }, "R1.n", 2), {
    status: "other",
    board: 1,
    hole: "a1",
    label: "Plaque 1 · a1",
  });
  assert.deepEqual(pinLocation({ "R1.n": "2:h18" }, "R1.n", 1), {
    status: "other",
    board: 2,
    hole: "h18",
    label: "Plaque 2 · h18",
  });
});

test("les rails et la quatrième plaque gardent un numéro et un nom de trou non ambigus", () => {
  assert.deepEqual(pinLocation({ "V1.n": "4:rail_bottom_n30" }, "V1.n", 4), {
    status: "active",
    board: 4,
    hole: "rail_bottom_n30",
    label: "Plaque 4 · rail_bottom_n30",
  });
  assert.deepEqual(pinLocation({ "V1.p": "rail_top_p1" }, "V1.p", 4), {
    status: "other",
    board: 1,
    hole: "rail_top_p1",
    label: "Plaque 1 · rail_top_p1",
  });
});

test("consulter les mêmes implantations depuis plusieurs plaques ne change ni les trous, ni les fils, ni la sélection", () => {
  const project = {
    components: [
      { id: "R1", kind: "resistor", pins: { p: "R1.p", n: "R1.n" } },
    ],
    wires: [{ id: "W1", a: "R1.p", b: "V1.p" }],
    breadboard: {
      board_count: 4,
      placements: { "R1.p": "2:c5", "R1.n": "2:c8", "V1.p": "rail_top_p1" },
    },
    ui: { selected: ["R1"], highlights: ["W1"] },
  };
  const before = structuredClone(project);
  Object.freeze(project.breadboard.placements);

  const locations = [1, 2, 4, 1].map((board) =>
    pinLocation(project.breadboard.placements, "R1.p", board),
  );
  assert.deepEqual(
    locations.map((location) => location.status),
    ["other", "active", "other", "other"],
  );
  assert.ok(locations.every((location) => location.label === "Plaque 2 · c5"));
  assert.deepEqual(project, before);
});
