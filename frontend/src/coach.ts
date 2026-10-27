import type { Diagnostic, Simulation, State } from "./types";

export type CoachCheck = {
  id: "source" | "ground" | "connections" | "measurements";
  label: string;
  complete: boolean;
  detail: string;
};
export type CoachIssue = {
  code: string;
  severity: string;
  category: string;
  message: string;
  explanation: string;
  selectIds: string[];
};
export type ResistorObservation = {
  id: string;
  label: string;
  voltage: number;
  current: number;
  power: number;
};
export type CoachSummary = {
  checks: CoachCheck[];
  issues: CoachIssue[];
  connectedPins: number;
  totalPins: number;
  next: {
    kind: "examples" | "library" | "select" | "run" | "none";
    label: string;
    message: string;
    selectIds: string[];
  };
  observations: ResistorObservation[];
  hasCurrentMeasurements: boolean;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function selectComponents(state: State, targets: string[]): string[] {
  const selected = new Set<string>();
  const { components } = state.project;
  for (const target of targets) {
    const net = state.topology.nets.find((entry) => entry.id === target);
    const points = new Set(net ? net.points : [target]);
    for (const component of components)
      if (
        component.id === target ||
        Object.values(component.pins).some((terminal) => points.has(terminal))
      )
        selected.add(component.id);
  }
  return [...selected].sort();
}

function toIssue(state: State, diagnostic: Diagnostic): CoachIssue | null {
  if (typeof diagnostic.message !== "string" || !diagnostic.message.trim())
    return null;
  const targets = Array.isArray(diagnostic.targets)
    ? diagnostic.targets.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  return {
    code: diagnostic.code || "observation",
    severity: diagnostic.severity || "info",
    category: diagnostic.category || "observation",
    message: diagnostic.message,
    explanation:
      typeof diagnostic.explanation === "string" ? diagnostic.explanation : "",
    selectIds: selectComponents(state, targets),
  };
}

/** The backend diagnostics remain authoritative. This assistant does not infer
 * electrical safety from a visually complete circuit or a successful solver. */
export function summarizeCircuit(
  state: State,
  stale: boolean,
  busy = false,
): CoachSummary {
  const { project, topology } = state;
  const components = project.components;
  const hasSource = components.some((entry) => entry.kind === "voltage_source");
  const hasGround = components.some((entry) => entry.kind === "ground");
  const terminals = new Map<string, string>();
  for (const component of components)
    for (const terminal of Object.values(component.pins))
      terminals.set(terminal, component.id);
  const attached = new Map<string, Set<string>>();
  for (const [terminal, componentId] of terminals) {
    const netId = topology.terminal_to_net[terminal];
    if (!netId) continue;
    const members = attached.get(netId) || new Set<string>();
    members.add(componentId);
    attached.set(netId, members);
  }
  let connectedPins = 0;
  for (const terminal of terminals.keys())
    if ((attached.get(topology.terminal_to_net[terminal])?.size || 0) > 1)
      connectedPins += 1;

  const simulation: Simulation | null =
    state.simulation?.status === "success"
      ? state.simulation
      : state.last_success || state.simulation?.last_success || null;
  const failedAttempt =
    !!state.simulation && state.simulation.status !== "success";
  const hasCurrentMeasurements = !!(
    simulation?.status === "success" &&
    !simulation.stale &&
    !stale &&
    !busy &&
    !failedAttempt
  );
  const rawDiagnostics = [
    ...(state.diagnostics || []),
    ...(!stale ? state.simulation?.diagnostics || [] : []),
  ];
  const deduplicated = new Map<string, CoachIssue>();
  for (const diagnostic of rawDiagnostics) {
    const issue = toIssue(state, diagnostic);
    if (!issue) continue;
    const key = JSON.stringify([issue.code, issue.message, issue.selectIds]);
    deduplicated.set(key, issue);
  }
  const severityOrder: Record<string, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const categoryOrder: Record<string, number> = {
    connection: 0,
    solver: 1,
    hypothesis: 2,
  };
  const issues = [...deduplicated.values()].sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) ||
      (categoryOrder[a.category] ?? 3) - (categoryOrder[b.category] ?? 3) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
  const groundIsolated = issues.some(
    (issue) =>
      issue.code === "isolated_ground" && issue.category === "connection",
  );
  const blocked = issues.some(
    (issue) => issue.severity === "error" && issue.category === "connection",
  );
  const dangling = issues.find(
    (issue) =>
      issue.category === "connection" && issue.code === "dangling_terminal",
  );
  const groundConnected =
    hasGround && !groundIsolated && (attached.get("0")?.size || 0) > 1;
  const connectionsComplete =
    terminals.size > 0 && connectedPins === terminals.size && !blocked;
  const checks: CoachCheck[] = [
    {
      id: "source",
      label: "Source",
      complete: hasSource,
      detail: hasSource
        ? "Une source continue est présente."
        : "Ajoute une alimentation pour un premier montage alimenté.",
    },
    {
      id: "ground",
      label: "Référence 0 V",
      complete: groundConnected,
      detail: groundConnected
        ? "La masse rejoint le circuit."
        : hasGround
          ? "Relie la masse au retour du circuit."
          : "Ajoute une masse et relie-la au retour.",
    },
    {
      id: "connections",
      label: "Connexions",
      complete: connectionsComplete,
      detail: `${connectedPins}/${terminals.size} bornes partagent un réseau avec un autre composant.`,
    },
    {
      id: "measurements",
      label: "Mesures",
      complete: hasCurrentMeasurements,
      detail: busy
        ? "Le moteur calcule les mesures."
        : hasCurrentMeasurements
          ? "Un calcul réussi est disponible pour ce circuit."
          : stale
            ? "Le circuit a changé : recalcule les mesures."
            : "Lance le calcul pour observer tensions et courants.",
    },
  ];

  let next: CoachSummary["next"];
  const blockingIssue = issues.find(
    (issue) => issue.category === "connection" && issue.severity === "error",
  );
  if (!components.length) {
    next = {
      kind: "examples",
      label: "Choisir un premier circuit",
      message:
        "Pars d’un exemple ou ajoute tes composants dans la bibliothèque.",
      selectIds: [],
    };
  } else if (blockingIssue) {
    next = {
      kind:
        blockingIssue.code === "missing_ground"
          ? "library"
          : blockingIssue.selectIds.length
            ? "select"
            : "none",
      label:
        blockingIssue.code === "missing_ground"
          ? "Ajouter une masse"
          : "Repérer les composants",
      message: blockingIssue.message,
      selectIds: blockingIssue.selectIds,
    };
  } else if (dangling?.selectIds.length) {
    next = {
      kind: "select",
      label: "Repérer la borne isolée",
      message:
        "Une borne n’atteint qu’un composant. Vérifie si cette absence de connexion est voulue.",
      selectIds: dangling.selectIds,
    };
  } else if (busy) {
    next = {
      kind: "none",
      label: "Calcul en cours",
      message: "Les mesures apparaîtront à la fin du calcul.",
      selectIds: [],
    };
  } else if (!hasCurrentMeasurements) {
    next = {
      kind: "run",
      label: "Calculer les mesures",
      message:
        "Le calcul permettra de tester le comportement électrique du montage.",
      selectIds: [],
    };
  } else {
    next = {
      kind: "none",
      label: "Prêt à expérimenter",
      message:
        "Change une valeur, prédis son effet, puis compare les mesures dans le carnet.",
      selectIds: [],
    };
  }
  const observations: ResistorObservation[] = [];
  if (hasCurrentMeasurements && simulation)
    for (const component of components) {
      if (component.kind !== "resistor") continue;
      const positive =
        simulation.voltages[topology.terminal_to_net[component.pins.p]];
      const negative =
        simulation.voltages[topology.terminal_to_net[component.pins.n]];
      const current = simulation.currents[component.id];
      if (!finite(positive) || !finite(negative) || !finite(current)) continue;
      const voltage = positive - negative;
      const power = voltage * current;
      if (!finite(voltage) || !finite(power)) continue;
      observations.push({
        id: component.id,
        label: component.label || component.id,
        voltage,
        current,
        power,
      });
    }
  return {
    checks,
    issues,
    connectedPins,
    totalPins: terminals.size,
    next,
    observations,
    hasCurrentMeasurements,
  };
}
