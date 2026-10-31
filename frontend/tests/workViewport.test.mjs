import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/workViewport.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { shouldPreserveWorkViewport, captureWorkViewport, restoreWorkViewport } = await import(
  "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
);
const state = (revision, view = "split", id = "p1") => ({
  project: { id, revision, ui: { view } },
});

test("seule une révision plus récente du même projet et de la même vue conserve le point de travail", () => {
  const current = state(7);
  assert.equal(shouldPreserveWorkViewport(current, state(8)), true);
  assert.equal(shouldPreserveWorkViewport(null, state(8)), false);
  assert.equal(shouldPreserveWorkViewport(current, state(7)), false);
  assert.equal(shouldPreserveWorkViewport(current, state(6)), false);
  assert.equal(shouldPreserveWorkViewport(current, state(8, "breadboard")), false);
  assert.equal(shouldPreserveWorkViewport(current, state(8, "split", "p2")), false);
});

test("l’obsolescence des mesures n’empêche pas de préserver une édition électrique", () => {
  const current = { ...state(7), simulation: { status: "success", stale: false } };
  const edited = { ...state(8), simulation: { status: "success", stale: true } };
  assert.equal(shouldPreserveWorkViewport(current, edited), true);
  assert.equal(shouldPreserveWorkViewport(edited, { ...edited, running: true }), false);
});

function viewport({ x = 0, y = 1000, width = 1000, height = 700 } = {}) {
  const root = { clientWidth: width, clientHeight: height, scrollWidth: 2200, scrollHeight: 4000 };
  const calls = [];
  const view = {
    x, y,
    scrollBy({ left, top, behavior }) {
      calls.push({ left, top, behavior });
      this.x = Math.max(0, Math.min(root.scrollWidth - root.clientWidth, this.x + left));
      this.y = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, this.y + top));
    },
  };
  const panes = [];
  const doc = {
    defaultView: view,
    documentElement: root,
    activeElement: null,
    querySelectorAll: () => panes,
  };
  function pane(name, { x = 100, y = 1050, width = 800, height = 400, innerLeft = 0 } = {}) {
    const child = { name: `${name}-focus` };
    const element = {
      name, x, y, width, height, scrollLeft: innerLeft, isConnected: true, child,
      contains: (candidate) => candidate === element || candidate === child,
      getBoundingClientRect() {
        return {
          left: this.x - view.x, top: this.y - view.y,
          right: this.x - view.x + this.width, bottom: this.y - view.y + this.height,
          width: this.width, height: this.height,
        };
      },
    };
    panes.push(element);
    return element;
  }
  return { doc, root, view, panes, pane, calls };
}

test("le panneau visible contenant le focus prime sur une autre zone plus grande", () => {
  const v = viewport();
  const schematic = v.pane("schematic", { y: 0 });
  const board = v.pane("board", { y: 1020, height: 150 });
  const results = v.pane("results", { y: 1200, height: 500 });
  v.doc.activeElement = board.child;
  assert.equal(captureWorkViewport(v.doc).element, board);
  v.doc.activeElement = schematic.child;
  assert.equal(captureWorkViewport(v.doc).element, results,
    "Un ancien focus hors écran ne doit pas ramener vers le schéma.");
});

test("sans focus dans le travail, choisir la plus grande intersection avec la fenêtre", () => {
  const v = viewport();
  v.pane("hors écran horizontal", { x: 1500, height: 700 });
  v.pane("plaque partiellement visible", { y: 1550, height: 500 });
  const results = v.pane("résultats visibles", { y: 1000, height: 400 });
  v.doc.activeElement = { name: "bouton extérieur" };
  assert.equal(captureWorkViewport(v.doc).element, results);
});

test("sans zone de travail visible ou sans fenêtre, aucune ancre ne force une navigation", () => {
  const v = viewport();
  v.pane("au-dessus", { y: 200, height: 400 });
  v.pane("en dessous", { y: 1800, height: 400 });
  v.pane("masqué", { y: 1050, width: 0 });
  assert.equal(captureWorkViewport(v.doc), null);
  assert.equal(captureWorkViewport({ ...v.doc, defaultView: null }), null);
});

test("une suppression garde le panneau au même endroit et restaure ses défilements horizontaux", () => {
  const v = viewport({ x: 120, y: 1537, height: 900 });
  const board = v.pane("board", { x: 300, y: 1502.46, width: 820, height: 636, innerLeft: 96 });
  v.doc.activeElement = board.child;
  const anchor = captureWorkViewport(v.doc);
  board.y = 1445.46;
  board.scrollLeft = 0;
  v.view.y = 1420;
  v.view.x = 40;
  restoreWorkViewport(anchor);
  assert.ok(Math.abs(board.getBoundingClientRect().top - anchor.top) < 1e-9);
  assert.ok(Math.abs(board.getBoundingClientRect().left - anchor.left) < 1e-9);
  assert.equal(v.view.x, 120);
  assert.equal(board.scrollLeft, 96);
  assert.equal(v.calls.length, 1);
  assert.equal(v.calls[0].behavior, "instant");
});

test("la capture lit la position au moment de la publication, après un défilement intervenu pendant la requête", () => {
  const v = viewport({ y: 800 });
  const board = v.pane("board", { y: 1000 });
  v.view.y = 950;
  const anchor = captureWorkViewport(v.doc);
  assert.equal(anchor.top, 50);
  board.y = 950;
  v.view.y = 930;
  restoreWorkViewport(anchor);
  assert.equal(v.view.y, 900);
  assert.equal(board.getBoundingClientRect().top, 50);
});

test("une ancre supprimée ou masquée ne déplace plus la page", () => {
  for (const removed of [true, false]) {
    const v = viewport();
    const board = v.pane("board", { innerLeft: 80 });
    const anchor = captureWorkViewport(v.doc);
    board.scrollLeft = 0;
    board.y -= 120;
    if (removed) board.isConnected = false;
    else board.height = 0;
    restoreWorkViewport(anchor);
    assert.equal(v.calls.length, 0);
    assert.equal(board.scrollLeft, 0);
  }
});

test("un panneau immobile n’entraîne aucun scroll de fenêtre, même si son défilement interne a été perdu", () => {
  const v = viewport();
  const board = v.pane("board", { innerLeft: 90 });
  const anchor = captureWorkViewport(v.doc);
  board.scrollLeft = 0;
  restoreWorkViewport(anchor);
  assert.equal(board.scrollLeft, 90);
  assert.equal(v.calls.length, 0);
});

test("si le document raccourcit, le navigateur borne naturellement la restauration à la fin de page", () => {
  const v = viewport({ x: 600, y: 1200 });
  const board = v.pane("board", { x: 650, y: 1300, width: 700, height: 400, innerLeft: 36 });
  const anchor = captureWorkViewport(v.doc);
  v.root.scrollHeight = 1500;
  v.root.scrollWidth = 1200;
  v.view.y = 800;
  v.view.x = 200;
  board.y = 1100;
  board.x = 450;
  board.scrollLeft = 0;
  restoreWorkViewport(anchor);
  assert.equal(v.view.y, 800);
  assert.equal(v.view.x, 200);
  assert.equal(board.scrollLeft, 36);
  assert.equal(v.calls.length, 1, "La borne du document ne provoque pas une boucle de restauration.");
});

function boardSurface(board, view, headerHeight = 106) {
  const surface = {
    isConnected: true, hidden: false, headerHeight,
    getBoundingClientRect() {
      if (this.hidden) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      const pane = board.getBoundingClientRect();
      const left = pane.left - board.scrollLeft, top = pane.top + this.headerHeight;
      return { left, top, right: left + 940, bottom: top + 530, width: 940, height: 530 };
    },
  };
  board.querySelector = (selector) => selector === ".bb-flat-surface" ? surface : null;
  return surface;
}

test("les trous physiques restent en place quand un bandeau interne au SVG disparaît", () => {
  const v = viewport({ x: 120 });
  const board = v.pane("board", { x: 300, innerLeft: 96 });
  const surface = boardSurface(board, v.view);
  v.doc.activeElement = board.child;
  const anchor = captureWorkViewport(v.doc);
  assert.equal(anchor.reference, surface);
  surface.headerHeight = 0;
  board.scrollLeft = 0;
  v.view.x = 40;
  restoreWorkViewport(anchor);
  assert.ok(Math.abs(surface.getBoundingClientRect().top - anchor.top) < 1e-9);
  assert.ok(Math.abs(surface.getBoundingClientRect().left - anchor.left) < 1e-9);
  assert.equal(v.view.x, 120, "Rétablir le scroll interne avant de calculer la correction horizontale globale.");
  assert.equal(board.scrollLeft, 96);
});

test("une surface physique supprimée ou masquée n’utilise plus son ancienne géométrie", () => {
  for (const removed of [true, false]) {
    const v = viewport();
    const board = v.pane("board", { innerLeft: 80 });
    const surface = boardSurface(board, v.view);
    const anchor = captureWorkViewport(v.doc);
    if (removed) surface.isConnected = false;
    else surface.hidden = true;
    board.scrollLeft = 0;
    restoreWorkViewport(anchor);
    assert.equal(v.calls.length, 0);
    assert.equal(board.scrollLeft, 0);
  }
});

test("une surface physique masquée à la capture se replie sur le panneau visible", () => {
  const v = viewport();
  const board = v.pane("board");
  const surface = boardSurface(board, v.view);
  surface.hidden = true;
  assert.equal(captureWorkViewport(v.doc).reference, board);
});
