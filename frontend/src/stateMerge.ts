import type { Project, Simulation, State } from "./types";
const sortedEntries = (value: Record<string, unknown>) =>
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
/** Comparaison de contenu électrique, jamais de calcul ou de mesure de remplacement. */
export function electricalSignature(project: Project): string {
  return JSON.stringify({
    components: project.components
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        value: c.value,
        position: c.kind === "potentiometer" ? (c.position ?? 0.5) : null,
        waveform:
          c.kind === "voltage_source" && c.waveform
            ? {
                kind: c.waveform.kind,
                low: c.waveform.low,
                high: c.waveform.high,
                delay: c.waveform.delay,
                rise: c.waveform.rise,
                fall: c.waveform.fall,
                width: c.waveform.width,
                period: c.waveform.period,
              }
            : null,
        model: c.model ?? null,
        pins: sortedEntries(c.pins),
        initial_voltage:
          (c as typeof c & { initial_voltage?: number }).initial_voltage ??
          null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    wires: project.wires
      .map((w) => ({ id: w.id, a: w.a, b: w.b }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    junctions: project.junctions.map((j) => j.id).sort(),
    placements: sortedEntries(project.breadboard.placements),
    rail_splits: project.breadboard.rail_splits,
  });
}
/** Une réponse de modification peut être plus ancienne que les mesures déjà reçues. */
export function withMeasurements(
  projectState: State,
  measurementState: State,
): State {
  const changed =
    electricalSignature(projectState.project) !==
    electricalSignature(measurementState.project);
  const validity = (value: Simulation | null | undefined) =>
    value ? { ...value, stale: !!value.stale || changed } : value;
  return {
    ...projectState,
    simulation: validity(measurementState.simulation) ?? null,
    last_success: validity(measurementState.last_success),
    running: measurementState.running,
  };
}
/** Une réponse de calcul tardive apporte ses mesures sans annuler une édition récente. */
export function publishSimulationState(
  current: State | null,
  incoming: State,
): State {
  return current && current.project.revision > incoming.project.revision
    ? withMeasurements(current, incoming)
    : incoming;
}

/** Filtre les anciennes réponses avant toute modification de la phase du calcul. */
export function isCurrentProjectRevision(
  current: State | null,
  incoming: State,
): boolean {
  return !current || incoming.project.revision >= current.project.revision;
}

/** Une ancienne réponse de modification ne remplace jamais le projet déjà reçu. */
export function publishProjectState(
  current: State | null,
  incoming: State,
): State {
  return isCurrentProjectRevision(current, incoming) ? incoming : current!;
}
