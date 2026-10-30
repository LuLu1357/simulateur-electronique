import React, { act as reactAct } from "react";
import { createRoot } from "react-dom/client";
import { BreadboardView } from "../../src/components/BreadboardView";
import type { BreadboardViewProps } from "../../src/components/BreadboardView";
import type { State } from "../../src/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function equal(actual: unknown, expected: unknown, detail: string) {
  if (!Object.is(actual, expected))
    throw new Error(
      `${detail} : reçu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`,
    );
}
function ok(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(detail);
}
function deepFreeze(value: unknown) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

function state(placements: Record<string, string>): State {
  const project: State["project"] = {
    schema_version: 1,
    id: "board-locations-fixture",
    title: "Consultation des emplacements",
    revision: 7,
    components: [
      {
        id: "R1",
        kind: "resistor",
        label: "R1",
        value: 1000,
        pins: { p: "R1.p", n: "R1.n" },
      },
    ],
    wires: [{ id: "W1", a: "R1.n", b: "J1" }],
    junctions: [{ id: "J1", x: 500, y: 180 }],
    schematic: { R1: { x: 300, y: 180, rotation: 0 } },
    breadboard: { board_count: 2, rail_splits: true, placements },
    ui: {
      selected: ["R1"],
      highlights: ["W1"],
      annotations: [],
      view: "split",
    },
  };
  const holeToNet = Object.fromEntries(
    Object.entries(placements).map(([pin, hole]) => [
      hole,
      pin === "R1.p" ? "net_p" : "net_n",
    ]),
  );
  return {
    project,
    topology: {
      nets: [
        { id: "net_p", points: ["R1.p"] },
        { id: "net_n", points: ["R1.n", "J1"] },
      ],
      terminal_to_net: { "R1.p": "net_p", "R1.n": "net_n", J1: "net_n" },
      hole_to_net: holeToNet,
    },
    catalog: {
      resistor: {
        name: "Résistance",
        unit: "Ω",
        default_value: 1000,
        pins: [
          { name: "p", label: "P", role: "Entrée", package_pin: 1 },
          { name: "n", label: "N", role: "Sortie", package_pin: 2 },
        ],
        models: [],
      },
    },
    simulation: null,
    history: { can_undo: false, can_redo: false },
  };
}

async function fixture(
  placements: Record<string, string> = { "R1.p": "c5", "R1.n": "c8" },
) {
  const source = state(placements);
  const before = JSON.stringify(source);
  deepFreeze(source);
  const calls = {
    act: [] as unknown[],
    onSelect: [] as unknown[],
    onPin: [] as unknown[],
    onPending: [] as unknown[],
    onTool: [] as unknown[],
    onBoardWire: [] as unknown[],
    onNotice: [] as unknown[],
    onError: [] as unknown[],
    onLayout: [] as unknown[],
  };
  const props: BreadboardViewProps = {
    state: source,
    simulation: null,
    stale: false,
    flowMode: "off",
    flowSpeed: 1,
    voltageColors: false,
    voltageRange: 5,
    pending: null,
    pinToPlace: null,
    tool: "select",
    boardWire: null,
    onSelect: (value) => calls.onSelect.push(value),
    onPin: (value) => calls.onPin.push(value),
    onPending: (value) => calls.onPending.push(value),
    onTool: (value) => calls.onTool.push(value),
    onBoardWire: (value) => calls.onBoardWire.push(value),
    onNotice: (value) => calls.onNotice.push(value),
    onError: (value) => calls.onError.push(value),
    onLayout: () => calls.onLayout.push(true),
    act: async (...args) => {
      calls.act.push(args);
      throw new Error("Une consultation ne doit pas déclencher de transaction");
    },
  };
  const container = document.createElement("div");
  document.querySelector("#probe")!.append(container);
  const root = createRoot(container);
  await reactAct(async () => root.render(<BreadboardView {...props} />));
  // Le montage initialise le mode de cavalier ; seules les actions testées
  // ensuite doivent rester sans callback vers le parent.
  for (const values of Object.values(calls)) values.length = 0;

  function query<T extends Element = HTMLElement>(selector: string): T {
    const result = container.querySelector<T>(selector);
    ok(result, `Contrôle attendu : ${selector}`);
    return result;
  }
  async function click(target: Element) {
    await reactAct(async () => {
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }
  function assertUntouched() {
    equal(
      JSON.stringify(source),
      before,
      "Projet, sélection et topologie conservés",
    );
    for (const [name, values] of Object.entries(calls))
      equal(values.length, 0, `Aucun appel ${name} lors de la consultation`);
  }
  return {
    source,
    before,
    calls,
    container,
    query,
    click,
    assertUntouched,
    async board(number: number) {
      await click(query(`[aria-label="Afficher la plaque ${number}"]`));
    },
    activeBoard(number: number) {
      equal(
        query(`[aria-label="Afficher la plaque ${number}"]`).getAttribute(
          "aria-pressed",
        ),
        "true",
        `Plaque ${number} affichée`,
      );
    },
    location(pin = "R1.p") {
      return query(`[aria-label="Emplacement de ${pin}"]`);
    },
    async dispose() {
      await reactAct(async () => root.unmount());
      container.remove();
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [string, Record<string, string>, (f: Fixture) => Promise<void>][] =
  [
    [
      "Une borne absente est annoncée non implantée",
      {},
      async (f) => {
        equal(
          f.location().textContent,
          "P · Non implantée",
          "Emplacement absent",
        );
        equal(
          f.location().querySelectorAll("button").length,
          1,
          "Pas de fausse destination à consulter",
        );
        f.assertUntouched();
      },
    ],
    [
      "La plaque active indique son numéro et ses trous",
      { "R1.p": "c5", "R1.n": "c8" },
      async (f) => {
        f.activeBoard(1);
        equal(
          f.location().textContent,
          "P · Plaque 1 · c5",
          "Trou de P sur la plaque active",
        );
        equal(
          f.location("R1.n").textContent,
          "N · Plaque 1 · c8",
          "Trou de N sur la plaque active",
        );
        equal(
          f.location().querySelectorAll("button").length,
          1,
          "Pas de navigation vers la plaque déjà affichée",
        );
        f.assertUntouched();
      },
    ],
    [
      "Une autre plaque conserve son emplacement global et propose une consultation",
      { "R1.p": "c5", "R1.n": "c8" },
      async (f) => {
        await f.board(2);
        f.activeBoard(2);
        ok(
          f.location().textContent?.includes("P · Plaque 1 · c5"),
          "La borne reste localisée sur la plaque 1",
        );
        f.query('[aria-label="Voir la plaque 1 pour R1.p, trou c5"]');
        ok(
          !f.location().textContent?.includes("Non implantée"),
          "Autre plaque et absence sont distinctes",
        );
        f.assertUntouched();
      },
    ],
    [
      "Une implantation partielle distingue la borne sur une autre plaque et la borne absente, y compris dans la liste à implanter",
      { "R1.p": "c5" },
      async (f) => {
        await f.board(2);
        ok(
          f.location().textContent?.includes("P · Plaque 1 · c5"),
          "La borne implantée reste située sur sa plaque",
        );
        equal(
          f.location("R1.n").textContent,
          "N · Non implantée",
          "Seule la borne absente est non implantée",
        );
        const tray = f.query(".bb-tray-pins");
        ok(
          tray.textContent?.includes("P · Plaque 1 · c5"),
          "Emplacement global dans la liste à implanter",
        );
        ok(
          tray.textContent?.includes("N · Non implantée"),
          "Borne absente dans la liste à implanter",
        );
        f.assertUntouched();
      },
    ],
    [
      "Voir la plaque revient au bon emplacement sans toucher au circuit ni à la sélection",
      { "R1.p": "c5", "R1.n": "c8" },
      async (f) => {
        await f.board(2);
        await f.click(
          f.query('[aria-label="Voir la plaque 1 pour R1.p, trou c5"]'),
        );
        f.activeBoard(1);
        equal(
          f.location().textContent,
          "P · Plaque 1 · c5",
          "Emplacement toujours présent après navigation",
        );
        equal(
          document.activeElement,
          f.query(".bb-board"),
          "Focus rendu à la plaque consultée",
        );
        f.assertUntouched();
      },
    ],
    [
      "Le transfert exige son action propre et ne démarre jamais lors d’une consultation",
      { "R1.p": "c5", "R1.n": "c8" },
      async (f) => {
        await f.board(2);
        const transfer = [
          ...f.container.querySelectorAll(".bb-selected-controls button"),
        ].find(
          (button) =>
            button.textContent?.trim() === "Transférer sur la plaque 2",
        );
        ok(transfer, "Action explicite de transfert présente");
        const see = f.query(
          '[aria-label="Voir la plaque 1 pour R1.p, trou c5"]',
        );
        ok(
          transfer !== see,
          "Transfert et consultation sont deux boutons distincts",
        );
        await f.click(see);
        equal(
          f.container.querySelector(".bb-placement-status"),
          null,
          "Aucun placement en attente après consultation",
        );
        f.assertUntouched();
        await f.board(2);
        const currentTransfer = [
          ...f.container.querySelectorAll(".bb-selected-controls button"),
        ].find(
          (button) =>
            button.textContent?.trim() === "Transférer sur la plaque 2",
        );
        ok(currentTransfer, "Transfert disponible après retour à la plaque 2");
        await f.click(currentTransfer);
        ok(
          f.container
            .querySelector(".bb-placement-status")
            ?.textContent?.includes("R1"),
          "Le transfert explicite attend le choix d’un trou",
        );
        equal(
          f.calls.onPending.length,
          1,
          "Le transfert explicite prépare le geste",
        );
        equal(
          f.calls.onPin.length,
          1,
          "Le transfert explicite prépare la patte",
        );
        equal(
          f.calls.act.length,
          0,
          "Aucun placement modifié avant le choix d’un trou",
        );
        equal(
          JSON.stringify(f.source),
          f.before,
          "Projet inchangé jusqu’au choix explicite du trou",
        );
      },
    ],
  ];

async function run() {
  let passed = 0;
  const nativeFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls++;
    throw new Error("Ce scénario ne doit appeler aucun service réseau");
  }) as typeof fetch;
  try {
    for (const [name, placements, exercise] of cases) {
      const row = document.createElement("li");
      row.textContent = name;
      document.querySelector("#results")!.append(row);
      let current: Fixture | undefined;
      try {
        current = await fixture(placements);
        await exercise(current);
        equal(networkCalls, 0, "Aucun service contacté");
        row.className = "pass";
        row.textContent = `✓ ${name}`;
        passed++;
        console.log(
          "BOARD_LOCATIONS_CASE",
          JSON.stringify({ name, status: "passed" }),
        );
      } catch (error) {
        row.className = "fail";
        row.textContent = `✗ ${name}`;
        const details = document.createElement("pre");
        details.textContent = String(error);
        row.append(details);
        console.log(
          "BOARD_LOCATIONS_CASE",
          JSON.stringify({ name, status: "failed", error: String(error) }),
        );
      } finally {
        await current?.dispose();
      }
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }
  const status = passed === cases.length ? "passed" : "failed";
  document.querySelector<HTMLElement>("#app")!.dataset.runStatus = status;
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = status;
  summary.textContent = `${passed}/${cases.length} scénarios réussis — ${cases.length - passed} échec(s).`;
  console.log(
    "BOARD_LOCATIONS_RESULT",
    JSON.stringify({ passed, total: cases.length, networkCalls, status }),
  );
}

void run().catch((error) => {
  document.querySelector<HTMLElement>("#app")!.dataset.runStatus = "failed";
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = "failed";
  summary.textContent = `Échec du scénario : ${String(error)}`;
  console.log(
    "BOARD_LOCATIONS_RESULT",
    JSON.stringify({ status: "failed", error: String(error) }),
  );
});
