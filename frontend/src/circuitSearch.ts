import type { State } from "./types";
import { format, pinPoints } from "./types";

export type CircuitSearchTarget = {
  key: string;
  id: string;
  kind: "component" | "wire" | "junction" | "net";
  label: string;
  detail: string;
  selected: string[];
  highlights: string[];
  points: { x: number; y: number }[];
  searchText: string;
  /** Textes normalisés partagés entre les objets raccordés au même réseau. */
  relatedText?: readonly string[];
};

const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[µμ]/g, "u")
    .replace(/[ΩΩ]/g, "ohm")
    .replace(/(\d),(\d)/g, "$1.$2")
    .toLowerCase()
    .trim();
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
type Point = { x: number; y: number };
const points = (candidates: readonly (Point | undefined)[]): Point[] => {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const point of candidates) {
    if (!point || !finite(point.x) || !finite(point.y)) continue;
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ x: point.x, y: point.y });
  }
  return result;
};

/** Index de navigation local : aucune mesure et aucune modification du circuit. */
export function buildCircuitSearchIndex(state: State): CircuitSearchTarget[] {
  const project = state.project;
  const coordinates = pinPoints(project);
  const logicalIds = new Set([
    ...project.components.flatMap((component) => Object.values(component.pins)),
    ...project.junctions.map((junction) => junction.id),
  ]);
  const geometry = new Map<string, Point>();
  // pinPoints propose un repli visuel pour les positions absentes. La recherche
  // ne cadre que les positions réellement connues dans le schéma.
  for (const component of project.components) {
    const position = project.schematic[component.id];
    if (!position || !finite(position.x) || !finite(position.y)) continue;
    for (const terminal of Object.values(component.pins)) {
      const coordinate = coordinates[terminal];
      if (coordinate && finite(coordinate[0]) && finite(coordinate[1]))
        geometry.set(terminal, { x: coordinate[0], y: coordinate[1] });
    }
  }
  for (const junction of project.junctions)
    if (finite(junction.x) && finite(junction.y))
      geometry.set(junction.id, { x: junction.x, y: junction.y });

  const nets = new Map(state.topology.nets.map((net) => [net.id, net]));
  const pointToNet = new Map(
    state.topology.nets.flatMap((net) =>
      net.points.map((point) => [point, net.id] as const),
    ),
  );
  const aliases = new Map<string, string[]>();
  for (const [target, label] of Object.entries(project.net_labels || {})) {
    const netId =
      state.topology.terminal_to_net[target] ||
      pointToNet.get(target) ||
      (nets.has(target) ? target : undefined);
    if (!netId || !label.trim()) continue;
    const names = aliases.get(netId) || [];
    if (!names.includes(label)) names.push(label);
    aliases.set(netId, names);
  }
  const normalizedNetWords = new Map<string, string>();
  const netWords = (id: string): string => {
    let text = normalizedNetWords.get(id);
    if (text === undefined) {
      text = normalize(
        [id, nets.get(id)?.name, ...(aliases.get(id) || [])]
          .filter(Boolean)
          .join(" "),
      );
      normalizedNetWords.set(id, text);
    }
    return text;
  };
  const connectedText = (terminals: readonly string[]): readonly string[] =>
    [
      ...new Set(
        terminals
          .map(
            (terminal) =>
              state.topology.terminal_to_net[terminal] ||
              pointToNet.get(terminal),
          )
          .filter((id): id is string => !!id),
      ),
    ].map(netWords);
  const index: CircuitSearchTarget[] = [];
  const add = (
    target: Omit<CircuitSearchTarget, "key" | "searchText">,
    words: readonly string[],
  ) => {
    index.push({
      ...target,
      key: `${target.kind}:${target.id}`,
      searchText: normalize(
        [target.kind, target.id, target.label, target.detail, ...words].join(
          " ",
        ),
      ),
    });
  };
  const ownerWords = new Map<string, string>();
  for (const component of project.components) {
    const catalog = Object.hasOwn(state.catalog, component.kind)
      ? state.catalog[component.kind]
      : undefined;
    const name = catalog?.name || component.kind;
    const value = format(component.value, catalog?.unit || "").trim();
    const model =
      catalog?.models.find((entry) => entry.id === component.model)?.label ||
      "";
    const label = component.label.trim();
    const terminals = Object.values(component.pins);
    const words = [
      "composant",
      component.kind,
      name,
      component.model || "",
      model,
      String(component.value),
      component.value.toExponential(),
      value.replace(/\s/g, ""),
      ...terminals,
      component.waveform?.kind || "",
    ];
    if (component.kind === "inductor") words.push("bobine self");
    for (const terminal of terminals)
      ownerWords.set(terminal, `${component.id} ${label} ${name}`);
    add(
      {
        kind: "component",
        id: component.id,
        label:
          label && label !== component.id
            ? `${component.id} · ${label}`
            : component.id,
        detail: `${name} · ${value}`,
        selected: [component.id],
        highlights: [],
        relatedText: connectedText(terminals),
        points: points([project.schematic[component.id]]),
      },
      words,
    );
  }
  for (const wire of project.wires)
    add(
      {
        kind: "wire",
        id: wire.id,
        label: wire.id,
        detail: `${wire.a} ↔ ${wire.b}`,
        selected: [wire.id],
        highlights: [],
        relatedText: connectedText([wire.a, wire.b]),
        points: points([
          geometry.get(wire.a),
          ...(wire.waypoints || []),
          geometry.get(wire.b),
        ]),
      },
      [
        "fil câble liaison",
        wire.a,
        wire.b,
        ownerWords.get(wire.a) || "",
        ownerWords.get(wire.b) || "",
      ],
    );
  for (const junction of project.junctions)
    add(
      {
        kind: "junction",
        id: junction.id,
        label: junction.id,
        detail: "Jonction du schéma",
        selected: [junction.id],
        highlights: [],
        relatedText: connectedText([junction.id]),
        points: points([junction]),
      },
      ["jonction"],
    );
  for (const net of state.topology.nets) {
    const members = net.points.filter((id) => logicalIds.has(id));
    const geometryPoints = points(net.points.map((id) => geometry.get(id)));
    // Une bande métallique vide ne constitue pas une destination du schéma.
    if (!members.length && !geometryPoints.length) continue;
    const names = [
      ...new Set(
        [net.name, ...(aliases.get(net.id) || [])].filter(
          (name): name is string => !!name?.trim(),
        ),
      ),
    ];
    const name = names[0];
    add(
      {
        kind: "net",
        id: net.id,
        label: name && name !== net.id ? `${net.id} · ${name}` : net.id,
        detail: `Réseau · ${members.length} point${members.length === 1 ? "" : "s"}${names.length > 1 ? ` · ${names.slice(1, 3).join(" · ")}` : ""}${names.length > 3 ? ` · +${names.length - 3} noms` : ""}`,
        selected: [],
        highlights: [net.id],
        points: geometryPoints,
        relatedText: [netWords(net.id)],
      },
      [
        "réseau connexion",
        ...members,
        ...members.map((id) => ownerWords.get(id) || ""),
      ],
    );
  }
  return index;
}

/** Tous les mots doivent correspondre ; l'identifiant exact reste prioritaire. */
export function searchCircuitTargets(
  index: readonly CircuitSearchTarget[],
  query: string,
  limit = 60,
): CircuitSearchTarget[] {
  const bound = finite(limit) ? Math.max(0, Math.trunc(limit)) : 60;
  if (!bound) return [];
  const normalized = normalize(query);
  const words = normalized.split(/\s+/).filter(Boolean);
  const relatedMatches = new Map<string, readonly boolean[]>();
  const matchesRelated = (text: string, wordIndex: number): boolean => {
    let matches = relatedMatches.get(text);
    if (!matches) {
      matches = words.map((word) => text.includes(word));
      relatedMatches.set(text, matches);
    }
    return matches[wordIndex];
  };
  return index
    .map((target, position) => ({ target, position }))
    .filter(({ target }) =>
      words.every(
        (word, wordIndex) =>
          target.searchText.includes(word) ||
          target.relatedText?.some((text) => matchesRelated(text, wordIndex)),
      ),
    )
    .map(({ target, position }) => ({
      target,
      position,
      rank:
        !normalized || normalize(target.id) === normalized
          ? 0
          : normalize(target.id).startsWith(normalized) ||
              normalize(target.label).startsWith(normalized)
            ? 1
            : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .slice(0, bound)
    .map(({ target }) => target);
}
