import type { Project } from "./types";
import { pinOffsets, pinPoints } from "./types";
/** Les liaisons par bandes restent visibles même sans fil schématique explicite. */
export function boardLinks(p: Project) {
  const parent = new Map<string, string>();
  const root = (x: string): string => {
    const prev = parent.get(x);
    if (!prev) {
      parent.set(x, x);
      return x;
    }
    if (prev === x) return x;
    const r = root(prev);
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  for (const w of p.wires) join(w.a, w.b);
  const grounds = p.components
    .filter((c) => c.kind === "ground")
    .map((c) => c.pins.g);
  for (const g of grounds.slice(1)) join(grounds[0], g);
  const groups = new Map<string, string[]>();
  for (const [terminal, hole] of Object.entries(p.breadboard.placements)) {
    const matrix = /^([a-j])(\d+)$/.exec(hole);
    const rail = /^rail_(top|bottom)_([pn])(\d+)$/.exec(hole);
    const group = matrix
      ? `${matrix[1] < "f" ? "AE" : "FJ"}${matrix[2]}`
      : rail
        ? `${rail[1]}_${rail[2]}_${p.breadboard.rail_splits && Number(rail[3]) > 15 ? 2 : 1}`
        : hole;
    groups.set(group, [...(groups.get(group) || []), terminal]);
  }
  const links: { a: string; b: string; group: string }[] = [];
  for (const [group, members] of groups) {
    const a = members[0];
    for (const b of members.slice(1)) {
      if (root(a) !== root(b)) {
        links.push({ a, b, group });
        join(a, b);
      }
    }
  }
  return links;
}
function direction(p: Project, terminal: string): [number, number] {
  for (const c of p.components) {
    const pin = Object.entries(c.pins).find(([, id]) => id === terminal);
    if (!pin) continue;
    const d = pinOffsets(c)[pin[0]],
      r = ((p.schematic[c.id]?.rotation || 0) * Math.PI) / 180;
    const x = d[0] * Math.cos(r) - d[1] * Math.sin(r),
      y = d[0] * Math.sin(r) + d[1] * Math.cos(r),
      len = Math.hypot(x, y) || 1;
    return [x / len, y / len];
  }
  return [0, 0];
}
export function wirePath(
  p: Project,
  aId: string,
  bId: string,
  points = pinPoints(p),
  waypoints?: { x: number; y: number }[],
): string {
  const a = points[aId],
    b = points[bId];
  if (!a || !b || ![...a, ...b].every(Number.isFinite)) return "";
  const custom = Array.isArray(waypoints)
    ? waypoints
        .slice(0, 32)
        .filter(
          (point) =>
            point &&
            typeof point.x === "number" &&
            typeof point.y === "number" &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            Math.abs(point.x) <= 1e6 &&
            Math.abs(point.y) <= 1e6,
        )
    : [];
  if (custom.length) {
    const cardinal = (vector: [number, number]): [number, number] =>
      Math.abs(vector[0]) > Math.abs(vector[1])
        ? [Math.sign(vector[0]), 0]
        : [0, Math.sign(vector[1])];
    const startDirection = cardinal(direction(p, aId));
    const endDirection = cardinal(direction(p, bId));
    const start: [number, number] = [
      a[0] + startDirection[0] * 24,
      a[1] + startDirection[1] * 24,
    ];
    const end: [number, number] = [
      b[0] + endDirection[0] * 24,
      b[1] + endDirection[1] * 24,
    ];
    let path = `M${a}`;
    let previous: [number, number] = [a[0], a[1]];
    const append = (target: [number, number], horizontalFirst = true) => {
      if (horizontalFirst) {
        if (previous[0] !== target[0]) path += `H${target[0]}`;
        if (previous[1] !== target[1]) path += `V${target[1]}`;
      } else {
        if (previous[1] !== target[1]) path += `V${target[1]}`;
        if (previous[0] !== target[0]) path += `H${target[0]}`;
      }
      previous = target;
    };
    append(start);
    custom.forEach((point, index) =>
      append([point.x, point.y], index !== 0 || startDirection[0] !== 0),
    );
    // Reach the last lead perpendicular to its outgoing direction so the
    // final segment meets the terminal along its local axis.
    append(end, endDirection[0] === 0);
    append([b[0], b[1]]);
    return path;
  }
  const ad = direction(p, aId),
    bd = direction(p, bId),
    a1 = [a[0] + ad[0] * 24, a[1] + ad[1] * 24],
    b1 = [b[0] + bd[0] * 24, b[1] + bd[1] * 24];
  if (Math.abs(a[1] - b[1]) < 2 && ad[0] * bd[0] < 0) return `M${a}L${b}`;
  if (Math.abs(a[0] - b[0]) < 2 && ad[1] * bd[1] < 0) return `M${a}L${b}`;
  if (Math.abs(a[1] - b[1]) < 30 && ad[0] * bd[0] > 0) {
    const y = Math.min(a[1], b[1]) - 65;
    return `M${a}L${a1}V${y}H${b1[0]}V${b1[1]}L${b}`;
  }
  return `M${a}L${a1}H${(a1[0] + b1[0]) / 2}V${b1[1]}H${b1[0]}L${b}`;
}
