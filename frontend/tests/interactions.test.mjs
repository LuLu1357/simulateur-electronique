import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/interactions.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
});
const { handleEditorKey, requestSimulationStop } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputText).toString("base64")
);

function element(tagName, parentElement = null, attributes = {}) {
  return {
    tagName,
    parentElement,
    getAttribute: (name) => attributes[name] ?? null,
  };
}
function keyEvent(key, options = {}) {
  return {
    key,
    target: element("DIV"),
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...options,
  };
}
function editor(helpOpen = false) {
  const effects = [];
  return {
    effects,
    actions: {
      helpOpen,
      closeHelp: () => effects.push("close-help"),
      cancelWiring: () => effects.push("cancel-wiring"),
      removeSelection: () => effects.push("remove-selection"),
      history: (action) => effects.push(action),
      selectTool: (tool) => effects.push(`tool:${tool}`),
    },
  };
}

test("le guide ouvert bloque suppression, historique et changement d’outil", () => {
  const blocked = [
    keyEvent("Delete"),
    keyEvent("Backspace"),
    keyEvent("z", { metaKey: true }),
    keyEvent("z", { ctrlKey: true }),
    keyEvent("Z", { metaKey: true, shiftKey: true }),
    keyEvent("Z", { ctrlKey: true, shiftKey: true }),
    keyEvent("v"),
    keyEvent("w"),
  ];
  for (const event of blocked) {
    const { effects, actions } = editor(true);
    assert.equal(handleEditorKey(event, actions), true);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(
      effects,
      [],
      `aucun changement derrière le guide pour ${event.key}`,
    );
  }
});

test("Échap ferme seulement le guide, sans annuler le fil ou changer l’outil", () => {
  const { effects, actions } = editor(true);
  const event = keyEvent("Escape");
  assert.equal(handleEditorKey(event, actions), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(effects, ["close-help"]);
});

test("sans guide, Échap annule le câblage et la suppression reste disponible", () => {
  const { effects, actions } = editor(false);
  handleEditorKey(keyEvent("Escape"), actions);
  handleEditorKey(keyEvent("Delete"), actions);
  handleEditorKey(keyEvent("Backspace"), actions);
  handleEditorKey(keyEvent("v"), actions);
  handleEditorKey(keyEvent("w"), actions);
  assert.deepEqual(effects, [
    "cancel-wiring",
    "remove-selection",
    "remove-selection",
    "tool:select",
    "tool:wire",
  ]);
});

test("Maj+CmdZ et Maj+CtrlZ rétablissent même avec une lettre Z majuscule", () => {
  const { effects, actions } = editor();
  handleEditorKey(keyEvent("z", { metaKey: true }), actions);
  handleEditorKey(keyEvent("z", { ctrlKey: true }), actions);
  handleEditorKey(keyEvent("Z", { metaKey: true, shiftKey: true }), actions);
  handleEditorKey(keyEvent("Z", { ctrlKey: true, shiftKey: true }), actions);
  assert.deepEqual(effects, ["undo", "undo", "redo", "redo"]);
});

test("les formulaires, zones éditables et leurs descendants conservent toutes leurs touches", () => {
  const editable = [
    element("INPUT"),
    element("TEXTAREA"),
    element("SELECT"),
    element("OPTION", element("SELECT")),
    element("DIV", null, { contenteditable: "" }),
    element("SPAN", element("DIV", null, { contenteditable: "true" })),
    element(
      "EM",
      element(
        "SPAN",
        element("DIV", null, { contenteditable: "plaintext-only" }),
      ),
    ),
    { tagName: "SPAN", isContentEditable: true },
  ];
  for (const helpOpen of [false, true])
    for (const target of editable) {
      for (const original of [
        keyEvent("Delete"),
        keyEvent("Backspace"),
        keyEvent("z", { metaKey: true }),
        keyEvent("Z", { ctrlKey: true, shiftKey: true }),
        keyEvent("v"),
        keyEvent("w"),
        keyEvent("Escape"),
      ]) {
        const event = { ...original, target };
        const { effects, actions } = editor(helpOpen);
        assert.equal(handleEditorKey(event, actions), false);
        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(effects, []);
      }
    }
});

test("une cible absente ou non éditable ne fait pas échouer le raccourci", () => {
  for (const target of [
    null,
    {},
    element("DIV", null, { contenteditable: "false" }),
  ]) {
    const { effects, actions } = editor();
    handleEditorKey(keyEvent("Delete", { target }), actions);
    assert.deepEqual(effects, ["remove-selection"]);
  }
});

test("une erreur d’arrêt est affichée et le rejet est pris en charge", async () => {
  const notices = [],
    errors = [];
  const failure = new Error("Service indisponible");
  await assert.doesNotReject(
    requestSimulationStop(
      () => Promise.reject(failure),
      (message) => notices.push(message),
      (message) => errors.push(message),
    ),
  );
  assert.deepEqual(errors, [String(failure)]);
  assert.deepEqual(notices, []);
});

test("un arrêt accepté conserve la notification de succès actuelle", async () => {
  const notices = [],
    errors = [];
  let calls = 0;
  await requestSimulationStop(
    async () => {
      calls += 1;
      return { stop_requested: true };
    },
    (message) => notices.push(message),
    (message) => errors.push(message),
  );
  assert.equal(calls, 1);
  assert.deepEqual(notices, ["Arrêt demandé."]);
  assert.deepEqual(errors, []);
});

test("R et Maj+R tournent la sélection, mais le guide et les champs restent prioritaires", () => {
  const { effects, actions } = editor();
  actions.rotateSelection = (direction) => effects.push(`rotate:${direction}`);
  handleEditorKey(keyEvent("r"), actions);
  handleEditorKey(keyEvent("R", { shiftKey: true }), actions);
  assert.deepEqual(effects, ["rotate:1", "rotate:-1"]);
  actions.helpOpen = true;
  handleEditorKey(keyEvent("r"), actions);
  actions.helpOpen = false;
  handleEditorKey(keyEvent("r", { target: element("INPUT") }), actions);
  assert.deepEqual(effects, ["rotate:1", "rotate:-1"]);
  assert.equal(
    handleEditorKey(keyEvent("r", { ctrlKey: true }), actions),
    false,
  );
});

test("Cmd/Ctrl D duplique et Cmd/Ctrl A sélectionne avec actions explicites", () => {
  const { effects, actions } = editor();
  actions.duplicateSelection = () => effects.push("duplicate");
  actions.selectAll = () => effects.push("select-all");
  for (const modifier of ["metaKey", "ctrlKey"]) {
    const duplicate = keyEvent("d", { [modifier]: true });
    const all = keyEvent("a", { [modifier]: true });
    assert.equal(handleEditorKey(duplicate, actions), true);
    assert.equal(handleEditorKey(all, actions), true);
    assert.equal(duplicate.defaultPrevented, true);
    assert.equal(all.defaultPrevented, true);
  }
  assert.deepEqual(effects, [
    "duplicate",
    "select-all",
    "duplicate",
    "select-all",
  ]);
  actions.helpOpen = true;
  handleEditorKey(keyEvent("d", { ctrlKey: true }), actions);
  handleEditorKey(keyEvent("a", { metaKey: true }), actions);
  assert.equal(effects.length, 4);
});

test("les flèches déplacent de dix, Maj de un, sans prendre les raccourcis système", () => {
  const { effects, actions } = editor();
  actions.nudgeSelection = (dx, dy) => effects.push([dx, dy]);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
    handleEditorKey(keyEvent(key), actions);
  handleEditorKey(keyEvent("ArrowRight", { shiftKey: true }), actions);
  assert.deepEqual(effects, [
    [-10, 0],
    [10, 0],
    [0, -10],
    [0, 10],
    [1, 0],
  ]);
  assert.equal(
    handleEditorKey(keyEvent("ArrowLeft", { ctrlKey: true }), actions),
    false,
  );
  assert.equal(
    handleEditorKey(keyEvent("ArrowUp", { metaKey: true }), actions),
    false,
  );
  actions.helpOpen = true;
  assert.equal(handleEditorKey(keyEvent("ArrowDown"), actions), true);
  assert.equal(effects.length, 5);
});

test("le collage Cmd/Ctrl V et les champs conservent leurs raccourcis", () => {
  const { effects, actions } = editor();
  actions.duplicateSelection = () => effects.push("duplicate");
  actions.selectAll = () => effects.push("select-all");
  actions.nudgeSelection = () => effects.push("nudge");
  for (const modifier of ["metaKey", "ctrlKey"]) {
    const paste = keyEvent("v", { [modifier]: true });
    assert.equal(handleEditorKey(paste, actions), false);
    assert.equal(paste.defaultPrevented, false);
  }
  for (const event of [
    keyEvent("d", { ctrlKey: true }),
    keyEvent("a", { metaKey: true }),
    keyEvent("ArrowRight"),
  ]) {
    event.target = element("INPUT");
    assert.equal(handleEditorKey(event, actions), false);
  }
  assert.deepEqual(effects, []);
});
