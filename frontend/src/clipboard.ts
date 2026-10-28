import type { CircuitDrawing } from "./editing";
import type { Component, Project, State, VoltageWaveform, Wire } from "./types";

export const CIRCUIT_CLIPBOARD_MIME = "application/x-atelier-circuit+json";
const FORMAT = "atelier.circuit-fragment";
const MAX_BYTES = 1_000_000;
export type CircuitFragment = CircuitDrawing & {
  format: typeof FORMAT;
  version: 1;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value);
const invalid = (): never => {
  throw new Error(
    "Le fragment de circuit est incomplet ou contient des données invalides.",
  );
};

function checkSize(fragment: CircuitFragment): void {
  const operations =
    fragment.components.length +
    fragment.components.filter((c) => fragment.schematic[c.id].rotation)
      .length +
    fragment.junctions.length +
    fragment.wires.length +
    fragment.wires.filter((w) => w.color || w.waypoints?.length).length;
  // Une opération supplémentaire sélectionne le résultat du collage.
  if (operations > 499)
    throw new Error(
      "Cette sélection est trop grande pour un collage. Copie une portion plus petite.",
    );
}

function componentFields(component: Component): Component {
  const copy: Component = {
    id: component.id,
    kind: component.kind,
    label: component.label,
    value: component.value,
    pins: { ...component.pins },
  };
  if (component.model) copy.model = component.model;
  if (component.kind === "capacitor" && component.initial_voltage !== undefined)
    copy.initial_voltage = component.initial_voltage;
  if (component.kind === "potentiometer" && component.position !== undefined)
    copy.position = component.position;
  if (component.kind === "voltage_source" && component.waveform !== undefined) {
    const waveform = component.waveform;
    copy.waveform =
      waveform === null
        ? null
        : {
            kind: waveform.kind,
            low: waveform.low,
            high: waveform.high,
            delay: waveform.delay,
            rise: waveform.rise,
            fall: waveform.fall,
            width: waveform.width,
            period: waveform.period,
          };
  }
  return copy;
}

/** Un instantané explicite : aucune implantation, mesure ou métadonnée privée. */
export function serializeCircuitFragment(
  project: Project,
  selected: readonly string[],
): string | null {
  const selection = new Set(selected);
  const components = project.components
    .filter((c) => selection.has(c.id))
    .map(componentFields);
  const junctions = project.junctions
    .filter((j) => selection.has(j.id))
    .map(({ id, x, y }) => ({ id, x, y }));
  if (!components.length && !junctions.length) return null;
  const terminals = new Set([
    ...components.flatMap((c) => Object.values(c.pins)),
    ...junctions.map((j) => j.id),
  ]);
  const wires = project.wires
    .filter((w) => terminals.has(w.a) && terminals.has(w.b))
    .map((wire): Wire => ({
      id: wire.id,
      a: wire.a,
      b: wire.b,
      ...(wire.color ? { color: wire.color } : {}),
      ...(wire.waypoints?.length
        ? { waypoints: wire.waypoints.map(({ x, y }) => ({ x, y })) }
        : {}),
    }));
  if (
    new Set(wires.map((wire) => JSON.stringify([wire.a, wire.b].sort())))
      .size !== wires.length
  )
    throw new Error(
      "Cette portion contient plusieurs fils reliant les mêmes bornes. Retire les doublons avant de copier.",
    );
  const fragment: CircuitFragment = {
    format: FORMAT,
    version: 1,
    components,
    junctions,
    wires,
    schematic: Object.fromEntries(
      components.map(({ id }) => {
        const { x, y, rotation = 0 } = project.schematic[id];
        return [id, { x, y, rotation }];
      }),
    ),
  };
  checkSize(fragment);
  const text = JSON.stringify(fragment);
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new Error(
      "Le fragment dépasse la taille maximale du presse-papiers de l’atelier.",
    );
  return text;
}

function waveformFields(value: unknown): VoltageWaveform | null {
  if (value === null) return null;
  if (!record(value) || value.kind !== "pulse") return invalid();
  const { low, high, delay, rise, fall, width, period } = value;
  if (![low, high, delay, rise, fall, width, period].every(finite))
    return invalid();
  const pulse = {
    kind: "pulse",
    low,
    high,
    delay,
    rise,
    fall,
    width,
    period,
  } as VoltageWaveform;
  if (
    Math.abs(pulse.low) > 1e6 ||
    Math.abs(pulse.high) > 1e6 ||
    pulse.delay < 0 ||
    [pulse.rise, pulse.fall, pulse.width, pulse.period].some((v) => v <= 0) ||
    pulse.rise + pulse.width + pulse.fall > pulse.period * (1 + 1e-12)
  )
    return invalid();
  return pulse;
}

/** Les textes ordinaires restent au navigateur. Seul notre format est interprété. */
export function parseCircuitFragment(
  text: string,
  catalog: State["catalog"],
): CircuitFragment | null {
  const appearsOurs =
    /^\s*\{[\s\S]*?"format"\s*:\s*"atelier\.circuit-fragment"/.test(
      text.slice(0, 4096),
    );
  if (text.length > MAX_BYTES) {
    if (appearsOurs)
      throw new Error("Le fragment est trop volumineux pour être collé.");
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    if (appearsOurs) return invalid();
    return null;
  }
  if (!record(data) || data.format !== FORMAT) return null;
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return invalid();
  if (data.version !== 1)
    throw new Error("Cette version de fragment n’est pas prise en charge.");
  if (
    !Array.isArray(data.components) ||
    data.components.length > 300 ||
    !Array.isArray(data.junctions) ||
    data.junctions.length > 499 ||
    !Array.isArray(data.wires) ||
    data.wires.length > 499 ||
    !record(data.schematic)
  )
    return invalid();
  const used = new Set<string>();
  const claim = (id: unknown): string => {
    if (!identifier(id) || used.has(id)) return invalid();
    used.add(id);
    return id;
  };
  const components: Component[] = [];
  const schematic: CircuitDrawing["schematic"] = Object.create(null);
  const terminals = new Set<string>();
  for (const raw of data.components) {
    if (
      !record(raw) ||
      typeof raw.kind !== "string" ||
      !Object.hasOwn(catalog, raw.kind)
    )
      return invalid();
    const id = claim(raw.id);
    const entry = catalog[raw.kind];
    if (
      !finite(raw.value) ||
      typeof raw.label !== "string" ||
      raw.label.length > 160 ||
      !record(raw.pins)
    )
      return invalid();
    const pins: Record<string, string> = {};
    if (Object.keys(raw.pins).length !== entry.pins.length) return invalid();
    for (const pin of entry.pins) {
      const terminal = `${id}.${pin.name}`;
      if (raw.pins[pin.name] !== terminal) return invalid();
      if (used.has(terminal)) return invalid();
      used.add(terminal);
      pins[pin.name] = terminal;
      terminals.add(terminal);
    }
    const component: Component = {
      id,
      kind: raw.kind,
      label: raw.label,
      value: raw.value,
      pins,
    };
    if (raw.model !== undefined && raw.model !== null) {
      if (
        typeof raw.model !== "string" ||
        !entry.models.some((model) => model.id === raw.model)
      )
        return invalid();
      component.model = raw.model;
    }
    if (raw.initial_voltage !== undefined) {
      if (raw.kind !== "capacitor" || !finite(raw.initial_voltage))
        return invalid();
      component.initial_voltage = raw.initial_voltage;
    }
    if (raw.position !== undefined) {
      if (
        raw.kind !== "potentiometer" ||
        !finite(raw.position) ||
        raw.position < 0 ||
        raw.position > 1
      )
        return invalid();
      component.position = raw.position;
    }
    if (raw.waveform !== undefined) {
      if (raw.kind !== "voltage_source") return invalid();
      component.waveform = waveformFields(raw.waveform);
    }
    const position = data.schematic[id];
    if (
      !record(position) ||
      !finite(position.x) ||
      !finite(position.y) ||
      (position.rotation !== undefined &&
        (!finite(position.rotation) || position.rotation % 90 !== 0))
    )
      return invalid();
    schematic[id] = {
      x: position.x,
      y: position.y,
      rotation: ((position.rotation as number) || 0) % 360,
    };
    components.push(component);
  }
  const junctions = data.junctions.map((raw) => {
    if (!record(raw) || !finite(raw.x) || !finite(raw.y)) return invalid();
    const id = claim(raw.id);
    terminals.add(id);
    return { id, x: raw.x, y: raw.y };
  });
  if (!components.length && !junctions.length) return invalid();
  const pairs = new Set<string>();
  const wires: Wire[] = data.wires.map((raw) => {
    if (
      !record(raw) ||
      typeof raw.a !== "string" ||
      typeof raw.b !== "string" ||
      !terminals.has(raw.a) ||
      !terminals.has(raw.b) ||
      raw.a === raw.b
    )
      return invalid();
    const id = claim(raw.id);
    const pair = JSON.stringify([raw.a, raw.b].sort());
    if (pairs.has(pair))
      throw new Error(
        "Le fragment contient plusieurs fils reliant les mêmes bornes. Retire les doublons avant de copier.",
      );
    pairs.add(pair);
    const wire: Wire = { id, a: raw.a, b: raw.b };
    if (raw.color !== undefined && raw.color !== null) {
      if (typeof raw.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(raw.color))
        return invalid();
      wire.color = raw.color;
    }
    if (raw.waypoints !== undefined) {
      if (!Array.isArray(raw.waypoints) || raw.waypoints.length > 32)
        return invalid();
      wire.waypoints = raw.waypoints.map((point) => {
        if (
          !record(point) ||
          !finite(point.x) ||
          !finite(point.y) ||
          Math.abs(point.x) > 1e6 ||
          Math.abs(point.y) > 1e6
        )
          return invalid();
        return { x: point.x, y: point.y };
      });
    }
    return wire;
  });
  const fragment: CircuitFragment = {
    format: FORMAT,
    version: 1,
    components,
    junctions,
    wires,
    schematic,
  };
  checkSize(fragment);
  return fragment;
}

export function fragmentPasteOffset(
  fragment: CircuitFragment,
  anchor: { x: number; y: number },
): { x: number; y: number } {
  const positions = [
    ...Object.values(fragment.schematic),
    ...fragment.junctions,
  ];
  const xs = positions.map((p) => p.x),
    ys = positions.map((p) => p.y);
  return {
    x: anchor.x - (Math.min(...xs) / 2 + Math.max(...xs) / 2),
    y: anchor.y - (Math.min(...ys) / 2 + Math.max(...ys) / 2),
  };
}
