import React, { act, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWorkViewport } from "../../src/useWorkViewport";
import type { State } from "../../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ok = (value: unknown, detail: string) => { if (!value) throw new Error(detail); };
function close(actual: number, expected: number, detail: string) {
  if (Math.abs(actual - expected) >= 1)
    throw new Error(`${detail} : reçu ${actual.toFixed(3)}, attendu ${expected.toFixed(3)}`);
}
const source = (revision = 0, view = "split", id = "viewport-test") => ({
  project: { id, revision, ui: { view } },
}) as State;
const nativeFetch = window.fetch;
let fetchCount = 0;
window.fetch = (() => {
  fetchCount++;
  return Promise.reject(new Error("Ce scénario ne doit appeler aucune API."));
}) as typeof window.fetch;
const nativeScrollBy = window.scrollBy.bind(window);
const scrollCalls: ScrollToOptions[] = [];
window.scrollBy = ((options: ScrollToOptions) => {
  scrollCalls.push(options);
  nativeScrollBy(options);
}) as typeof window.scrollBy;
const frames = async (count = 3) => {
  for (let i = 0; i < count; i++)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
};

type ProbeControl = {
  state: State;
  publish: (next: State, cleanup?: boolean, onCleanup?: () => void) => void;
};
async function fixture() {
  const container = document.createElement("div");
  document.querySelector("#fixture")!.append(container);
  const root = createRoot(container);
  const snapshots: { top: number; form: boolean }[] = [];
  let control!: ProbeControl;
  function Probe() {
    const preserve = useWorkViewport();
    const [state, setState] = useState(source());
    const [context, setContext] = useState(true);
    const [form, setForm] = useState(true);
    const [cleanup, setCleanup] = useState(false);
    const cleanupAction = useRef<(() => void) | undefined>(undefined);
    control = {
      state,
      publish(next, clean = false, action) {
        // Même frontière que l'application : une réponse arrive, on capture
        // la vue présente, puis on publie le nouvel état et ses nettoyages.
        preserve(state, next);
        cleanupAction.current = action;
        setState(next);
        if (clean) { setContext(false); setCleanup(true); }
      },
    };
    useLayoutEffect(() => {
      const board = container.querySelector<HTMLElement>(".bb-board-scroll");
      if (board) snapshots.push({ top: board.getBoundingClientRect().top, form });
    });
    useEffect(() => {
      if (!cleanup || !form) return;
      // Le nettoyage tardif de pinToPlace fait réellement un deuxième rendu.
      // Une publication identique ne doit pas effacer la stabilisation active.
      preserve(state, { ...state });
      cleanupAction.current?.();
      setForm(false);
    }, [cleanup, form, preserve, state]);
    return <div className="probe" data-revision={state.project.revision}>
      <div className="spacer-before" />
      {context && <div className="context-controls">Commandes contextuelles retirées au premier rendu.</div>}
      <div className="schematic-scroll" tabIndex={0}>Schéma de test</div>
      <div className="between" />
      {form && <div className="placement-form">Formulaire retiré dans useEffect, au second rendu.</div>}
      <div className="bb-board-scroll" tabIndex={0} aria-label="Plaque de test">
        <div className="wide-board">Vue de travail avec défilement horizontal</div>
      </div>
      <section id="simulation-results" tabIndex={0}>Résultats de test</section>
      <div className="spacer-after" />
    </div>;
  }
  await act(async () => root.render(<Probe />));
  const board = container.querySelector<HTMLElement>(".bb-board-scroll")!;
  board.focus({ preventScroll: true });
  window.scrollTo({ top: window.scrollY + board.getBoundingClientRect().top - 100, left: 100, behavior: "instant" });
  board.scrollLeft = 180;
  await frames();
  close(board.getBoundingClientRect().top, 100, "Précondition : la plaque doit être visible à t = début du scénario");
  snapshots.length = 0;
  scrollCalls.length = 0;
  return {
    board, snapshots,
    get state() { return control.state; },
    async publish(next: State, cleanup = false, onCleanup?: () => void) {
      await act(async () => control.publish(next, cleanup, onCleanup));
    },
    async dispose() {
      await act(async () => root.unmount());
      container.remove();
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [string, (f: Fixture) => Promise<void>][] = [
  ["Deux rendus de suppression gardent la plaque à moins d’un pixel du même emplacement", async f => {
    const before = f.board.getBoundingClientRect();
    const original = f.board;
    await f.publish(source(1), true);
    ok(f.snapshots.some(s => s.form) && f.snapshots.some(s => !s.form), "Les deux rendus doivent avoir été observés.");
    for (const snapshot of f.snapshots) close(snapshot.top, before.top, "Ancre après un rendu");
    close(f.board.getBoundingClientRect().left, before.left, "Position horizontale globale");
    close(f.board.scrollLeft, 180, "Défilement interne de la plaque");
    ok(f.board === original && original.isConnected, "Le panneau ne doit pas être remonté.");
  }],
  ["Après stabilisation, un défilement natif et un sondage de même révision restent libres", async f => {
    await f.publish(source(1), true);
    await frames();
    window.scrollTo({ top: window.scrollY + 130, left: 160, behavior: "instant" });
    const y = window.scrollY, x = window.scrollX, calls = scrollCalls.length;
    await f.publish({ ...f.state });
    close(window.scrollY, y, "Défilement vertical conservé");
    close(window.scrollX, x, "Défilement horizontal conservé");
    ok(scrollCalls.length === calls, "Le sondage stable ne doit pas restaurer une ancienne ancre.");
  }],
  ["Un changement de projet ne restaure pas l’ancienne zone", async f => {
    await f.publish(source(0, "split", "autre-projet"), true);
    ok(scrollCalls.length === 0, "La navigation vers un projet ne doit pas être compensée.");
  }],
  ["Un changement de vue ne restaure pas l’ancienne zone", async f => {
    await f.publish(source(1, "schematic"), true);
    ok(scrollCalls.length === 0, "Le choix explicite d’une vue reste une navigation.");
  }],
  ["Un sondage de même révision n’ancre pas une modification de disposition", async f => {
    const top = f.board.getBoundingClientRect().top;
    await f.publish({ ...f.state }, true);
    ok(scrollCalls.length === 0, "La même révision n’est pas une édition.");
    ok(Math.abs(f.board.getBoundingClientRect().top - top) > 100, "Le harnais doit réellement réduire la hauteur.");
  }],
  ["La vue est capturée à l’arrivée d’une réponse lente, après le défilement de l’utilisateur", async f => {
    let reply!: () => void;
    const response = new Promise<void>(resolve => { reply = resolve; });
    const pending = response.then(() => f.publish(source(1), true));
    window.scrollTo({ top: window.scrollY - 80, left: 140, behavior: "instant" });
    const top = f.board.getBoundingClientRect().top;
    reply();
    await pending;
    close(f.board.getBoundingClientRect().top, top, "Vue actuelle conservée, pas la position de départ réseau");
  }],
  ...["wheel", "touchmove", "pointerdown", "keydown"].map((event): [string, (f: Fixture) => Promise<void>] => [
    `Une action ${event} interrompt immédiatement la stabilisation entre deux rendus`, async f => {
      let wantedY = 0, calls = 0;
      await f.publish(source(1), true, () => {
        document.dispatchEvent(new Event(event, { bubbles: true }));
        wantedY = window.scrollY + 100;
        window.scrollTo({ top: wantedY, left: window.scrollX, behavior: "instant" });
        calls = scrollCalls.length;
      });
      close(window.scrollY, wantedY, "L’action explicite de l’utilisateur conserve le défilement choisi");
      ok(scrollCalls.length === calls, "Aucune restauration supplémentaire après l’action utilisateur.");
    },
  ]),
];

async function run() {
  // La restauration initiale de navigation peut sinon annuler le premier
  // scroll de préparation, avant même qu'une ancre visible existe.
  if (document.readyState !== "complete")
    await new Promise<void>(resolve => window.addEventListener("load", () => resolve(), { once: true }));
  await frames(2);
  let passed = 0;
  for (const [label, check] of cases) {
    const entry = document.createElement("li");
    const f = await fixture();
    try {
      await check(f);
      entry.className = "pass";
      entry.textContent = `✓ ${label}`;
      passed++;
    } catch (cause) {
      entry.className = "fail";
      entry.textContent = `✗ ${label} — ${String(cause)}`;
    } finally {
      await f.dispose();
    }
    document.querySelector("#results")!.append(entry);
  }
  ok(fetchCount === 0, "Aucune requête API ne doit avoir été émise.");
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.textContent = `${passed}/${cases.length} scénarios réussis · 0 requête API`;
  summary.dataset.runStatus = passed === cases.length ? "passed" : "failed";
  window.fetch = nativeFetch;
  window.scrollBy = nativeScrollBy;
}
void run().catch(cause => {
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = "failed";
  summary.textContent = String(cause);
  window.fetch = nativeFetch;
  window.scrollBy = nativeScrollBy;
});
