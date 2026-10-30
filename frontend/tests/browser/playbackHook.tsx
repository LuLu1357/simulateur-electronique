import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useSimulationPlayback } from "../../src/useSimulationPlayback";
import type { SimulationFrame } from "../../src/playback";
import type { State } from "../../src/types";

// Ce scénario utilise le vrai cycle React (rendu, effets, nettoyage et promesses).
// Les seules doubles de test sont la frontière HTTP et l'horloge de lecture.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function equal(actual: unknown, expected: unknown, detail: string) {
  if (!Object.is(actual, expected))
    throw new Error(`${detail} : reçu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`);
}
function ok(value: unknown, detail: string) {
  if (!value) throw new Error(detail);
}
const uid = "1".repeat(32);
function state(simulationId = uid, finalVoltage = 5): State {
  return {
    project: { id: "hook-test", revision: 10 },
    running: false,
    simulation: {
      status: "success", stale: false, simulation_id: simulationId,
      project_revision: 6, circuit_fingerprint: "test-fingerprint",
      analysis: { kind: "tran", stop: 1 }, time: [0, 0.01, 0.2, 1],
      curves: [{ id: "V", label: "V", unit: "V", values: [0, 1, 3, finalVoltage] }],
      voltages: { 0: 0, V: finalVoltage }, currents: { R1: finalVoltage / 1000 },
      terminal_currents: { R1: { p: finalVoltage / 1000, n: -finalVoltage / 1000 } },
      wire_currents: { W1: finalVoltage / 1000 }, diagnostics: [], assumptions: [],
    },
  } as unknown as State;
}
function frame(source: State, index: number): SimulationFrame {
  const simulation = source.simulation!;
  return {
    project_id: source.project.id, project_revision: source.project.revision,
    source_revision: simulation.project_revision,
    simulation_id: simulation.simulation_id!,
    circuit_fingerprint: simulation.circuit_fingerprint as string,
    index, time: simulation.time[index], sample_count: simulation.time.length,
    simulation: {
      ...simulation, time: [], curves: [], voltages: { 0: 0, V: index },
      currents: { R1: index / 1000 },
      terminal_currents: { R1: { p: index / 1000, n: -index / 1000 } },
      wire_currents: { W1: index / 1000 }, sample_index: index,
      sample_time: simulation.time[index], sample_count: simulation.time.length,
    },
  };
}

function controlledClock() {
  const saved = {
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    now: Object.getOwnPropertyDescriptor(performance, "now"),
  };
  let now = 0, serial = 0;
  const timers = new Map<number, { at: number; every: number; callback: () => void }>();
  const add = (callback: TimerHandler, delay = 0, every = false) => {
    if (typeof callback !== "function") throw new Error("Horloge : fonction requise");
    const id = ++serial;
    timers.set(id, { at: now + delay, every: every ? delay : 0, callback: callback as () => void });
    return id;
  };
  window.setTimeout = ((callback: TimerHandler, delay = 0) => add(callback, delay)) as typeof window.setTimeout;
  window.setInterval = ((callback: TimerHandler, delay = 0) => add(callback, delay, true)) as typeof window.setInterval;
  window.clearTimeout = window.clearInterval = ((id: number) => timers.delete(id)) as typeof window.clearTimeout;
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  return {
    advance(milliseconds: number) {
      const until = now + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        if (++iterations > 10000) throw new Error("Boucle de minuteries inattendue");
        const [id, timer] = next;
        now = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.callback();
      }
      now = until;
    },
    restore() {
      window.setTimeout = saved.setTimeout; window.clearTimeout = saved.clearTimeout;
      window.setInterval = saved.setInterval; window.clearInterval = saved.clearInterval;
      if (saved.now) Object.defineProperty(performance, "now", saved.now);
      else delete (performance as unknown as { now?: unknown }).now;
    },
  };
}

type Request = {
  url: URL; signal?: AbortSignal | null;
  resolve: (response: Response) => void; reject: (reason: Error) => void;
};
type Playback = ReturnType<typeof useSimulationPlayback>;
async function fixture() {
  const clock = controlledClock(), nativeFetch = window.fetch;
  const requests: Request[] = [];
  window.fetch = ((input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = new URL(typeof input === "object" && "url" in input ? input.url : String(input), location.href);
    if (url.pathname !== "/api/results/frame") throw new Error(`Requête inattendue : ${url.pathname}`);
    // Ignorer volontairement AbortSignal dans ce double pour vérifier aussi les
    // réponses qui arrivent malgré une annulation déjà envoyée au transport.
    return new Promise<Response>((resolve, reject) => requests.push({ url, signal: init?.signal, resolve, reject }));
  }) as typeof window.fetch;
  const container = document.createElement("div");
  document.querySelector("#probe")!.append(container);
  const root = createRoot(container);
  let model!: Playback, current = state(), busy = false, refreshCount = 0;
  const refresh = async () => { refreshCount++; };
  function Probe() {
    model = useSimulationPlayback(current, current.simulation, busy, refresh);
    return <output>{JSON.stringify({ index: model.index, displayIndex: model.displayIndex, error: model.error })}</output>;
  }
  async function render(next = current, nextBusy = busy) {
    current = next; busy = nextBusy;
    await act(async () => root.render(<Probe />));
  }
  await render();
  return {
    get model() { return model; }, get source() { return current; },
    get refreshCount() { return refreshCount; }, requests, render,
    async action(action: (value: Playback) => void) { await act(async () => action(model)); },
    async advance(milliseconds: number) { await act(async () => clock.advance(milliseconds)); },
    async respond(request: Request, payload: unknown) {
      await act(async () => request.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })));
    },
    async fail(request: Request, message = "Lecture réseau interrompue") { await act(async () => request.reject(new Error(message))); },
    async dispose() {
      await act(async () => root.unmount());
      container.remove(); window.fetch = nativeFetch; clock.restore();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [string, (f: Fixture) => Promise<void>][] = [
  ["Les changements rapides sont regroupés ; temps visé et temps affiché restent distincts", async f => {
    equal(f.model.displayIndex, 3, "Point initial final");
    await f.action(p => p.selectIndex(1));
    await f.action(p => p.selectIndex(2));
    equal(f.model.index, 2, "Point visé");
    equal(f.model.displayIndex, 3, "Point affiché avant réponse");
    equal(f.model.simulation!.sample_time, 1, "Provenance de la mesure conservée");
    await f.advance(50);
    equal(f.requests.length, 1, "Une seule requête regroupée");
    equal(f.requests[0].url.searchParams.get("index"), "2", "Dernier point demandé");
    await f.respond(f.requests[0], frame(f.source, 2));
    equal(f.model.displayIndex, 2, "Point affiché reçu");
    equal(f.model.displayTime, 0.2, "Temps affiché reçu");
    equal(f.model.simulation!.voltages.V, 2, "Mesure reçue");
  }],
  ["Une seule requête en vol ; une réponse dépassée alimente le cache sans déplacer l’affichage", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    await f.action(p => p.selectIndex(2)); await f.advance(50);
    equal(f.requests.length, 1, "Requêtes sérialisées");
    await f.respond(f.requests[0], frame(f.source, 1));
    equal(f.model.displayIndex, 3, "Réponse du point dépassé non affichée");
    await f.advance(50);
    equal(f.requests.length, 2, "Le point suivant démarre après la réponse");
    await f.respond(f.requests[1], frame(f.source, 2));
    await f.action(p => p.selectIndex(1));
    equal(f.model.displayIndex, 1, "Retour immédiat au point en cache");
    equal(f.requests.length, 2, "Pas de lecture répétée du cache");
  }],
  ["Retour final pendant une requête : une réponse tardive ne réactive pas l’ancien point", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    await f.respond(f.requests[0], frame(f.source, 1));
    await f.action(p => p.selectIndex(2)); await f.advance(50);
    equal(f.model.displayIndex, 1, "Ancien point réel pendant lecture lente");
    await f.action(p => p.final());
    equal(f.model.displayIndex, 3, "Retour au point final");
    equal(f.model.simulation!.voltages.V, 5, "Mesures finales restaurées");
    await f.respond(f.requests[1], frame(f.source, 2));
    equal(f.model.displayIndex, 3, "Réponse tardive ignorée après retour final");
    equal(f.requests.length, 2, "Le dernier point ne relance pas de requête");
  }],
  ["Un nouveau calcul annule le transport précédent et rejette sa réponse malgré tout reçue", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    const old = f.source, next = state("2".repeat(32), 9);
    await f.render(next);
    ok(f.requests[0].signal?.aborted, "Ancien transport annulé");
    await f.respond(f.requests[0], frame(old, 1));
    equal(f.model.displayIndex, 3, "Ancien échantillon ignoré");
    equal(f.model.simulation!.voltages.V, 9, "Mesures du nouveau calcul");
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    equal(f.requests.length, 2, "Cache précédent abandonné");
    await f.respond(f.requests[1], frame(next, 1));
    equal(f.model.displayIndex, 1, "Nouvelle lecture recevable");
    equal(f.model.simulation!.simulation_id, "2".repeat(32), "Provenance du nouveau calcul");
  }],
  ["Une édition visuelle conserve le point et le cache du même calcul", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    await f.respond(f.requests[0], frame(f.source, 1));
    const visual = structuredClone(f.source); visual.project.revision += 100;
    await f.render(visual);
    equal(f.model.displayIndex, 1, "Point conservé après sélection ou déplacement visuel");
    await f.action(p => p.final()); await f.action(p => p.selectIndex(1));
    equal(f.requests.length, 1, "Cache valide malgré révision visuelle");
    equal(f.model.displayTime, 0.01, "Instant exact conservé");
  }],
  ["Une édition électrique obsolète retire la relecture et annule toute réponse en vol", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    const old = f.source, stale = structuredClone(old); stale.simulation!.stale = true;
    await f.render(stale);
    equal(f.model.source, null, "Pas de provenance rejouable obsolète");
    ok(f.requests[0].signal?.aborted, "Lecture obsolète annulée");
    await f.respond(f.requests[0], frame(old, 1));
    equal(f.model.displayTime, null, "Aucun temps courant prétendu");
    equal(f.model.simulation!.sample_index, undefined, "Ancien point non réinjecté");
  }],
  ["Un échec de calcul et un calcul en cours ne réutilisent pas une frame comme mesure courante", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    await f.respond(f.requests[0], frame(f.source, 1));
    await f.render(f.source, true);
    equal(f.model.source, null, "Pas de lecture pendant le calcul");
    equal(f.model.simulation!.sample_index, undefined, "Mesure rejouée abandonnée");
    const failed = structuredClone(f.source); failed.simulation!.status = "error";
    await f.render(failed, false);
    equal(f.model.source, null, "Pas de relecture après échec");
    equal(f.model.playing, false, "Lecture arrêtée après échec");
  }],
  ["Une réponse de mauvaise provenance est signalée ; Réessayer accepte ensuite un point valide", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    const wrong = frame(f.source, 1); wrong.simulation_id = "3".repeat(32);
    await f.respond(f.requests[0], wrong);
    ok(f.model.error.includes("ne correspond plus"), "Erreur de provenance explicite");
    equal(f.model.loading, false, "Chargement terminé après refus");
    equal(f.model.displayIndex, 3, "Mauvaise frame non affichée");
    equal(f.refreshCount, 1, "État serveur relu après erreur");
    await f.action(p => p.retry()); await f.advance(50);
    await f.respond(f.requests[1], frame(f.source, 1));
    equal(f.model.error, "", "Erreur effacée après reprise");
    equal(f.model.displayIndex, 1, "Lecture rétablie");
  }],
  ["Une erreur réseau pendant un autre point affiché garde une provenance exacte et permet la reprise", async f => {
    await f.action(p => p.selectIndex(1)); await f.advance(50);
    await f.respond(f.requests[0], frame(f.source, 1));
    await f.action(p => p.selectIndex(2)); await f.advance(50);
    equal(f.model.displayIndex, 1, "Point affiché pendant la lecture");
    await f.fail(f.requests[1]);
    equal(f.model.displayIndex, 3, "Repli identifié au résultat final valide");
    equal(f.model.displayTime, f.model.simulation!.sample_time, "Temps de provenance cohérent");
    ok(f.model.error.includes("interrompue"), "Erreur réseau visible");
    await f.action(p => p.retry()); await f.advance(50);
    await f.respond(f.requests[2], frame(f.source, 2));
    equal(f.model.displayIndex, 2, "Reprise du point demandé");
  }],
  ["Lecture et pause utilisent l’horloge contrôlée, sans relancer de calcul SPICE", async f => {
    await f.action(p => p.toggle());
    equal(f.model.index, 0, "Lecture repartant du début");
    equal(f.model.playing, true, "Lecture active");
    await f.advance(50); await f.respond(f.requests[0], frame(f.source, 0));
    await f.advance(80);
    const paused = f.model.index;
    await f.action(p => p.toggle()); await f.advance(8000);
    equal(f.model.playing, false, "Lecture en pause");
    equal(f.model.index, paused, "Curseur immobile en pause");
    ok(f.requests.every(request => request.url.pathname === "/api/results/frame"), "Seulement des lectures d’échantillons");
  }],
];

async function run() {
  let passed = 0;
  for (const [name, exercise] of cases) {
    const row = document.createElement("li"); row.textContent = name;
    document.querySelector("#results")!.append(row);
    let current: Fixture | undefined;
    try {
      current = await fixture(); await exercise(current);
      row.className = "pass"; row.textContent = `✓ ${name}`; passed++;
    } catch (error) {
      row.className = "fail"; row.textContent = `✗ ${name}`;
      const details = document.createElement("pre"); details.textContent = String(error);
      row.append(details);
    } finally { await current?.dispose(); }
  }
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = passed === cases.length ? "passed" : "failed";
  summary.textContent = `${passed}/${cases.length} scénarios réussis — ${cases.length - passed} échec(s).`;
}
void run().catch(error => {
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = "failed"; summary.textContent = `Échec du scénario : ${String(error)}`;
});
