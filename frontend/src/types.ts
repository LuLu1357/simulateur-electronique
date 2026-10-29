export type VoltageWaveform = {
  kind: "pulse";
  low: number;
  high: number;
  delay: number;
  rise: number;
  fall: number;
  width: number;
  period: number;
};
export type Component = {
  id: string;
  kind: string;
  label: string;
  value: number;
  position?: number;
  initial_voltage?: number;
  waveform?: VoltageWaveform | null;
  model?: string;
  pins: Record<string, string>;
};
export type Wire = {
  id: string;
  a: string;
  b: string;
  kind?: string;
  origin?: string;
  color?: string | null;
  waypoints?: { x: number; y: number }[];
};
export type Project = {
  net_labels?: Record<string, string>;
  description?: string;
  breadboard_note?: string;
  default_analysis?: { kind: string; step?: number; stop?: number };
  schema_version: number;
  id: string;
  title: string;
  revision: number;
  components: Component[];
  wires: Wire[];
  junctions: { id: string; x: number; y: number }[];
  schematic: Record<string, { x: number; y: number; rotation?: number }>;
  breadboard: {
    board_count?: number;
    placements: Record<string, string>;
    rail_splits: boolean;
    footprints?: Record<
      string,
      {
        kind: string;
        pins: Record<string, string>;
        package: string;
        orientation: string;
      }
    >;
    layout?: {
      version: number;
      algorithm: string;
      component_count: number;
      external_count: number;
      added_jumpers: string[];
      note: string;
    };
  };
  ui: {
    selected: string[];
    view: string;
    highlights: unknown[];
    annotations: { id?: string; text: string; targets?: string[] }[];
  };
};
export type Diagnostic = {
  category?: string;
  severity?: string;
  message?: string;
  explanation?: string;
  code?: string;
  targets?: string[];
  components?: string[];
  [key: string]: unknown;
};
export type Simulation = {
  simulation_id?: string;
  sample_index?: number;
  sample_time?: number;
  sample_count?: number;
  wire_currents?: Record<string, number | null>;
  wire_current_status?: Record<string, string>;
  wire_flow_hints?: Record<string, number | null>;
  flow_legend?: string;
  terminal_currents?: Record<string, Record<string, number>>;
  status: string;
  project_revision: number;
  voltages: Record<string, number>;
  currents: Record<string, number>;
  time: number[];
  curves: { id: string; label: string; unit: string; values: number[] }[];
  diagnostics: Diagnostic[];
  log: string;
  netlist: string;
  assumptions: string[];
  stale?: boolean;
  last_success?: Simulation;
  [key: string]: unknown;
};
export type State = {
  last_success?: Simulation | null;
  running?: boolean;
  project: Project;
  topology: {
    nets: { id: string; points: string[]; holes?: string[]; name?: string }[];
    terminal_to_net: Record<string, string>;
    hole_to_net: Record<string, string>;
  };
  catalog: Record<
    string,
    {
      name: string;
      unit: string;
      default_value: number;
      pins: {
        name: string;
        label: string;
        role: string;
        package_pin: string | number;
      }[];
      models: {
        id: string;
        label: string;
        origin: string;
        assumptions: unknown;
      }[];
      package?: { name: string; pin_map: unknown };
    }
  >;
  simulation: Simulation | null;
  history: { can_undo: boolean; can_redo: boolean };
  diagnostics?: Diagnostic[];
};
export type Op = { type: string; [key: string]: unknown };
export function format(n: number | undefined, unit = "V") {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const [v, p] =
    a > 0 && a < 0.000001
      ? [n * 1e9, "n"]
      : a > 0 && a < 0.001
        ? [n * 1e6, "µ"]
        : a > 0 && a < 1
          ? [n * 1e3, "m"]
          : a >= 1e6
            ? [n / 1e6, "M"]
            : a >= 1e3
              ? [n / 1e3, "k"]
              : [n, ""];
  return `${Number(v.toPrecision(4))} ${p}${unit}`;
}
export function pinOffsets(c: Component): Record<string, [number, number]> {
  if (c.kind === "npn" || c.kind === "pnp")
    return { c: [32, -34], b: [-44, 0], e: [32, 34] };
  if (c.kind === "ground") return { g: [0, -28] };
  if (c.kind === "potentiometer")
    return { p: [-48, 0], w: [0, -48], n: [48, 0] };
  return Object.fromEntries(
    Object.keys(c.pins).map((p, i) => [p, [i === 0 ? -48 : 48, 0]]),
  );
}
export function pinPoints(p: Project): Record<string, [number, number]> {
  const pts: Record<string, [number, number]> = {};
  for (const c of p.components) {
    const pos = p.schematic[c.id] || { x: 150, y: 150 };
    for (const [pin, off] of Object.entries(pinOffsets(c))) {
      const a = ((pos.rotation || 0) * Math.PI) / 180;
      pts[c.pins[pin]] = [
        pos.x + off[0] * Math.cos(a) - off[1] * Math.sin(a),
        pos.y + off[0] * Math.sin(a) + off[1] * Math.cos(a),
      ];
    }
  }
  for (const j of p.junctions) pts[j.id] = [j.x, j.y];
  return pts;
}
export function holePoint(id: string): [number, number] | null {
  const m = /^([a-j])(\d+)$/.exec(id);
  if (m) {
    const row = "abcdefghij".indexOf(m[1]);
    return [
      58 + (Number(m[2]) - 1) * 23,
      row < 5 ? 83 + row * 16 : 190 + (row - 5) * 16,
    ];
  }
  const r = /^rail_(top|bottom)_([pn])(\d+)$/.exec(id);
  return r
    ? [
        58 + (Number(r[3]) - 1) * 23,
        (r[1] === "top" ? 32 : 290) + (r[2] === "n" ? 17 : 0),
      ]
    : null;
}
export const colors = [
  "#52d8ad",
  "#56a8f5",
  "#b59aff",
  "#f3bd69",
  "#f181a1",
  "#74c9cd",
];
