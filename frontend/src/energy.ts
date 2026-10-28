import type { State } from "./types";

export type EnergyRow = {
  id: string;
  label: string;
  kind: "capacitor" | "inductor";
  values: (number | null)[];
};
export type EnergySnapshot = {
  status: "ready";
  key: string;
  revision: number;
  time: number[];
  rows: EnergyRow[];
  capacitive: (number | null)[];
  magnetic: (number | null)[];
  total: (number | null)[];
};
export type EnergyReport =
  | EnergySnapshot
  | {
      status: "empty" | "pending" | "stale" | "unavailable";
      message: string;
    };
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Énergie des éléments idéaux, calculée à partir des seules mesures du moteur. */
export function circuitEnergy(state: State, busy = false): EnergyReport {
  const elements = state.project.components.filter(
    (c) => c.kind === "capacitor" || c.kind === "inductor",
  );
  if (!elements.length)
    return {
      status: "empty",
      message:
        "Ajoute un condensateur ou une inductance pour explorer l’énergie stockée.",
    };
  if (busy || state.running)
    return {
      status: "pending",
      message:
        "Calcul en cours. Les énergies apparaîtront avec les nouvelles mesures.",
    };
  const simulation = state.simulation;
  if (!simulation || simulation.status !== "success")
    return {
      status: "unavailable",
      message: "Lance une simulation réussie pour mesurer l’énergie stockée.",
    };
  if (simulation.stale)
    return {
      status: "stale",
      message:
        "Le circuit a changé. Relance le calcul pour actualiser les énergies.",
    };
  const time = simulation.time;
  const analysis = simulation.analysis as { kind?: unknown } | undefined;
  if (
    !Array.isArray(time) ||
    (analysis?.kind === "tran" && time.length < 2) ||
    !time.every((t, i) => finite(t) && t >= 0 && (!i || t > time[i - 1]))
  )
    return {
      status: "unavailable",
      message:
        "Les échantillons temporels ne permettent pas de calculer les énergies.",
    };
  const count = time.length || 1;
  const curves = new Map(simulation.curves.map((curve) => [curve.id, curve]));
  const net = state.topology.terminal_to_net;
  const voltage = (terminal: string, index: number): number | null => {
    const id = net[terminal];
    if (!id) return null;
    if (id === "0") return 0;
    const curve = curves.get(id);
    const value = time.length
      ? curve?.unit === "V"
        ? curve.values[index]
        : undefined
      : simulation.voltages[id];
    return finite(value) ? value : null;
  };
  const rows: EnergyRow[] = elements.map((component) => {
    const kind = component.kind as EnergyRow["kind"];
    const current = curves.get(`I:${component.id}`);
    const values = Array.from({ length: count }, (_, index): number | null => {
      if (!finite(component.value) || component.value <= 0) return null;
      let magnitude: number | null;
      if (kind === "capacitor") {
        const p = voltage(component.pins.p, index),
          n = voltage(component.pins.n, index);
        magnitude = p === null || n === null ? null : p - n;
      } else {
        const value = time.length
          ? current?.unit === "A"
            ? current.values[index]
            : undefined
          : simulation.currents[component.id];
        magnitude = finite(value) ? value : null;
      }
      if (magnitude === null) return null;
      const energy = 0.5 * component.value * magnitude * magnitude;
      return finite(energy) ? energy : null;
    });
    return { id: component.id, label: component.label, kind, values };
  });
  const sum = (kind: EnergyRow["kind"]): (number | null)[] =>
    Array.from({ length: count }, (_, index) => {
      let total = 0;
      for (const row of rows) {
        if (row.kind !== kind) continue;
        const value = row.values[index];
        if (value === null) return null;
        total += value;
      }
      return finite(total) ? total : null;
    });
  const capacitive = sum("capacitor"),
    magnetic = sum("inductor");
  const total = capacitive.map((value, i) => {
    const other = magnetic[i];
    return value === null || other === null || !finite(value + other)
      ? null
      : value + other;
  });
  return {
    status: "ready",
    rows,
    time,
    capacitive,
    magnetic,
    total,
    revision: simulation.project_revision,
    key: `${state.project.id}:${simulation.circuit_fingerprint || simulation.project_revision}:${JSON.stringify(simulation.analysis)}:${count}`,
  };
}

export function nearestEnergySample(
  time: readonly number[],
  target: number,
): number {
  if (!time.length || !finite(target)) return 0;
  let low = 0,
    high = time.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (time[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low > 0 &&
    Math.abs(time[low - 1] - target) <= Math.abs(time[low] - target)
    ? low - 1
    : low;
}

export function energyCsv(snapshot: EnergySnapshot): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    [
      "time_s",
      "capacitive_J",
      "magnetic_J",
      "total_J",
      ...snapshot.rows.map((row) => `${row.id}_J`),
    ]
      .map(quote)
      .join(","),
  ];
  for (let i = 0; i < snapshot.total.length; i++)
    rows.push(
      [
        snapshot.time[i] ?? null,
        snapshot.capacitive[i],
        snapshot.magnetic[i],
        snapshot.total[i],
        ...snapshot.rows.map((row) => row.values[i]),
      ]
        .map((value) => (value === null ? "" : String(value)))
        .join(","),
    );
  return rows.join("\r\n") + "\r\n";
}
