import type { Op, Project } from "./types";

export type SelectionBox = { x1: number; y1: number; x2: number; y2: number };
export type DuplicateSelection = { operations: Op[]; selected: string[] };

function finitePoint(point: { x: number; y: number } | undefined): boolean {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Les déplacements groupés conservent les positions de plaque et les fils. */
export function moveSelectionOperations(
  project: Project,
  selected: readonly string[],
  dx: number,
  dy: number,
): Op[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return [];
  const selection = new Set(selected);
  const operations: Op[] = [];
  const movedPoints = new Set<string>();
  for (const component of project.components) {
    if (!selection.has(component.id)) continue;
    const position = project.schematic[component.id];
    if (!finitePoint(position)) continue;
    const x = position.x + dx;
    const y = position.y + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    operations.push({ type: "move_component", id: component.id, x, y });
    Object.values(component.pins).forEach((terminal) =>
      movedPoints.add(terminal),
    );
  }
  for (const junction of project.junctions || []) {
    if (!selection.has(junction.id) || !finitePoint(junction)) continue;
    const x = junction.x + dx;
    const y = junction.y + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    operations.push({ type: "move_junction", id: junction.id, x, y });
    movedPoints.add(junction.id);
  }
  for (const wire of project.wires) {
    if (
      !wire.waypoints?.length ||
      !movedPoints.has(wire.a) ||
      !movedPoints.has(wire.b)
    )
      continue;
    const waypoints = wire.waypoints.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    }));
    if (
      waypoints.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    )
      return [];
    operations.push({ type: "set_wire_style", id: wire.id, waypoints });
  }
  return operations;
}

/** Inclut les centres sur les bords ; le sens de tracé du rectangle est libre. */
export function selectedInBox(
  project: Project,
  rectangle: SelectionBox,
): string[] {
  if (!Object.values(rectangle).every(Number.isFinite)) return [];
  const left = Math.min(rectangle.x1, rectangle.x2);
  const right = Math.max(rectangle.x1, rectangle.x2);
  const top = Math.min(rectangle.y1, rectangle.y2);
  const bottom = Math.max(rectangle.y1, rectangle.y2);
  const inside = (position: { x: number; y: number } | undefined) =>
    finitePoint(position) &&
    position!.x >= left &&
    position!.x <= right &&
    position!.y >= top &&
    position!.y <= bottom;
  return [
    ...project.components
      .filter((component) => inside(project.schematic[component.id]))
      .map((component) => component.id),
    ...(project.junctions || []).filter(inside).map((junction) => junction.id),
  ];
}

/** Recrée les objets et leurs fils internes, sans connexions externes ni
 * implantation. Les masses restent la référence 0 V commune du modèle. */
export function duplicateSelectionOperations(
  project: Project,
  selected: readonly string[],
  offset: { x: number; y: number } = { x: 30, y: 30 },
): DuplicateSelection {
  const empty = (): DuplicateSelection => ({ operations: [], selected: [] });
  if (!finitePoint(offset)) return empty();
  const selection = new Set(selected);
  const components = project.components.filter((component) =>
    selection.has(component.id),
  );
  const junctions = (project.junctions || []).filter((junction) =>
    selection.has(junction.id),
  );
  if (!components.length && !junctions.length) return empty();
  const used = new Set([
    ...project.components.flatMap((component) => [
      component.id,
      ...Object.values(component.pins),
    ]),
    ...project.wires.map((wire) => wire.id),
    ...(project.junctions || []).map((junction) => junction.id),
  ]);
  const fresh = (original: string, pins: readonly string[] = []): string => {
    // Leave room for terminal suffixes and the numeric collision suffix.
    const stem = original.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 56);
    const safeStem = /^[A-Za-z]/.test(stem) ? stem : `C_${stem}`;
    let suffix = 1;
    let candidate = `${safeStem}_copy`;
    while (
      used.has(candidate) ||
      pins.some((pin) => used.has(`${candidate}.${pin}`))
    ) {
      suffix += 1;
      candidate = `${safeStem}_copy${suffix}`;
    }
    used.add(candidate);
    for (const pin of pins) used.add(`${candidate}.${pin}`);
    return candidate;
  };
  const operations: Op[] = [];
  const copies: string[] = [];
  const terminalCopies = new Map<string, string>();
  for (const component of components) {
    const position = project.schematic[component.id];
    if (!finitePoint(position)) return empty();
    const x = position.x + offset.x;
    const y = position.y + offset.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return empty();
    const id = fresh(component.id, Object.keys(component.pins));
    const extended = component as typeof component & {
      position?: number;
      initial_voltage?: number;
      waveform?: null | {
        kind: "pulse";
        low: number;
        high: number;
        delay: number;
        rise: number;
        fall: number;
        width: number;
        period: number;
      };
    };
    const operation: Op = {
      type: "add_component",
      kind: component.kind,
      id,
      value: component.value,
      label: component.label === component.id ? id : component.label,
      x,
      y,
    };
    if (component.model) operation.model = component.model;
    if (extended.position !== undefined) operation.position = extended.position;
    if (extended.initial_voltage !== undefined)
      operation.initial_voltage = extended.initial_voltage;
    if (
      component.kind === "voltage_source" &&
      extended.waveform !== undefined
    ) {
      const waveform = extended.waveform;
      operation.waveform =
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
    operations.push(operation);
    if (position.rotation)
      operations.push({
        type: "move_component",
        id,
        x,
        y,
        rotation: position.rotation,
      });
    copies.push(id);
    for (const [name, terminal] of Object.entries(component.pins))
      terminalCopies.set(terminal, `${id}.${name}`);
  }
  for (const junction of junctions) {
    const x = junction.x + offset.x;
    const y = junction.y + offset.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return empty();
    const id = fresh(junction.id);
    operations.push({ type: "add_junction", id, x, y });
    terminalCopies.set(junction.id, id);
    copies.push(id);
  }
  for (const wire of project.wires) {
    const a = terminalCopies.get(wire.a);
    const b = terminalCopies.get(wire.b);
    if (!a || !b) continue;
    const id = fresh(wire.id);
    operations.push({ type: "connect", id, a, b });
    const styled = wire as typeof wire & {
      color?: string | null;
      waypoints?: { x: number; y: number }[];
    };
    if (styled.color || styled.waypoints?.length) {
      const style: Op = { type: "set_wire_style", id };
      if (styled.color) style.color = styled.color;
      if (styled.waypoints?.length)
        style.waypoints = styled.waypoints.map((point) => ({
          x: point.x + offset.x,
          y: point.y + offset.y,
        }));
      operations.push(style);
    }
    copies.push(id);
  }
  return { operations, selected: copies };
}

/** La rotation change le dessin et conserve les identifiants des bornes et fils. */
export function rotationOperations(
  project: Project,
  selected: readonly string[],
  direction: 1 | -1 = 1,
): Op[] {
  return project.components
    .filter((c) => selected.includes(c.id))
    .map((c) => {
      const position = project.schematic[c.id];
      return {
        type: "move_component",
        id: c.id,
        x: position.x,
        y: position.y,
        rotation:
          ((((position.rotation || 0) + 90 * direction) % 360) + 360) % 360,
      };
    });
}
