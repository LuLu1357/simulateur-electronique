import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Oscilloscope } from "../../src/components/Oscilloscope";
import type { Simulation } from "../../src/types";
import { colors } from "../../src/types";
import type { ScopeCurve } from "../../src/scope";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ok(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(detail);
}
function equal(actual: unknown, expected: unknown, detail: string) {
  if (!Object.is(actual, expected))
    throw new Error(
      `${detail} : reçu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`,
    );
}
function freeze(value: unknown) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}
const curve = (
  id: string,
  label: string,
  unit: string,
  values = [0, 1, 3, 5],
): ScopeCurve => ({ id, label, unit, values });
const smallCurves = () => [
  curve("net_entree", "Tension d’entrée", "V"),
  curve("net_reference", "Référence de l’étage", "V", [0, 0.5, 1.5, 2.5]),
  curve("net_sortie", "Sortie mesurée", "V", [0, 0.25, 0.75, 1.25]),
  curve(
    "I:Q1.b",
    "Courant de base de l’Étage d’entrée",
    "A",
    [0, 0.002, 0.003, 0.005],
  ),
];
function simulation(curves = smallCurves(), uid = "1".repeat(32)): Simulation {
  return {
    status: "success",
    project_revision: 7,
    simulation_id: uid,
    circuit_fingerprint: "measurement-fixture",
    analysis: { kind: "tran", stop: 1 },
    time: [0, 0.1, 0.4, 1],
    curves,
    voltages: { 0: 0, net_entree: 5 },
    currents: { Q1: 0.005 },
    diagnostics: [],
    log: "Résultat de test",
    netlist: "Fixture indépendante",
    assumptions: [],
  };
}

async function fixture(initial: Simulation | null = simulation()) {
  const container = document.createElement("div");
  document.querySelector("#probe")!.append(container);
  const root = createRoot(container);
  const sources = new Map<Simulation, string>(),
    cursorCalls: number[] = [];
  let current = initial,
    historical = false;
  function query<T extends Element = HTMLElement>(selector: string): T {
    const value = container.querySelector<T>(selector);
    ok(value, `Contrôle absent : ${selector}`);
    return value;
  }
  async function render(next = current, stale = historical) {
    current = next;
    historical = stale;
    if (next && !sources.has(next)) {
      sources.set(next, JSON.stringify(next));
      freeze(next);
    }
    await act(async () =>
      root.render(
        <StrictMode>
          <Oscilloscope
            sim={current}
            stale={historical}
            cursorIndex={1}
            onCursorChange={(index) => cursorCalls.push(index)}
          />
        </StrictMode>,
      ),
    );
  }
  async function click(element: Element) {
    await act(async () =>
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
  }
  function button(text: string, selector = "button") {
    const result = [
      ...container.querySelectorAll<HTMLButtonElement>(selector),
    ].find((value) => value.textContent?.trim() === text);
    ok(result, `Bouton absent : ${text}`);
    return result;
  }
  function checkbox(id: string) {
    const result = [
      ...container.querySelectorAll<HTMLInputElement>(
        '.measurement-results input[type="checkbox"]',
      ),
    ].find((input) => input.getAttribute("aria-label")?.endsWith(`(${id})`));
    ok(result, `Mesure absente de la page : ${id}`);
    return result;
  }
  async function search(value: string) {
    const input = query<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  function chosen() {
    return [
      ...container.querySelectorAll(".measurement-chosen > li small"),
    ].map((value) => value.textContent!.split(" · ").at(-1)!);
  }
  function unchanged() {
    for (const [source, before] of sources)
      equal(
        JSON.stringify(source),
        before,
        "Séries, valeurs et provenance inchangées",
      );
    equal(
      cursorCalls.length,
      0,
      "La sélection des mesures ne déplace pas le curseur global",
    );
  }
  await render();
  return {
    container,
    query,
    render,
    click,
    button,
    checkbox,
    search,
    chosen,
    unchanged,
    async open() {
      if (!container.querySelector(".measurement-catalog"))
        await click(query(".measurement-catalog-toggle"));
    },
    async dispose() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cases: [
  name: string,
  exercise: (f: Fixture) => Promise<void>,
  initial?: Simulation | null,
][] = [
  [
    "Premier résultat après un affichage vide : trois tensions, y compris sous StrictMode",
    async (f) => {
      equal(
        f.container.querySelector(".measurement-channels"),
        null,
        "Pas de catalogue sans série",
      );
      await f.render(simulation());
      equal(
        f.chosen().join(","),
        "net_entree,net_reference,net_sortie",
        "Trois tensions proposées au premier résultat",
      );
      f.unchanged();
    },
    null,
  ],
  [
    "270 canaux restent tous accessibles par pages de vingt, sans envahir l’affichage initial",
    async (f) => {
      const channels = Array.from({ length: 270 }, (_, index) =>
        curve(`I:R${index}`, `I(R${index})`, "A"),
      );
      await f.render(simulation(channels));
      equal(
        f.container.querySelectorAll(
          '.measurement-results input[type="checkbox"]',
        ).length,
        0,
        "Catalogue initialement replié",
      );
      await f.open();
      const visited = new Set<string>();
      for (let page = 0; page < 14; page++) {
        const inputs = [
          ...f.container.querySelectorAll<HTMLInputElement>(
            '.measurement-results input[type="checkbox"]',
          ),
        ];
        ok(
          inputs.length <= 20 && inputs.length > 0,
          "Au plus vingt mesures par page",
        );
        inputs.forEach((input) =>
          visited.add(input.getAttribute("aria-label")!),
        );
        if (page < 13)
          await f.click(f.button("Suivants", ".measurement-pages button"));
      }
      equal(visited.size, 270, "Aucun canal supprimé par la pagination");
      equal(
        f.button("Suivants", ".measurement-pages button").disabled,
        true,
        "Dernière page explicite",
      );
      ok(
        f
          .query(".measurement-match-count")
          .textContent?.includes("270 résultats sur 270"),
        "Compte total complet",
      );
      f.unchanged();
    },
  ],
  [
    "Recherche, accents, référence et unité se combinent aux filtres et à un état vide explicite",
    async (f) => {
      await f.open();
      await f.search("ÉTAGE ampère");
      equal(
        f.container.querySelectorAll(
          '.measurement-results input[type="checkbox"]',
        ).length,
        1,
        "Accents et casse normalisés",
      );
      f.checkbox("I:Q1.b");
      await f.click(f.button("Tensions", ".measurement-filters button"));
      ok(
        f
          .query(".measurement-no-results")
          .textContent?.includes("Aucune mesure"),
        "Recherche sans résultat expliquée",
      );
      ok(
        f.query(".measurement-match-count").textContent?.includes("0 résultat"),
        "Compte vide annoncé",
      );
      await f.click(f.button("Courants", ".measurement-filters button"));
      await f.search("i:q1.b");
      f.checkbox("I:Q1.b");
      await f.click(f.button("Tous", ".measurement-filters button"));
      await f.search("Référence");
      f.checkbox("net_reference");
      f.unchanged();
    },
  ],
  [
    "Ajouter et retirer une mesure garde les autres choix visibles lorsque la recherche change",
    async (f) => {
      await f.open();
      await f.search("I:Q1.b");
      await f.click(f.checkbox("I:Q1.b"));
      equal(f.chosen().length, 4, "Ajout sans perdre les trois tensions");
      await f.search("aucun résultat attendu");
      equal(f.chosen().length, 4, "Choix indépendants de la recherche");
      const remove = f.query<HTMLButtonElement>(
        '.measurement-chosen button[aria-label*="(net_reference)"]',
      );
      await f.click(remove);
      equal(
        f.chosen().join(","),
        "net_entree,net_sortie,I:Q1.b",
        "Seule la mesure retirée disparaît",
      );
      await f.search("I:Q1.b");
      equal(
        f.checkbox("I:Q1.b").checked,
        true,
        "État choisi retrouvé dans le catalogue",
      );
      f.unchanged();
    },
  ],
  [
    "Actualisation compatible, ordre différent, choix vide et disparition ne réinitialisent pas la sélection ou le focus",
    async (f) => {
      await f.open();
      await f.search("I:Q1.b");
      await f.click(f.checkbox("I:Q1.b"));
      const search = f.query<HTMLInputElement>('input[type="search"]');
      search.focus();
      await f.render(simulation(smallCurves().reverse(), "2".repeat(32)));
      equal(
        document.activeElement,
        search,
        "Focus conservé au rafraîchissement compatible",
      );
      equal(search.value, "I:Q1.b", "Recherche conservée au nouveau calcul");
      equal(f.chosen().length, 4, "Choix conservés après réordonnancement");
      await f.render(
        simulation([smallCurves()[0], smallCurves()[3]], "3".repeat(32)),
      );
      equal(f.chosen().length, 2, "Seuls les canaux disparus sont retirés");
      while (f.container.querySelector(".measurement-chosen button"))
        await f.click(f.query(".measurement-chosen button"));
      await f.render(simulation(smallCurves(), "4".repeat(32)));
      equal(f.chosen().length, 0, "Désélection volontaire respectée");
      await f.render(
        simulation(
          [curve("nouvelle", "Nouvelle tension", "V")],
          "5".repeat(32),
        ),
      );
      equal(
        f.chosen().length,
        0,
        "Aucun ajout implicite après disparition de tous les canaux",
      );
      f.unchanged();
    },
  ],
  [
    "Les couleurs et les libellés relient catalogue, choix et légendes des graphes, même après filtrage et réordonnancement",
    async (f) => {
      const longLabel = `Courant très long — ${"référence de la sortie ".repeat(24)}fin du libellé`;
      const catalog = [
        ...smallCurves().slice(0, 3),
        ...Array.from({ length: 270 }, (_, index) =>
          curve(`I:R${index}`, index === 24 ? longLabel : `I(R${index})`, "A"),
        ),
      ];
      const target = "I:R24";
      await f.render(simulation(catalog));
      await f.open();
      await f.click(f.button("Courants", ".measurement-filters button"));
      await f.click(f.button("Suivants", ".measurement-pages button"));
      await f.click(f.checkbox(target));
      const normalizedColor = (value: string) => {
        const style = document.createElement("span").style;
        style.color = value;
        return style.color;
      };
      const verifyColors = (curves: ScopeCurve[]) => {
        const expected = normalizedColor(
          colors[curves.findIndex((c) => c.id === target) % colors.length],
        );
        const chosen = f.query<HTMLElement>(
          `.measurement-chosen [data-channel-id="${target}"]`,
        );
        const result = f.query<HTMLElement>(
          `.measurement-results [data-channel-id="${target}"] > label`,
        );
        const legend = f.query<HTMLElement>(
          `.measurement-legend [data-channel-id="${target}"] > i`,
        );
        const path = f.query<SVGPathElement>(
          `.lab-scope-chart > svg [data-channel-id="${target}"] path`,
        );
        equal(
          normalizedColor(chosen.style.getPropertyValue("--measurement-color")),
          expected,
          "Couleur du choix issue du catalogue source",
        );
        equal(
          normalizedColor(result.style.getPropertyValue("--measurement-color")),
          expected,
          "Couleur du résultat issue du catalogue source",
        );
        equal(
          normalizedColor(legend.style.background),
          expected,
          "Même couleur dans la légende",
        );
        equal(
          normalizedColor(path.getAttribute("stroke")!),
          expected,
          "Même couleur dans le graphe",
        );
      };
      verifyColors(catalog);
      await f.search("fin du libellé");
      verifyColors(catalog);
      equal(
        f.query(`.measurement-chosen [data-channel-id="${target}"] strong`)
          .textContent,
        longLabel,
        "Libellé choisi complet",
      );
      equal(
        f.query(`.measurement-results [data-channel-id="${target}"] strong`)
          .textContent,
        longLabel,
        "Libellé du résultat complet",
      );
      ok(
        f
          .query(`.measurement-legend [data-channel-id="${target}"] span`)
          .getAttribute("title")
          ?.includes(longLabel),
        "Libellé intégral consultable dans la légende",
      );
      const voltageLegend = f.query('[aria-label="Légende des tensions"]');
      const currentLegend = f.query('[aria-label="Légende des courants"]');
      ok(voltageLegend !== currentLegend, "Légendes V et A distinctes");
      ok(
        !voltageLegend.querySelector(`[data-channel-id="${target}"]`),
        "Le courant reste dans son groupe",
      );
      const reordered = [...catalog].reverse();
      await f.render(simulation(reordered, "6".repeat(32)));
      verifyColors(reordered);
      f.unchanged();
    },
  ],
  [
    "Le sélecteur et ses légendes protègent leur clavier et presse-papiers sans détourner les contrôles natifs",
    async (f) => {
      await f.open();
      const search = f.query<HTMLInputElement>('input[type="search"]');
      equal(document.activeElement, search, "Ouverture focalise la recherche");
      await f.search("I:Q1.b");
      equal(document.activeElement, search, "La saisie conserve son focus");
      const hits = { keydown: 0, copy: 0, cut: 0, paste: 0 };
      const listeners: Record<string, EventListener> = Object.fromEntries(
        Object.keys(hits).map((type) => [
          type,
          () => {
            hits[type as keyof typeof hits]++;
          },
        ]),
      );
      for (const [type, listener] of Object.entries(listeners))
        window.addEventListener(type, listener);
      try {
        const targets = [
          search,
          f.query(".measurement-filters button"),
          f.query(".measurement-legend"),
        ];
        for (const target of targets) {
          for (const options of [
            { key: "Tab" },
            { key: "r" },
            { key: "v" },
            { key: "ArrowLeft" },
            { key: "ArrowRight" },
            { key: "Delete" },
            { key: "a", ctrlKey: true },
            { key: "v", ctrlKey: true },
          ]) {
            const event = new KeyboardEvent("keydown", {
              ...options,
              bubbles: true,
              cancelable: true,
            });
            await act(async () => target.dispatchEvent(event));
            equal(
              event.defaultPrevented,
              false,
              `Comportement natif préservé : ${options.key}`,
            );
          }
          for (const type of ["copy", "cut", "paste"]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            await act(async () => target.dispatchEvent(event));
            equal(
              event.defaultPrevented,
              false,
              `Presse-papiers natif préservé : ${type}`,
            );
          }
        }
        for (const [type, count] of Object.entries(hits))
          equal(
            count,
            0,
            `Le gestionnaire d’édition extérieur ne reçoit pas ${type}`,
          );
        const escape = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        await act(async () => search.dispatchEvent(escape));
        equal(
          escape.defaultPrevented,
          true,
          "Échap est traité pour fermer le catalogue",
        );
        equal(
          f.container.querySelector(".measurement-catalog"),
          null,
          "Catalogue fermé",
        );
        equal(
          document.activeElement,
          f.query(".measurement-catalog-toggle"),
          "Focus rendu à la commande d’ouverture",
        );
        equal(hits.keydown, 0, "Échap local n’annule pas un geste du schéma");
        await f.open();
        equal(
          f.query<HTMLInputElement>('input[type="search"]').value,
          "I:Q1.b",
          "La fermeture ne perd pas la recherche",
        );
        equal(
          document.activeElement,
          f.query('input[type="search"]'),
          "La réouverture focalise la recherche",
        );
      } finally {
        for (const [type, listener] of Object.entries(listeners))
          window.removeEventListener(type, listener);
      }
      f.unchanged();
    },
  ],
  [
    "Retirer la mesure focalisée déplace le focus vers une commande encore présente",
    async (f) => {
      const buttons = [
        ...f.container.querySelectorAll<HTMLButtonElement>(
          ".measurement-chosen button",
        ),
      ];
      equal(buttons.length, 3, "Trois choix initiaux");
      buttons[0].focus();
      await f.click(buttons[0]);
      equal(document.activeElement, buttons[1], "Focus vers le choix suivant");
      buttons[2].focus();
      await f.click(buttons[2]);
      equal(
        document.activeElement,
        buttons[1],
        "Dernier choix retiré : focus vers le précédent",
      );
      await f.click(buttons[1]);
      equal(
        document.activeElement,
        f.query(".measurement-catalog-toggle"),
        "Aucun choix restant : focus vers Ajouter une mesure",
      );
      equal(f.chosen().length, 0, "Tous les retraits demandés sont respectés");
      f.unchanged();
    },
  ],
  [
    "Aucun résultat, OP et erreur sans série restent sans graphe ni CSV avant un premier TRAN",
    async (f) => {
      for (const source of [
        null,
        { ...simulation([]), analysis: { kind: "op" }, time: [] },
        {
          ...simulation([]),
          status: "error",
          time: [],
          log: "Échec indépendant de test",
        },
      ]) {
        await f.render(source);
        equal(
          f.container.querySelector(".lab-scope-chart"),
          null,
          "Pas de graphe sans échantillon",
        );
        equal(
          f.container.querySelector(".measurement-channels"),
          null,
          "Pas de faux catalogue temporel",
        );
        equal(
          f.query<HTMLButtonElement>(".lab-scope-heading > button").disabled,
          true,
          "CSV indisponible sans série",
        );
      }
      await f.render(simulation());
      equal(
        f.chosen().join(","),
        "net_entree,net_reference,net_sortie",
        "Le premier TRAN reste initialisé",
      );
      equal(
        f.query<HTMLButtonElement>(".lab-scope-heading > button").disabled,
        false,
        "CSV disponible après un vrai résultat",
      );
      f.unchanged();
    },
    null,
  ],
  [
    "Une série d’un seul point reste lisible et n’active pas un zoom impossible",
    async (f) => {
      await f.render({
        ...simulation([curve("unique", "Mesure unique", "V", [2.5])]),
        time: [0.3],
      });
      equal(
        f.chosen().join(","),
        "unique",
        "La petite série reste sélectionnable",
      );
      equal(
        f.query(".lab-scope-readout > div:nth-child(2) > strong").textContent,
        "2.5 V",
        "Valeur du seul échantillon réel",
      );
      ok(
        f
          .query(".lab-scope-readout > div:first-child small")
          .textContent?.includes("1 / 1"),
        "Indice ramené au seul point existant",
      );
      equal(
        f.query<HTMLButtonElement>('[aria-label="Agrandir autour du curseur"]')
          .disabled,
        true,
        "Agrandissement indisponible pour un point",
      );
      await f.open();
      await f.search("unique");
      f.checkbox("unique");
      f.unchanged();
    },
    null,
  ],
  [
    "Mesures manquantes, non finies ou tronquées restent indisponibles ; leur CSV contient des cases vides, pas des zéros",
    async (f) => {
      const incomplete = simulation([
        curve("net_manquant", "Mesure incomplète", "V", [2, NaN, Infinity, 3]),
        curve("I:TRONQUE", "Courant tronqué", "A", [0.007]),
        curve("net_zero", "Zéro réellement calculé", "V", [0, 0, 0, 0]),
      ]);
      await f.render(incomplete);
      await f.open();
      await f.search("I:TRONQUE");
      await f.click(f.checkbox("I:TRONQUE"));
      const cells = [
        ...f.container.querySelectorAll(".lab-scope-readout > div"),
      ];
      const displayed = (id: string) =>
        cells
          .find((cell) =>
            cell
              .querySelector("[title]")
              ?.getAttribute("title")
              ?.endsWith(` · ${id}`),
          )
          ?.querySelector("strong")?.textContent;
      equal(
        displayed("net_manquant"),
        "—",
        "NaN n’est pas présenté comme une valeur",
      );
      equal(
        displayed("I:TRONQUE"),
        "—",
        "Échantillon absent non remplacé par zéro",
      );
      equal(
        displayed("net_zero"),
        "0 V",
        "Un zéro calculé reste distinct d’une absence",
      );
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      const anchorPrototype = Object.getPrototypeOf(
        document.createElement("a"),
      );
      const anchorClick = anchorPrototype.click;
      const blobs: Blob[] = [];
      URL.createObjectURL = (blob) => {
        blobs.push(blob as Blob);
        return "blob:missing-measurements-test";
      };
      URL.revokeObjectURL = () => {};
      anchorPrototype.click = () => {};
      try {
        await f.click(f.query(".lab-scope-heading > button"));
        equal(blobs.length, 1, "Export des mesures choisies");
        const rows = (await blobs[0].text())
          .replace(/^\uFEFF/, "")
          .trimEnd()
          .split("\r\n");
        equal(
          rows[2],
          "0.1,,,0",
          "NaN et case tronquée vides, zéro réel conservé",
        );
        equal(rows[3], "0.4,,,0", "Infini non transformé en nombre");
        equal(
          rows[4],
          "1,3,,0",
          "Valeur réelle conservée et fin tronquée vide",
        );
      } finally {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        anchorPrototype.click = anchorClick;
      }
      ok(Number.isNaN(incomplete.curves[0].values[1]), "NaN source conservé");
      equal(incomplete.curves[0].values[2], Infinity, "Infini source conservé");
      equal(
        incomplete.curves[1].values.length,
        1,
        "La série tronquée n’a pas été complétée",
      );
      f.unchanged();
    },
    null,
  ],
  [
    "Le remplacement d’un grand résultat borne la page filtrée et retire uniquement les canaux disparus",
    async (f) => {
      const currents = Array.from({ length: 270 }, (_, index) =>
        curve(`I:RT${index}`, `Courant de test ${index}`, "A"),
      );
      await f.render(simulation([...smallCurves().slice(0, 3), ...currents]));
      await f.open();
      await f.search("courant");
      await f.click(f.button("Courants", ".measurement-filters button"));
      for (let page = 0; page < 13; page++)
        await f.click(f.button("Suivants", ".measurement-pages button"));
      await f.click(f.checkbox("I:RT269"));
      equal(f.chosen().length, 4, "Mesure choisie sur la dernière page");
      const search = f.query<HTMLInputElement>('input[type="search"]');
      search.focus();
      await f.render(
        simulation(
          [smallCurves()[0], currents[0], currents[1]],
          "7".repeat(32),
        ),
      );
      equal(
        document.activeElement,
        search,
        "Focus conservé pendant le remplacement",
      );
      equal(search.value, "courant", "Recherche conservée");
      equal(
        f.container.querySelectorAll(
          '.measurement-results input[type="checkbox"]',
        ).length,
        2,
        "Page ramenée aux résultats existants",
      );
      equal(
        f.container.querySelector(".measurement-pages"),
        null,
        "Pas de page inexistante après réduction",
      );
      ok(
        f
          .query(".measurement-match-count")
          .textContent?.includes("2 résultats sur 3"),
        "Compte recalculé sur le nouveau catalogue",
      );
      equal(
        f.chosen().join(","),
        "net_entree",
        "La mesure encore présente reste choisie, sans ajout implicite",
      );
      f.unchanged();
    },
  ],
  [
    "Les mesures précédentes restent identifiées pendant la recherche et une unité supplémentaire reste accessible via Tous",
    async (f) => {
      const historical = simulation([
        ...smallCurves(),
        curve("P:TEST", "Puissance de test", "W"),
      ]);
      // main transmet stale=true pour un résultat historique après édition,
      // calcul en cours ou échec : le sélecteur ne peut pas distinguer ces causes.
      await f.render(historical, true);
      const warning = f.query(".lab-scope-stale").textContent;
      ok(
        warning?.includes("Mesures précédentes"),
        "Résultat historique identifié",
      );
      await f.open();
      await f.search("P:TEST");
      await f.click(f.button("Tensions", ".measurement-filters button"));
      equal(
        f.container.querySelectorAll(
          '.measurement-results input[type="checkbox"]',
        ).length,
        0,
        "L’unité W n’est pas présentée comme une tension",
      );
      await f.click(f.button("Tous", ".measurement-filters button"));
      await f.click(f.checkbox("P:TEST"));
      ok(
        f.chosen().includes("P:TEST"),
        "Aucune unité supplémentaire supprimée par Tous",
      );
      equal(
        f.query(".lab-scope-stale").textContent,
        warning,
        "La sélection ne réétiquette pas l’historique comme actuel",
      );
      await f.search("I:Q1.b");
      await f.click(f.checkbox("I:Q1.b"));
      equal(
        f.query(".lab-scope-stale").textContent,
        warning,
        "Le message historique reste présent après un autre choix",
      );
      f.unchanged();
    },
  ],
  [
    "Recherche et sélection conservent le curseur, le zoom, les statistiques et le CSV complet",
    async (f) => {
      await f.click(f.query('[aria-label="Agrandir autour du curseur"]'));
      const windowText = f.query(
        ".lab-scope-measurement-heading p",
      ).textContent;
      const cursorText = f.query(
        ".lab-scope-readout > div:first-child",
      ).textContent;
      const stats = f.query(".lab-scope-measurement-values").textContent;
      await f.open();
      await f.search("I:Q1.b");
      await f.click(f.checkbox("I:Q1.b"));
      equal(
        f.query(".lab-scope-measurement-heading p").textContent,
        windowText,
        "Fenêtre conservée",
      );
      equal(
        f.query(".lab-scope-readout > div:first-child").textContent,
        cursorText,
        "Curseur au même échantillon réel",
      );
      equal(
        f.query(".lab-scope-measurement-values").textContent,
        stats,
        "Statistiques de la même courbe inchangées",
      );
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      const anchorPrototype = Object.getPrototypeOf(
        document.createElement("a"),
      );
      const anchorClick = anchorPrototype.click;
      const blobs: Blob[] = [];
      let filename = "";
      URL.createObjectURL = (blob) => {
        blobs.push(blob as Blob);
        return "blob:measurement-export-test";
      };
      URL.revokeObjectURL = () => {};
      anchorPrototype.click = function (this: HTMLAnchorElement) {
        filename = this.download;
      };
      try {
        await f.click(f.query(".lab-scope-heading > button"));
        equal(blobs.length, 1, "Un export produit");
        const csv = (await blobs[0].text()).replace(/^\uFEFF/, "");
        const rows = csv.trimEnd().split("\r\n");
        equal(rows.length, 5, "Toutes les lignes conservées malgré le zoom");
        equal(
          rows[2],
          "0.1,1,0.5,0.25,0.002",
          "Échantillon exact, sans interpolation ni remplacement",
        );
        equal(
          rows[4],
          "1,5,2.5,1.25,0.005",
          "Dernier échantillon réel conservé",
        );
        equal(
          filename,
          "oscilloscope-revision-7.csv",
          "Révision source de l’export conservée",
        );
      } finally {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        anchorPrototype.click = anchorClick;
      }
      f.unchanged();
    },
  ],
];

async function run() {
  const nativeFetch = globalThis.fetch;
  let networkCalls = 0,
    passed = 0;
  globalThis.fetch = (async () => {
    networkCalls++;
    throw new Error("Aucun service réseau autorisé dans ce scénario");
  }) as typeof fetch;
  try {
    for (const [name, exercise, initial] of cases) {
      const row = document.createElement("li");
      row.textContent = name;
      document.querySelector("#results")!.append(row);
      let current: Fixture | undefined;
      try {
        current = await fixture(initial === undefined ? simulation() : initial);
        await exercise(current);
        equal(networkCalls, 0, "Aucun accès au réseau");
        passed++;
        row.className = "pass";
        row.textContent = `✓ ${name}`;
        console.log(
          "MEASUREMENT_WORKBENCH_CASE",
          JSON.stringify({ name, status: "passed" }),
        );
      } catch (error) {
        row.className = "fail";
        row.textContent = `✗ ${name}`;
        const pre = document.createElement("pre");
        pre.textContent = String(error);
        row.append(pre);
        console.log(
          "MEASUREMENT_WORKBENCH_CASE",
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
    "MEASUREMENT_WORKBENCH_RESULT",
    JSON.stringify({ passed, total: cases.length, networkCalls, status }),
  );
}
void run().catch((error) => {
  document.querySelector<HTMLElement>("#app")!.dataset.runStatus = "failed";
  const summary = document.querySelector<HTMLElement>("#summary")!;
  summary.dataset.runStatus = "failed";
  summary.textContent = `Échec : ${String(error)}`;
  console.log(
    "MEASUREMENT_WORKBENCH_RESULT",
    JSON.stringify({ status: "failed", error: String(error) }),
  );
});
