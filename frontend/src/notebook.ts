import type { Project, Simulation, State, VoltageWaveform } from "./types";

export const notebookStorageKey = "atelier.lab-notebook.v1";
export const maxCaptures = 12;
export type NotebookStorage = Pick<Storage, "getItem" | "setItem">;
export type NotebookMeasurement = {
  id: string;
  label: string;
  unit: "V" | "A";
  value: number;
};
export type NotebookComponentSettings = {
  model?: string | null;
  position?: number;
  initial_voltage?: number;
  waveform?: VoltageWaveform | null;
};
export type NotebookCapture = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  capturedAt: string;
  note: string;
  circuitKey: string;
  analysisKey: string;
  analysisLabel: string;
  measurements: NotebookMeasurement[];
  componentValues: Record<string, number>;
  /** Optional so captures saved before adjustable components remain readable. */
  componentSettings?: Record<string, NotebookComponentSettings>;
  /** Absent dans les captures précédant la relecture temporelle. */
  sampleIndex?: number;
  sampleTime?: number;
  sampleCount?: number;
  simulationId?: string;
  /** Révision et empreinte du calcul, distinctes de la révision visuelle capturée. */
  sourceRevision?: number;
  circuitFingerprint?: string;
};
type NotebookSample = Required<
  Pick<NotebookCapture, "sampleIndex" | "sampleTime" | "sampleCount">
>;
// Retain unsaved captures when the panel unmounts and storage is unavailable.
const unsavedSessionCaptures = new Map<
  NotebookStorage | null,
  NotebookCapture[]
>();

export type NotebookComparison = {
  comparable: boolean;
  reason: string;
  rows: (NotebookMeasurement & { baseline: number; delta: number })[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function sourceIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

/** Les trois champs forment une seule provenance, jamais un instant partiel. */
function sanitizeSample(
  value: Record<string, unknown>,
): NotebookSample | null | undefined {
  if (
    ["sampleIndex", "sampleTime", "sampleCount"].every(
      (key) => value[key] === undefined,
    )
  )
    return undefined;
  const { sampleIndex, sampleTime, sampleCount } = value;
  if (
    !finite(sampleIndex) ||
    !Number.isSafeInteger(sampleIndex) ||
    !finite(sampleCount) ||
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < 1 ||
    sampleCount > 6000 ||
    sampleIndex < 0 ||
    sampleIndex >= sampleCount ||
    !finite(sampleTime) ||
    sampleTime < 0
  )
    return null;
  return { sampleIndex, sampleTime, sampleCount };
}

function parsedAnalysisKey(
  capture: Pick<NotebookCapture, "analysisKey">,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(capture.analysisKey);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function notebookHasIncompleteSampleProvenance(
  capture: NotebookCapture,
): boolean {
  const analysis = parsedAnalysisKey(capture);
  const temporal =
    analysis?.kind === "tran" || /^TRAN\b/.test(capture.analysisLabel);
  const sample = sanitizeSample(capture);
  return temporal && (sample === undefined || sample === null);
}

const waveformNumberKeys = [
  "low",
  "high",
  "delay",
  "rise",
  "fall",
  "width",
  "period",
] as const;

/** Explicit schema and property order prevent foreign fields reaching storage. */
function sanitizeWaveform(value: unknown): VoltageWaveform | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.kind !== "pulse") return undefined;
  if (waveformNumberKeys.some((key) => !finite(value[key]))) return undefined;
  const { low, high, delay, rise, fall, width, period } = value as Record<
    (typeof waveformNumberKeys)[number],
    number
  >;
  const activeTime = rise + width + fall;
  const exceedsPeriod =
    activeTime > period &&
    Math.abs(activeTime - period) > 1e-12 * Math.max(activeTime, period);
  if (
    Math.abs(low) > 1e6 ||
    Math.abs(high) > 1e6 ||
    delay < 0 ||
    rise <= 0 ||
    fall <= 0 ||
    width <= 0 ||
    period <= 0 ||
    !finite(activeTime) ||
    exceedsPeriod
  )
    return undefined;
  return { kind: "pulse", low, high, delay, rise, fall, width, period };
}

function waveformComparisonKey(
  waveform: VoltageWaveform | null | undefined,
): string {
  return waveform
    ? JSON.stringify(waveformNumberKeys.map((key) => waveform[key]))
    : "dc";
}

/** Values and layout are deliberately absent: an experiment changes component
 * values while preserving the same electrical connections. */
export function circuitComparisonKey(
  project: Project,
  topology: State["topology"],
): string {
  return JSON.stringify({
    project: project.id,
    components: project.components
      .map((component) => [
        component.id,
        component.kind,
        Object.entries(component.pins).sort(([a], [b]) => a.localeCompare(b)),
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
    nets: topology.nets
      .map((net) => [...net.points].sort())
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

export function createNotebookCapture(
  project: Project,
  simulation: Simulation | null,
  topology: State["topology"],
  stale: boolean,
  note = "",
  capturedAt = new Date().toISOString(),
): NotebookCapture | null {
  if (
    !simulation ||
    simulation.status !== "success" ||
    stale ||
    simulation.stale
  )
    return null;
  if (
    !Number.isSafeInteger(simulation.project_revision) ||
    simulation.project_revision < 0 ||
    simulation.project_revision > project.revision
  )
    return null;
  const fingerprint = simulation.circuit_fingerprint;
  if (fingerprint !== undefined && !sourceIdentifier(fingerprint)) return null;
  const analysis = isRecord(simulation.analysis)
    ? simulation.analysis
    : { kind: "op" };
  const temporal = analysis.kind === "tran";
  let sample = sanitizeSample({
    sampleIndex: simulation.sample_index,
    sampleTime: simulation.sample_time,
    sampleCount: simulation.sample_count,
  });
  if (sample === null) return null;
  if (temporal) {
    const times = simulation.time;
    if (
      !Array.isArray(times) ||
      !times.length ||
      times.length > 6000 ||
      !times.every(
        (time, index) =>
          finite(time) && time >= 0 && (!index || time > times[index - 1]),
      )
    )
      return null;
    if (
      sample &&
      (sample.sampleCount !== times.length ||
        times[sample.sampleIndex] !== sample.sampleTime)
    )
      return null;
    sample ||= {
      sampleIndex: times.length - 1,
      sampleTime: times[times.length - 1],
      sampleCount: times.length,
    };
  } else if (sample) return null;
  const simulationId = simulation.simulation_id;
  if (simulationId !== undefined && !sourceIdentifier(simulationId))
    return null;
  const measurements: NotebookMeasurement[] = [];
  for (const net of topology.nets) {
    const value = simulation.voltages[net.id];
    if (!finite(value)) continue;
    const points = [...net.points].sort();
    measurements.push({
      id: `V:${JSON.stringify(points)}`,
      label:
        net.name || (net.id === "0" ? "Masse" : points.join(" · ") || net.id),
      unit: "V",
      value,
    });
  }
  for (const component of project.components) {
    const value = simulation.currents[component.id];
    if (finite(value))
      measurements.push({
        id: `I:${component.id}`,
        label: component.label || component.id,
        unit: "A",
        value,
      });
  }
  if (!measurements.length) return null;
  const componentSettings: Record<string, NotebookComponentSettings> = {};
  for (const component of project.components) {
    const settings: NotebookComponentSettings = {
      model: component.model ?? null,
    };
    if (component.kind === "potentiometer")
      settings.position = finite(component.position) ? component.position : 0.5;
    if (component.kind === "capacitor")
      settings.initial_voltage = finite(component.initial_voltage)
        ? component.initial_voltage
        : 0;
    if (component.kind === "voltage_source") {
      const waveform = sanitizeWaveform(component.waveform);
      if (waveform === undefined) return null;
      settings.waveform = waveform;
    }
    componentSettings[component.id] = settings;
  }
  return {
    id: `${capturedAt}-${Math.random().toString(36).slice(2, 9)}`,
    projectId: project.id,
    title: project.title,
    revision: project.revision,
    capturedAt,
    note: note.trim().slice(0, 280),
    circuitKey: circuitComparisonKey(project, topology),
    analysisKey: JSON.stringify(
      temporal
        ? {
            kind: "tran",
            time: sample!.sampleTime,
            startup: analysis.startup !== false,
          }
        : { kind: "op" },
    ),
    analysisLabel: temporal
      ? `TRAN · t = ${sample!.sampleTime.toPrecision(4)} s · échantillon ${sample!.sampleIndex + 1}/${sample!.sampleCount}`
      : "OP · état stabilisé",
    measurements,
    componentValues: Object.fromEntries(
      project.components
        .filter((component) => finite(component.value))
        .map((component) => [component.id, component.value]),
    ),
    componentSettings,
    ...(sample ? sample : {}),
    ...(simulationId !== undefined ? { simulationId } : {}),
    sourceRevision: simulation.project_revision,
    ...(fingerprint !== undefined ? { circuitFingerprint: fingerprint } : {}),
  };
}

/** Missing historical settings are unknown, never evidence of equality. */
export function describeNotebookChanges(
  baseline: NotebookCapture | null,
  candidate: NotebookCapture | null,
): {
  changes: {
    id: string;
    fields: ("value" | keyof NotebookComponentSettings)[];
  }[];
  incompleteProvenance: boolean;
} {
  if (!baseline || !candidate)
    return { changes: [], incompleteProvenance: true };
  let incompleteProvenance =
    !baseline.componentSettings ||
    !candidate.componentSettings ||
    notebookHasIncompleteSampleProvenance(baseline) ||
    notebookHasIncompleteSampleProvenance(candidate);
  const componentIds = new Set([
    ...Object.keys(baseline.componentValues),
    ...Object.keys(candidate.componentValues),
  ]);
  const changes: {
    id: string;
    fields: ("value" | keyof NotebookComponentSettings)[];
  }[] = [];
  for (const id of componentIds) {
    const fields: ("value" | keyof NotebookComponentSettings)[] = [];
    if (baseline.componentValues[id] !== candidate.componentValues[id])
      fields.push("value");
    const before = baseline.componentSettings?.[id],
      after = candidate.componentSettings?.[id];
    if (
      !before ||
      !after ||
      !Object.hasOwn(before, "model") ||
      !Object.hasOwn(after, "model")
    )
      incompleteProvenance = true;
    for (const key of [
      "model",
      "position",
      "initial_voltage",
      "waveform",
    ] as const) {
      const beforeKnown = before && Object.hasOwn(before, key),
        afterKnown = after && Object.hasOwn(after, key);
      if (beforeKnown && afterKnown) {
        if (
          key === "waveform"
            ? waveformComparisonKey(before.waveform) !==
              waveformComparisonKey(after.waveform)
            : before[key] !== after[key]
        )
          fields.push(key);
      } else if (beforeKnown || afterKnown) incompleteProvenance = true;
    }
    if (fields.length) changes.push({ id, fields });
  }
  return { changes, incompleteProvenance };
}

export function compareNotebookCaptures(
  baseline: NotebookCapture | null,
  candidate: NotebookCapture | null,
): NotebookComparison {
  const failure = (reason: string): NotebookComparison => ({
    comparable: false,
    reason,
    rows: [],
  });
  if (!baseline || !candidate)
    return failure("Choisis une référence et une mesure à comparer.");
  if (
    baseline.projectId !== candidate.projectId ||
    baseline.circuitKey !== candidate.circuitKey
  )
    return failure(
      "Les connexions ont changé. Capture une nouvelle référence pour ce circuit.",
    );
  if (
    baseline.sampleTime !== undefined &&
    candidate.sampleTime !== undefined &&
    baseline.sampleTime !== candidate.sampleTime
  )
    return failure(
      "Choisis le même instant de simulation dans les deux essais pour comparer les mesures.",
    );
  if (baseline.analysisKey !== candidate.analysisKey)
    return failure(
      "Compare le même type d’analyse au même instant, avec les mêmes conditions initiales.",
    );
  const previous = new Map(
    baseline.measurements.map((measurement) => [measurement.id, measurement]),
  );
  if (
    previous.size !== candidate.measurements.length ||
    candidate.measurements.some(
      (measurement) => previous.get(measurement.id)?.unit !== measurement.unit,
    )
  )
    return failure(
      "Les mesures disponibles diffèrent. Capture une nouvelle référence.",
    );
  const rows = candidate.measurements.map((measurement) => ({
    ...measurement,
    baseline: previous.get(measurement.id)!.value,
    delta: measurement.value - previous.get(measurement.id)!.value,
  }));
  if (
    rows.some(
      (row) =>
        !finite(row.value) || !finite(row.baseline) || !finite(row.delta),
    )
  )
    return failure(
      "Ces mesures contiennent une valeur non finie et ne peuvent pas être comparées.",
    );
  return { comparable: true, reason: "", rows };
}

function sanitizeCapture(value: unknown): NotebookCapture | null {
  if (
    !isRecord(value) ||
    !text(value.id, 160) ||
    !text(value.projectId, 200) ||
    !text(value.title, 500) ||
    !finite(value.revision) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !text(value.capturedAt, 40) ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !text(value.note, 280) ||
    !text(value.circuitKey, 200000) ||
    !text(value.analysisKey, 1000) ||
    !text(value.analysisLabel, 160) ||
    !Array.isArray(value.measurements) ||
    !value.measurements.length ||
    value.measurements.length > 1200 ||
    !isRecord(value.componentValues)
  )
    return null;
  const measurements: NotebookMeasurement[] = [];
  const ids = new Set<string>();
  for (const measurement of value.measurements) {
    if (
      !isRecord(measurement) ||
      !text(measurement.id, 20000) ||
      !text(measurement.label, 20000) ||
      (measurement.unit !== "V" && measurement.unit !== "A") ||
      !finite(measurement.value) ||
      ids.has(measurement.id)
    )
      return null;
    ids.add(measurement.id);
    measurements.push({
      id: measurement.id,
      label: measurement.label,
      unit: measurement.unit,
      value: measurement.value,
    });
  }
  const entries = Object.entries(value.componentValues);
  if (
    entries.length > 300 ||
    entries.some(([id, number]) => id.length > 200 || !finite(number))
  )
    return null;
  let componentSettings: Record<string, NotebookComponentSettings> | undefined;
  if (value.componentSettings !== undefined) {
    if (!isRecord(value.componentSettings)) return null;
    const settingsEntries = Object.entries(value.componentSettings);
    if (settingsEntries.length > 300) return null;
    const sanitizedEntries: [string, NotebookComponentSettings][] = [];
    for (const [id, settings] of settingsEntries) {
      if (id.length > 200 || !isRecord(settings)) return null;
      const safe: NotebookComponentSettings = {};
      if (Object.hasOwn(settings, "model")) {
        if (settings.model !== null && !text(settings.model, 200)) return null;
        safe.model = settings.model as string | null;
      }
      if (Object.hasOwn(settings, "position")) {
        if (
          !finite(settings.position) ||
          settings.position < 0 ||
          settings.position > 1
        )
          return null;
        safe.position = settings.position;
      }
      if (Object.hasOwn(settings, "initial_voltage")) {
        if (!finite(settings.initial_voltage)) return null;
        safe.initial_voltage = settings.initial_voltage;
      }
      if (Object.hasOwn(settings, "waveform")) {
        const waveform = sanitizeWaveform(settings.waveform);
        if (waveform === undefined) return null;
        safe.waveform = waveform;
      }
      sanitizedEntries.push([id, safe]);
    }
    componentSettings = Object.fromEntries(sanitizedEntries);
  }
  const sample = sanitizeSample(value);
  if (sample === null) return null;
  const analysis = parsedAnalysisKey({ analysisKey: value.analysisKey });
  if (
    sample &&
    (analysis?.kind !== "tran" || analysis.time !== sample.sampleTime)
  )
    return null;
  if (value.simulationId !== undefined && !sourceIdentifier(value.simulationId))
    return null;
  if (
    value.sourceRevision !== undefined &&
    (!finite(value.sourceRevision) ||
      !Number.isSafeInteger(value.sourceRevision) ||
      value.sourceRevision < 0 ||
      value.sourceRevision > value.revision)
  )
    return null;
  if (
    value.circuitFingerprint !== undefined &&
    !sourceIdentifier(value.circuitFingerprint)
  )
    return null;
  return {
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    revision: value.revision,
    capturedAt: value.capturedAt,
    note: value.note,
    circuitKey: value.circuitKey,
    analysisKey: value.analysisKey,
    analysisLabel: value.analysisLabel,
    measurements,
    componentValues: Object.fromEntries(entries) as Record<string, number>,
    ...(componentSettings ? { componentSettings } : {}),
    ...(sample ? sample : {}),
    ...(value.simulationId !== undefined
      ? { simulationId: value.simulationId }
      : {}),
    ...(value.sourceRevision !== undefined
      ? { sourceRevision: value.sourceRevision }
      : {}),
    ...(value.circuitFingerprint !== undefined
      ? { circuitFingerprint: value.circuitFingerprint }
      : {}),
  };
}

export function notebookHasUnsavedCaptures(
  storage: NotebookStorage | null | undefined,
): boolean {
  return unsavedSessionCaptures.has(storage || null);
}

export function readNotebook(
  storage: NotebookStorage | null | undefined,
): NotebookCapture[] {
  const unsaved = unsavedSessionCaptures.get(storage || null);
  if (unsaved)
    return unsaved
      .map(sanitizeCapture)
      .filter((capture): capture is NotebookCapture => capture !== null);
  try {
    const raw = storage?.getItem(notebookStorageKey);
    if (!raw || raw.length > 4_000_000) return [];
    const saved: unknown = JSON.parse(raw);
    if (
      !isRecord(saved) ||
      saved.version !== 1 ||
      !Array.isArray(saved.captures)
    )
      return [];
    return saved.captures
      .slice(0, maxCaptures)
      .map(sanitizeCapture)
      .filter((capture): capture is NotebookCapture => capture !== null);
  } catch {
    return [];
  }
}

export function writeNotebook(
  storage: NotebookStorage | null | undefined,
  captures: NotebookCapture[],
): boolean {
  const safe = captures
    .slice(0, maxCaptures)
    .map(sanitizeCapture)
    .filter((capture): capture is NotebookCapture => capture !== null);
  unsavedSessionCaptures.set(storage || null, safe);
  try {
    if (!storage) return false;
    storage.setItem(
      notebookStorageKey,
      JSON.stringify({ version: 1, captures: safe }),
    );
    unsavedSessionCaptures.delete(storage);
    return true;
  } catch {
    return false;
  }
}

export function appendNotebookCapture(
  captures: NotebookCapture[],
  capture: NotebookCapture,
): NotebookCapture[] {
  return [
    capture,
    ...captures.filter((existing) => existing.id !== capture.id),
  ].slice(0, maxCaptures);
}
