import type { Simulation, State } from "./types";

export type PlaybackSource = {
  key: string;
  projectId: string;
  simulationId: string;
  fingerprint: string;
  sourceRevision: number;
  time: readonly number[];
};
export type SimulationFrame = {
  project_id: string;
  project_revision: number;
  source_revision: number;
  simulation_id: string;
  circuit_fingerprint: string;
  index: number;
  time: number;
  sample_count: number;
  simulation: Simulation;
};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const numberMap = (value: unknown): value is Record<string, number> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every(finite);

/** Seul le calcul courant et encore valable peut être rejoué. */
export function playbackSource(
  state: State | null,
  busy = false,
): PlaybackSource | null {
  const simulation = state?.simulation;
  const analysis = simulation?.analysis as { kind?: unknown } | undefined;
  if (
    !state ||
    busy ||
    state.running ||
    !simulation ||
    simulation.status !== "success" ||
    simulation.stale ||
    analysis?.kind !== "tran"
  )
    return null;
  const uid = simulation.simulation_id,
    fingerprint = simulation.circuit_fingerprint;
  if (
    typeof uid !== "string" ||
    !uid ||
    uid.length > 128 ||
    typeof fingerprint !== "string" ||
    !fingerprint ||
    !Number.isInteger(simulation.project_revision) ||
    simulation.project_revision < 0 ||
    !Array.isArray(simulation.time) ||
    simulation.time.length < 2 ||
    simulation.time.length > 6000 ||
    !simulation.time.every(
      (time, index, values) =>
        finite(time) && time >= 0 && (!index || time > values[index - 1]),
    )
  )
    return null;
  return {
    key: `${state.project.id}|${uid}|${fingerprint}`,
    projectId: state.project.id,
    simulationId: uid,
    fingerprint,
    sourceRevision: simulation.project_revision,
    time: simulation.time,
  };
}

/** Un résultat tardif d'une autre lecture ne doit jamais changer l'affichage. */
export function frameMatchesSource(
  frame: SimulationFrame,
  source: PlaybackSource,
  index: number,
): boolean {
  return (
    !!frame &&
    typeof frame === "object" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < source.time.length &&
    frame.project_id === source.projectId &&
    frame.simulation_id === source.simulationId &&
    frame.circuit_fingerprint === source.fingerprint &&
    frame.source_revision === source.sourceRevision &&
    frame.index === index &&
    frame.sample_count === source.time.length &&
    frame.time === source.time[index] &&
    frame.simulation?.status === "success" &&
    !frame.simulation.stale &&
    numberMap(frame.simulation.voltages) &&
    frame.simulation.voltages["0"] === 0 &&
    numberMap(frame.simulation.currents) &&
    !!frame.simulation.terminal_currents &&
    Object.values(frame.simulation.terminal_currents).every(numberMap) &&
    frame.simulation.simulation_id === source.simulationId &&
    frame.simulation.project_revision === source.sourceRevision &&
    frame.simulation.circuit_fingerprint === source.fingerprint &&
    frame.simulation.sample_index === index &&
    frame.simulation.sample_time === frame.time &&
    frame.simulation.sample_count === frame.sample_count
  );
}

/** Le temps défile régulièrement ; le point affiché reste un vrai échantillon. */
export function nearestPlaybackIndex(
  time: readonly number[],
  target: number,
): number {
  if (!time.length || !finite(target)) return -1;
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

/** Garder la série pour les instruments, remplacer seulement les mesures au point. */
export function withPlaybackFrame(
  simulation: Simulation,
  source: PlaybackSource,
  frame: SimulationFrame | null,
): Simulation {
  const result: Simulation = { ...simulation };
  if (frame) {
    const dynamic: Record<string, unknown> = result;
    for (const field of [
      "voltages",
      "currents",
      "terminal_currents",
      "terminal_currents_flat",
      "probe_voltages",
      "wire_currents",
      "wire_current_status",
      "wire_flow_hints",
      "wire_flow_hint_kind",
      "flow_diagnostics",
      "flow_legend",
      "flow_sample",
      "flow_sample_index",
      "flow_sample_time",
    ])
      dynamic[field] = frame.simulation[field];
  }
  result.sample_index = frame?.index ?? source.time.length - 1;
  result.sample_time = frame?.time ?? source.time.at(-1)!;
  result.sample_count = source.time.length;
  return result;
}
