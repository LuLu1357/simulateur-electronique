import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircuitBoard,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Hand,
  Info,
  Link2,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
  Zap,
} from "lucide-react";
import { api } from "./api";
import { rotationOperations } from "./editing";
import { createSimulationController } from "./simulationController";
import { withMeasurements, publishSimulationState, publishProjectState, isCurrentProjectRevision } from "./stateMerge";
import type { SimulationSnapshot } from "./simulationController";
import {
  handleEditorKey,
  isEditingTarget,
  requestSimulationStop,
} from "./interactions";
import { readPreferences, writePreferences } from "./preferences";
import type { DisplayPreferences, PreferencesStorage } from "./preferences";
import { voltageColor, fitCircuitView } from "./visuals";
import { FlowParticles } from "./components/FlowParticles";
import { BreadboardView } from "./components/BreadboardView";
import { boardLinks, wirePath } from "./connectivity";
import { colors, format, holePoint, pinOffsets, pinPoints } from "./types";
import type {
  Component,
  Diagnostic,
  Op,
  Project,
  Simulation,
  State,
} from "./types";
import "./style.css";
const kindNames: Record<string, string> = {
  resistor: "Résistance",
  voltage_source: "Source continue",
  switch: "Interrupteur",
  button: "Bouton",
  diode: "Diode",
  npn: "Transistor NPN",
  pnp: "Transistor PNP",
  capacitor: "Condensateur",
  ground: "Masse",
  voltage_probe: "Sonde de tension",
  current_probe: "Sonde de courant",
};
function ComponentGlyph({ kind }: { kind: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "resistor" ? (
        <>
          <path d="M1 12H6M18 12H23" />
          <rect x="6" y="8" width="12" height="8" rx="1" />
        </>
      ) : kind === "voltage_source" ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 1V4M12 20V23M9 9H15M12 6V12M10 16H14" />
        </>
      ) : kind === "capacitor" ? (
        <path d="M1 12H9M9 5V19M15 5V19M15 12H23" />
      ) : kind === "diode" ? (
        <>
          <path d="M1 12H7M17 12H23M17 5V19M7 5L17 12L7 19Z" />
        </>
      ) : kind === "ground" ? (
        <path d="M12 2V13M3 13H21M6 17H18M9 21H15" />
      ) : kind === "npn" || kind === "pnp" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M1 12H9M9 6V18M9 9L18 4M9 15L18 20" />
          <path
            d={kind === "npn" ? "M13 19L17 19L16 15" : "M10 15L10 19L14 17"}
          />
        </>
      ) : kind === "switch" || kind === "button" ? (
        <>
          <path d="M1 15H6M18 15H23M6 15L17 7" />
          {kind === "button" && <path d="M9 3H17M13 3V7" />}
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M1 12H4M20 12H23" />
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fill="currentColor"
            stroke="none"
            fontSize="11"
          >
            {kind === "current_probe" ? "A" : "V"}
          </text>
        </>
      )}
    </svg>
  );
}
function preferenceStorage(): PreferencesStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function reducedMotionRequested() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
function Symbol({ c }: { c: Component }) {
  const k = c.kind;
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <g {...common}>
      {k === "resistor" ? (
        <>
          <path d="M-48 0H-25M25 0H48" />
          <rect x="-25" y="-10" width="50" height="20" rx="2" />
        </>
      ) : k === "voltage_source" ? (
        <>
          <path d="M-48 0H-21M21 0H48" />
          <circle r="21" />
          <path d="M-13 -5V5M-18 0H-8M8 0H18" />
        </>
      ) : k === "ground" ? (
        <>
          <path d="M0 -28V0M-17 0H17M-11 6H11M-5 12H5" />
        </>
      ) : k === "capacitor" ? (
        <>
          <path d="M-48 0H-5V-17M-5 0V17M5 -17V17M5 0H48" />
        </>
      ) : k === "diode" ? (
        <>
          <path d="M-48 0H-16M16 0H48M16 -17V17" />
          <path d="M-16 -17L16 0L-16 17Z" />
        </>
      ) : k === "npn" || k === "pnp" ? (
        <>
          <circle r="25" />
          <path d="M-44 0H-10M-10 -18V18M-10 -10L32 -34M-10 10L32 34" />
          {k === "npn" ? (
            <path d="M14 30L24 29L19 20" />
          ) : (
            <path d="M4 12L4 22L14 18" />
          )}
        </>
      ) : k === "switch" || k === "button" ? (
        <>
          <path d={`M-48 0H-20M20 0H48M-20 0L20 ${c.value ? 0 : -18}`} />
          <circle cx="-20" r="3" />
          <circle cx="20" r="3" />
          {k === "button" && <path d="M0 -24V-12M-9 -24H9" />}
        </>
      ) : (
        <>
          <path d="M-48 0H-20M20 0H48" />
          <circle r="20" />
          <text
            stroke="none"
            fill="currentColor"
            x="0"
            y="5"
            textAnchor="middle"
            fontSize="14"
          >
            {k === "current_probe" ? "A" : "V"}
          </text>
        </>
      )}
    </g>
  );
}
function Oscilloscope({ sim }: { sim: Simulation | null }) {
  const [visible, setVisible] = useState<string[]>([]);
  const curves = sim?.curves || [];
  useEffect(() => {
    setVisible(
      curves
        .filter((c) => c.unit === "V")
        .slice(0, 3)
        .map((c) => c.id),
    );
  }, [sim?.project_revision, curves.length]);
  const time = sim?.time || [];
  const units = [
    ...new Set(curves.filter((c) => visible.includes(c.id)).map((c) => c.unit)),
  ];
  return (
    <div className="scope">
      <div className="curve-choices">
        {curves.map((c, i) => (
          <button
            key={c.id}
            className={visible.includes(c.id) ? "curve active" : "curve"}
            style={
              { "--curve": colors[i % colors.length] } as React.CSSProperties
            }
            onClick={() =>
              setVisible((v) =>
                v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id],
              )
            }
          >
            <i />
            {c.label} <small>{c.unit}</small>
          </button>
        ))}
      </div>
      {!time.length ? (
        <div className="empty">
          <Activity size={30} />
          <p>Le temps révèle le circuit.</p>
          <span>
            Lance une simulation temporelle pour observer les courbes.
          </span>
        </div>
      ) : (
        units.map((unit) => {
          const selected = curves.filter(
              (c) => visible.includes(c.id) && c.unit === unit,
            ),
            all = selected.flatMap((c) => c.values),
            w = 850,
            h = 178,
            left = 70,
            top = 18,
            min = Math.min(0, ...all),
            max = Math.max(unit === "V" ? 1 : 1e-9, ...all),
            span = max - min;
          return (
            <svg
              key={unit}
              viewBox={`0 0 ${w} ${h}`}
              aria-label={`Oscilloscope — ${unit === "V" ? "tensions" : "courants"}`}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <g key={i}>
                  <line
                    className="plot-grid"
                    x1={left}
                    x2={w - 20}
                    y1={top + i * 29}
                    y2={top + i * 29}
                  />
                  <text
                    className="axis"
                    x={left - 9}
                    y={top + i * 29 + 4}
                    textAnchor="end"
                  >
                    {format(max - (span * i) / 4, unit)}
                  </text>
                </g>
              ))}
              {Array.from({ length: 7 }, (_, i) => (
                <g key={i}>
                  <line
                    className="plot-grid"
                    x1={left + (i * (w - left - 20)) / 6}
                    x2={left + (i * (w - left - 20)) / 6}
                    y1={top}
                    y2={h - 43}
                  />
                  <text
                    className="axis"
                    x={left + (i * (w - left - 20)) / 6}
                    y={h - 17}
                    textAnchor="middle"
                  >
                    {format(((time.at(-1) || 0) * i) / 6, "s")}
                  </text>
                </g>
              ))}
              {selected.map((c) => {
                const stride = Math.max(1, Math.floor(c.values.length / 1000));
                const points = c.values
                  .map((v, i) =>
                    i % stride === 0 || i === c.values.length - 1
                      ? `${left + ((time[i] || 0) / (time.at(-1) || 1)) * (w - left - 20)},${top + ((max - v) / span) * 116}`
                      : null,
                  )
                  .filter(Boolean)
                  .join(" ");
                return (
                  <polyline
                    key={c.id}
                    points={points}
                    fill="none"
                    stroke={colors[curves.indexOf(c) % colors.length]}
                    strokeWidth="2"
                  />
                );
              })}
            </svg>
          );
        })
      )}
    </div>
  );
}
function CurrentArrow({
  c,
  current,
  rotation = 0,
}: {
  c: Component;
  current: number;
  rotation?: number;
}) {
  const pins = Object.values(pinOffsets(c));
  if (pins.length < 2) return null;
  const a = pins[0],
    b = pins.at(-1)!,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy) || 1,
    offset = 27,
    nx = Math.abs(dy) > Math.abs(dx) ? dy / len : -dy / len,
    ny = Math.abs(dy) > Math.abs(dx) ? -dx / len : dx / len;
  const start = [a[0] + dx * 0.3 + nx * offset, a[1] + dy * 0.3 + ny * offset],
    end = [b[0] - dx * 0.3 + nx * offset, b[1] - dy * 0.3 + ny * offset];
  const from = current >= 0 ? start : end,
    to = current >= 0 ? end : start;
  return (
    <g>
      <path
        transform={`rotate(${rotation})`}
        d={`M${from[0]} ${from[1]}L${to[0]} ${to[1]}`}
        stroke="#efbe68"
        strokeWidth="1.5"
        markerEnd="url(#currentArrow)"
      />
      <text
        className="current-label"
        x={pins.length === 3 ? 86 : 0}
        y={pins.length === 3 ? 5 : 66}
        textAnchor="middle"
      >
        {format(Math.abs(current), "A")}
      </text>
    </g>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tool, setTool] = useState("select"),
    [tab, setTab] = useState("measures"),
    [pending, setPending] = useState<string | null>(null),
    [hoverNet, setHoverNet] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
      null,
    ),
    [preferences, setPreferences] = useState<DisplayPreferences>(() =>
      readPreferences(preferenceStorage(), reducedMotionRequested()),
    ),
    [calculation, setCalculation] = useState<SimulationSnapshot>(() =>
      createSimulationController().getSnapshot(),
    ),
    [analysis, setAnalysis] = useState("op"),
    [stopTime, setStopTime] = useState("0.02"),
    [step, setStep] = useState("0.0001"),
    [examples, setExamples] = useState<{ id: string; title: string }[]>([]),
    [exampleOpen, setExampleOpen] = useState(false),
    [truth, setTruth] = useState<Record<string, unknown> | null>(null),
    [help, setHelp] = useState(false),
    [boardWire, setBoardWire] = useState<string | null>(null),
    [pinToPlace, setPinToPlace] = useState(""),
    [measureA, setMeasureA] = useState(""),
    [measureB, setMeasureB] = useState("0"),
    [draftValue, setDraftValue] = useState(""),
    [annotation, setAnnotation] = useState(""),
    [titleDraft, setTitleDraft] = useState(""),
    [netName, setNetName] = useState(""),
    [boardHoleDraft, setBoardHoleDraft] = useState(""),
    [preferencesSaved, setPreferencesSaved] = useState<boolean | null>(null);
  const {
    showVolts,
    showCurrent,
    voltageColors,
    voltageRange,
    flowMode,
    flowSpeed,
  } = preferences;
  const busy = calculation.phase !== "idle";
  const lastFlowMode = useRef<DisplayPreferences["flowMode"]>(
    flowMode === "off" ? "electrons" : flowMode,
  );
  if (flowMode !== "off") lastFlowMode.current = flowMode;
  const updatePreference = <K extends keyof DisplayPreferences>(
    key: K,
    value: DisplayPreferences[K],
  ) => setPreferences((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    setPreferencesSaved(writePreferences(preferenceStorage(), preferences));
  }, [preferences]);
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const changed = () => {
      if (media.matches)
        setPreferences((current) => ({ ...current, flowMode: "off" }));
    };
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, []);
  const guideRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = guideRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, [help]);
  const [boardPreview, setBoardPreview] = useState<State | null>(null);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const svgRef = useRef<SVGSVGElement>(null),
    importRef = useRef<HTMLInputElement>(null),
    stateRef = useRef<State | null>(null);
  stateRef.current = state;
  const controlRef = useRef<ReturnType<
    typeof createSimulationController
  > | null>(null);
  if (!controlRef.current)
    controlRef.current = createSimulationController({
      onChange: setCalculation,
    });
  const control = controlRef.current;
  const simulationCommit = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const ticket = control.beginPoll();
      const next = await api<State>("state");
      if (!isCurrentProjectRevision(stateRef.current, next)) return;
      if (!control.acceptPoll(ticket, !!next.running)) return;
      stateRef.current = next;
      setState((current) => publishProjectState(current, next));
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    refresh();
    api<
      | { id: string; title: string }[]
      | { examples: { id: string; title: string }[] }
    >("examples")
      .then((x) => setExamples(Array.isArray(x) ? x : x.examples))
      .catch(() => {});
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);
  const publishProject = useCallback((incoming: State): State => {
    const published = publishProjectState(stateRef.current, incoming);
    if (published !== incoming) {
      void refresh();
      return published;
    }
    control.invalidatePolls();
    stateRef.current = published;
    setState((current) => publishProjectState(current, published));
    return published;
  }, [refresh]);
  const act = useCallback(
    (ops: Op[], preview = false): Promise<State | undefined> => {
      const job = mutationQueue.current.then(async () => {
        const current = stateRef.current;
        if (!current) return;
        try {
          control.invalidatePolls();
          const committedBefore = simulationCommit.current;
          let next = await api<State>("transaction", {
            expected_revision: current.project.revision,
            operations: ops,
            preview,
          });
          if (!preview) {
            const latest = stateRef.current;
            if (
              latest &&
              committedBefore !== simulationCommit.current &&
              next.project.revision >= latest.project.revision
            )
              next = withMeasurements(next, latest);
            next = publishProject(next);
          }
          setError("");
          return next;
        } catch (e) {
          setError(String(e).replace(/^Error: /, ""));
          await refresh();
        }
      });
      mutationQueue.current = job;
      return job;
    },
    [refresh, publishProject],
  );
  const p = state?.project;
  const centerCircuit = (project = p) => {
    const view = fitCircuitView([
      ...Object.values(project?.schematic || {}),
      ...(project?.junctions || []),
    ]);
    setZoom(view.zoom);
    setPan(view.pan);
  };
  // Un nouveau projet est cadré une fois ; le suivi MCP ne déplace pas la caméra.
  useEffect(() => {
    if (p) centerCircuit(p);
  }, [p?.id]);
  useEffect(() => {
    setBoardHoleDraft(p?.breadboard.placements[pinToPlace] || "");
  }, [pinToPlace, p?.breadboard.placements[pinToPlace]]);
  useEffect(() => {
    if (p) setTitleDraft(p.title);
  }, [p?.title]);
  const selected = p?.ui.selected || [];
  const comp = p?.components.find((c) => selected.includes(c.id));
  useEffect(() => {
    setDraftValue(comp ? String(comp.value) : "");
    setPinToPlace(comp ? Object.values(comp.pins)[0] : "");
  }, [comp?.id, comp?.value]);
  useEffect(() => {
    const net = state?.topology.terminal_to_net[pinToPlace];
    const label =
      Object.entries(p?.net_labels || {}).find(
        ([id]) => state?.topology.terminal_to_net[id] === net,
      )?.[1] || "";
    setNetName(label);
  }, [pinToPlace, JSON.stringify(p?.net_labels)]);
  const rawSim = state?.simulation || null;
  const sim =
    rawSim?.status === "success"
      ? rawSim
      : state?.last_success || rawSim?.last_success || null;
  const stale = !!(
    sim &&
    p &&
    (rawSim?.status === "success" ? rawSim.stale : state?.last_success?.stale)
  );
  const tn = state?.topology.terminal_to_net || {};
  const points = p ? pinPoints(p) : {};
  if (drag && p) {
    const c = p.components.find((c) => c.id === drag.id);
    if (c) {
      const angle = ((p.schematic[c.id]?.rotation || 0) * Math.PI) / 180;
      for (const [k, v] of Object.entries(pinOffsets(c)))
        points[c.pins[k]] = [
          drag.x + v[0] * Math.cos(angle) - v[1] * Math.sin(angle),
          drag.y + v[0] * Math.sin(angle) + v[1] * Math.cos(angle),
        ];
    }
  }
  const selectedNets = new Set(
    selected.flatMap((id) => {
      const c = p?.components.find((c) => c.id === id);
      return c ? Object.values(c.pins).map((x) => tn[x]) : [tn[id] || id];
    }),
  );
  const highlights = (p?.ui.highlights || []).flatMap((x) =>
    typeof x === "string"
      ? [x]
      : typeof x === "object" && x
        ? Object.values(x).flat()
        : [],
  ) as string[];
  for (const x of highlights) selectedNets.add(tn[x] || x);
  const netColor = (net: string) =>
    net === "0"
      ? "#778ba3"
      : colors[
          Math.abs([...net].reduce((a, c) => a + c.charCodeAt(0), 0)) %
            colors.length
        ];
  const wirePaint = (net: string) =>
    voltageColors
      ? voltageColor(sim?.voltages[net], voltageRange)
      : netColor(net);
  const animatedMode = stale ? "off" : flowMode;
  const voltage = (terminal: string) => sim?.voltages[tn[terminal] || terminal];
  const select = (id: string) => act([{ type: "set_ui", selected: [id] }]);
  const clickPin = async (id: string) => {
    if (tool === "wire" || pending) {
      if (pending && pending !== id) {
        const next = await act([{ type: "connect", a: pending, b: id }]);
        if (next) {
          setPending(null);
          setNotice(
            "Fil ajouté : les deux points appartiennent au même réseau.",
          );
        }
      } else {
        setPending(id);
        setNotice("Choisis la deuxième borne, ou un trou de la breadboard.");
      }
    } else {
      setPinToPlace(id);
      setPending(id);
      setNotice(
        `Borne ${id} : clique une autre borne pour câbler, ou un trou pour la placer.`,
      );
    }
  };
  const toSvg = (e: React.PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM()!.inverse(),
    );
    return { x: (pt.x - pan.x) / zoom, y: (pt.y - pan.y) / zoom };
  };
  const run = async () => {
    if (!control.getSnapshot().canStart) return;
    setError("");
    try {
      const next = await control.start((signal?: AbortSignal) =>
        api<State>(
          "simulate",
          {
            analysis: {
              kind: analysis,
              step: Number(step),
              stop: Number(stopTime),
            },
          },
          { signal },
        ),
      );
      if (!next) return;
      simulationCommit.current += 1;
      control.invalidatePolls();
      const published = publishSimulationState(stateRef.current, next);
      stateRef.current = published;
      setState(published);
      setTab(analysis === "tran" ? "scope" : "measures");
      setNotice(
        next.simulation?.status === "success"
          ? analysis === "op"
            ? "État stabilisé calculé. Les mesures sont prêtes ; l’animation est indépendante du calcul."
            : "Évolution temporelle calculée. Consulte les courbes de charge et de courant."
          : "Calcul arrêté ou impossible : consulte les diagnostics.",
      );
    } catch (e) {
      if ((e as Error)?.name === "AbortError")
        setNotice("Calcul interrompu. Animation en pause.");
      else setError(String(e));
    }
  };
  const stopCalculation = async () => {
    updatePreference("flowMode", "off");
    try {
      const stopped = await control.stop(() => api("stop", {}));
      setNotice(
        stopped
          ? "Arrêt du calcul demandé. Animation en pause."
          : "Le calcul était terminé. Animation en pause.",
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const toggleAnimation = () =>
    updatePreference(
      "flowMode",
      flowMode === "off"
        ? lastFlowMode.current === "off"
          ? "electrons"
          : lastFlowMode.current
        : "off",
    );
  const doHistory = async (which: string) => {
    if (!p) return;
    try {
      publishProject(await api<State>(which, { expected_revision: p.revision }));
      setPending(null);
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = () => {
    if (!p) return;
    const ops = selected.flatMap((id) =>
      p.components.some((c) => c.id === id)
        ? [{ type: "remove_component", id }]
        : p.wires.some((w) => w.id === id)
          ? [{ type: "remove_wire", id }]
          : p.junctions.some((j) => j.id === id)
            ? [{ type: "remove_junction", id }]
            : [],
    );
    if (ops.length) act(ops);
  };
  const rotateSelection = (direction: 1 | -1 = 1) => {
    if (!p) return;
    const operations = rotationOperations(p, selected, direction);
    if (operations.length) act(operations);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        exampleOpen &&
        !help &&
        e.key === "Escape" &&
        !isEditingTarget(e.target)
      ) {
        e.preventDefault();
        setExampleOpen(false);
        return;
      }
      handleEditorKey(e, {
        helpOpen: help,
        closeHelp: () => setHelp(false),
        cancelWiring: () => {
          setPending(null);
          setBoardWire(null);
          setTool("select");
        },
        removeSelection: remove,
        history: doHistory,
        selectTool: setTool,
        rotateSelection,
      });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const save = async () => {
    try {
      await api("save", {});
      setNotice("Projet sauvegardé sur cet ordinateur.");
    } catch (e) {
      setError(String(e));
    }
  };
  const exportProject = () => {
    if (!p) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
    );
    a.download = `${p.title.replace(/[^\p{L}\d-]/gu, "_")}.atelier.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const loadExample = async (id: string) => {
    if (!p) return;
    try {
      const next = await api<State>("load-example", {
        id,
        expected_revision: p.revision,
      });
      if (publishProject(next) !== next) return;
      centerCircuit(next.project);
      setTruth(null);
      setAnalysis(id === "rc" ? "tran" : "op");
      if (id === "rc") {
        setStopTime("0.006");
        setStep("0.00001");
      }
      setPending(null);
      setExampleOpen(false);
      setNotice("Exemple chargé. Tu peux annuler pour retrouver ton circuit.");
    } catch (e) {
      setError(String(e));
    }
  };
  const previewBoardLayout = async () => {
    if (!stateRef.current || busy) return;
    const candidate = await act([{ type: "layout_breadboard" }], true);
    if (candidate) {
      setPending(null);
      setBoardWire(null);
      setBoardPreview(candidate);
      setNotice(
        "Aperçu de l’implantation : vérifie la plaque puis applique le placement.",
      );
    }
  };
  const applyBoardLayout = async () => {
    if (!boardPreview || busy) return;
    try {
      control.invalidatePolls();
      const next = await api<State>("transaction", {
        expected_revision: boardPreview.project.revision,
        operations: [{ type: "layout_breadboard" }],
      });
      const published = publishProject(next);
      setBoardPreview(null);
      if (published !== next) return;
      setNotice(
        "Implantation appliquée, réseaux conservés. Recalcule pour actualiser les flux et mesures.",
      );
    } catch (e) {
      setError(String(e));
      await refresh();
    }
  };
  const testTruth = async () => {
    if (!control.getSnapshot().canStart) return;
    setTab("truth");
    setError("");
    try {
      const result = await control.start((signal?: AbortSignal) =>
        api<Record<string, unknown>>(
          "truth-table",
          { example: "subtractor" },
          { signal },
        ),
      );
      if (result) setTruth(result);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setNotice("Essais interrompus.");
      else setError(String(e));
    }
  };
  const diags = [...(state?.diagnostics || []), ...(rawSim?.diagnostics || [])];
  const emptyCircuit = !!p && !p.components.length;
  const calculationFailed =
    !!rawSim && ["error", "timeout", "cancelled"].includes(rawSim.status);
  const calculationBusy = busy || !!state?.running;
  const commonPoints =
    !!p &&
    (p.wires.length > 0 || Object.keys(p.breadboard.placements).length > 0);
  const journeyStep =
    !state || emptyCircuit
      ? 0
      : pending || tool === "wire" || !commonPoints
        ? 1
        : !sim || stale || calculationFailed
          ? 2
          : 3;
  const contextualHint = !state
    ? "Connexion au service local…"
    : emptyCircuit
      ? "Commence par une source continue, une résistance et une masse dans la bibliothèque."
      : pending
        ? `Borne ${pending} choisie : active une autre borne pour créer un fil, ou choisis un trou sur la breadboard. Échap annule le geste.`
        : calculationFailed
          ? "Le dernier calcul n’a pas abouti. Consulte les observations et le journal du moteur pour décider du prochain essai."
          : stale
            ? "Le circuit a changé : relance le calcul avant d’interpréter les mesures ou les animations."
            : !sim
              ? "Relie les bornes, vérifie le retour à la masse, puis lance Simuler. Un croisement de fils reste isolé."
              : "Sélectionne un composant pour lire ses tensions et son courant. Compare une prédiction aux valeurs calculées.";
  const focusLibrary = () =>
    document
      .getElementById("component-library")
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus();
  const focusResults = () => {
    setTab("measures");
    document.getElementById("simulation-results")?.focus();
  };
  return (
    <div className="app">
      <nav className="rail" aria-label="Navigation de l’atelier">
        <div className="brand-mark">
          <Zap size={22} />
        </div>
        <button
          className="rail-button active"
          title="L’atelier"
          aria-label="L’atelier"
          aria-current="page"
          onClick={() => document.getElementById("studio")?.focus()}
        >
          <CircuitBoard />
        </button>
        <button
          className="rail-button"
          onClick={() => setExampleOpen(!exampleOpen)}
          title="Circuits d’exemple"
          aria-label="Circuits d’exemple"
          aria-expanded={exampleOpen}
          aria-controls="example-menu"
        >
          <FolderOpen />
        </button>
        <button
          className="rail-button"
          onClick={() => setHelp(true)}
          title="Guide de l’atelier"
          aria-label="Guide de l’atelier"
        >
          <BookOpen />
        </button>
        <div className="rail-bottom">
          <button
            className="rail-button"
            title="À propos des modèles"
            aria-label="À propos des modèles"
            onClick={() => {
              setTab("diagnostics");
              setNotice(
                "Les modèles et leurs hypothèses sont visibles dans l’inspecteur.",
              );
            }}
          >
            <Info />
          </button>
          <span className="avatar">LS</span>
        </div>
      </nav>
      <div className="workspace">
        <header>
          <div className="heading">
            <span className="eyebrow">LE LABORATOIRE PERSONNEL</span>
            <h1>
              Atelier<span> / Électronique</span>
            </h1>
          </div>
          <div className="header-right">
            <span className="local-badge">
              <i />
              Local · ngspice
            </span>
            <button className="subtle" onClick={() => setHelp(true)}>
              <BookOpen size={16} />
              Guide
            </button>
            <button className="save" onClick={save}>
              <Save size={15} />
              Sauvegarder
            </button>
          </div>
        </header>
        <div className="project-bar">
          <div className="project-name">
            <CircuitBoard size={18} />
            <input
              aria-label="Nom du projet"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={(e) => {
                if (e.target.value !== p?.title)
                  act([{ type: "set_title", title: e.target.value }]);
              }}
            />
            <span className="tag">PROJET</span>
          </div>
          <span className="revision">
            Révision {p?.revision ?? "—"} <i /> JSON v1
          </span>
          <div className="project-actions">
            <button
              title="Nouveau circuit"
              aria-label="Nouveau circuit"
              onClick={async () => {
                if (p) {
                  try {
                    publishProject(
                      await api<State>("new", {
                        expected_revision: p.revision,
                      }),
                    );
                  } catch (e) {
                    setError(String(e));
                  }
                }
              }}
            >
              <FilePlus2 size={16} />
            </button>
            <div className="example-wrap">
              <button
                aria-expanded={exampleOpen}
                aria-controls="example-menu"
                onClick={() => setExampleOpen(!exampleOpen)}
              >
                <FolderOpen size={16} />
                Exemples
                <ChevronDown size={12} />
              </button>
              {exampleOpen && (
                <div
                  className="example-menu"
                  id="example-menu"
                  role="group"
                  aria-label="Circuits d’exemple"
                >
                  {examples.map((e) => (
                    <button key={e.id} onClick={() => loadExample(e.id)}>
                      <CircuitBoard size={15} />
                      {e.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => importRef.current?.click()}
              title="Importer un projet"
              aria-label="Importer un projet"
            >
              <Upload size={16} />
            </button>
            <button
              onClick={exportProject}
              title="Exporter le projet"
              aria-label="Exporter le projet"
            >
              <Download size={16} />
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !p) return;
                try {
                  publishProject(
                    await api<State>("import", {
                      project: JSON.parse(await f.text()),
                      expected_revision: p.revision,
                    }),
                  );
                  setNotice("Projet importé et validé.");
                } catch (err) {
                  setError(String(err));
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <main>
          <aside className="library">
            <div className="section-title">
              COMPOSANTS <span>{Object.keys(kindNames).length}</span>
            </div>
            <p className="muted library-intro">
              Clique un composant pour l’ajouter, puis déplace-le dans le
              schéma.
            </p>
            <div
              className="component-list"
              id="component-library"
              aria-label="Bibliothèque de composants"
            >
              {Object.entries(kindNames).map(([kind, name]) => (
                <button
                  className="component-add"
                  key={kind}
                  aria-label={`Ajouter : ${name}`}
                  title={`Ajouter : ${name}`}
                  disabled={!state}
                  onClick={() =>
                    act([
                      {
                        type: "add_component",
                        kind,
                        x: 220 + ((p?.components.length || 0) % 4) * 130,
                        y:
                          170 +
                          (Math.floor((p?.components.length || 0) / 4) % 3) *
                            110,
                      },
                    ])
                  }
                >
                  <span className={`component-icon ${kind}`} aria-hidden="true">
                    <ComponentGlyph kind={kind} />
                  </span>
                  <span className="component-name">{name}</span>
                  <Plus size={13} />
                </button>
              ))}
            </div>
            <p className="scroll-hint library-scroll-hint">
              ↔ Fais défiler les composants, puis choisis celui à ajouter.
            </p>
            <div className="library-tip">
              <Sparkles size={17} />
              <strong>Voir. Mesurer. Comprendre.</strong>
              <p>
                Un croisement de fils ne crée pas de connexion. Ajoute une
                jonction pour relier des branches.
              </p>
              <button onClick={() => setHelp(true)}>
                Prendre en main
                <ChevronRight size={13} />
              </button>
            </div>
            <details className="mcp-card">
              <summary>
                <Workflow size={17} />
                <strong>Assistant MCP</strong>
              </summary>
              <p>Le même circuit, accessible à ton assistant.</p>
              <span>Transport local · stdio</span>
            </details>
          </aside>
          <section
            className="studio"
            id="studio"
            tabIndex={-1}
            aria-label="Édition et simulation"
          >
            <nav className="journey" aria-label="Les quatre étapes du circuit">
              {[
                ["Ajouter", "Depuis la bibliothèque"],
                ["Relier", "Deux bornes, un fil"],
                ["Simuler", "Calculer avec ngspice"],
                ["Comprendre", "Tensions et courants"],
              ].map(([label, detail], index) => (
                <button
                  key={label}
                  className={`journey-step ${index === journeyStep ? "current" : index < journeyStep ? "done" : ""}`}
                  aria-current={index === journeyStep ? "step" : undefined}
                  disabled={
                    index === 2 && (!state || emptyCircuit || calculationBusy)
                  }
                  onClick={() => {
                    if (index === 0) focusLibrary();
                    else if (index === 1) {
                      setTool("wire");
                      setPending(null);
                      setNotice(
                        "Choisis une première borne, puis une seconde pour les relier.",
                      );
                    } else if (index === 2) run();
                    else focusResults();
                  }}
                >
                  <span className="step-index">{index + 1}</span>
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="context-help">
              <p>{contextualHint}</p>
              <button
                className="context-action"
                onClick={() =>
                  calculationFailed ? setTab("diagnostics") : setHelp(true)
                }
              >
                {calculationFailed
                  ? "Voir les diagnostics"
                  : "Guide du premier circuit"}
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="toolbar">
              <div className="tools" role="group" aria-label="Outils du schéma">
                {[
                  ["select", MousePointer2, "Sélectionner (V)"],
                  ["wire", Link2, "Câbler (W)"],
                  ["junction", Plus, "Ajouter une jonction"],
                  ["pan", Hand, "Déplacer la vue"],
                ].map(([id, Icon, title]) => (
                  <button
                    key={String(id)}
                    title={String(title)}
                    aria-label={String(title)}
                    aria-pressed={tool === id}
                    className={tool === id ? "active" : ""}
                    onClick={() => {
                      setTool(String(id));
                      setPending(null);
                    }}
                  >
                    {React.createElement(Icon as typeof MousePointer2, {
                      size: 17,
                    })}
                    {(id === "select" || id === "wire") && (
                      <span className="tool-label">
                        {id === "select" ? "Sélectionner" : "Relier"}
                      </span>
                    )}
                  </button>
                ))}
                <button
                  title="Tourner la sélection de 90° (R)"
                  aria-label="Tourner la sélection de 90°"
                  disabled={!p?.components.some((c) => selected.includes(c.id))}
                  onClick={() => rotateSelection()}
                >
                  <RotateCw size={17} />
                  <span className="tool-label">Tourner</span>
                </button>
                <i className="divider" />
                <button
                  title="Annuler ⌘Z"
                  aria-label="Annuler ⌘Z"
                  disabled={!state?.history.can_undo}
                  onClick={() => doHistory("undo")}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  title="Rétablir ⇧⌘Z"
                  aria-label="Rétablir ⇧⌘Z"
                  disabled={!state?.history.can_redo}
                  onClick={() => doHistory("redo")}
                >
                  <Redo2 size={17} />
                </button>
                <button
                  title="Supprimer la sélection"
                  aria-label="Supprimer la sélection"
                  disabled={!selected.length}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="simulation-controls">
                <select
                  aria-label="Type de simulation"
                  value={analysis}
                  onChange={(e) => setAnalysis(e.target.value)}
                >
                  <option value="op">État stabilisé · OP</option>
                  <option value="tran">Évolution temporelle · TRAN</option>
                </select>
                {busy ? (
                  <button
                    className="run stop"
                    onClick={stopCalculation}
                    disabled={!calculation.canStop}
                  >
                    <Pause size={14} />
                    {calculation.phase === "stopping"
                      ? "Arrêt en cours…"
                      : "Arrêter le calcul"}
                  </button>
                ) : (
                  <button
                    className="run"
                    onClick={run}
                    disabled={!state || emptyCircuit || !calculation.canStart}
                  >
                    <Play size={14} fill="currentColor" />
                    {analysis === "op" ? "Calculer OP" : "Calculer TRAN"}
                  </button>
                )}
                <button
                  className="animation-toggle"
                  onClick={toggleAnimation}
                  disabled={!sim || stale}
                  aria-pressed={flowMode !== "off"}
                  title={
                    !sim
                      ? "Calcule d’abord les courants"
                      : stale
                        ? "Recalcule le circuit modifié"
                        : "La lecture des points est indépendante du moteur ngspice"
                  }
                >
                  {flowMode === "off" ? (
                    <Play size={15} />
                  ) : (
                    <Pause size={15} />
                  )}{" "}
                  {flowMode === "off"
                    ? "Animer les courants"
                    : "Pause des points"}
                </button>
              </div>
            </div>
            <div className="analysis-help" role="note">
              <strong>
                {analysis === "op"
                  ? "OP : un état stabilisé"
                  : "TRAN : une évolution dans le temps"}
              </strong>
              <span>
                {analysis === "op"
                  ? "Un calcul bref fournit les tensions et courants continus. Les points peuvent ensuite défiler sans relancer ngspice."
                  : "Une source continue peut charger un condensateur : TRAN calcule cette évolution. Les courbes montrent le temps, les points illustrent le dernier instant calculé."}
              </span>
            </div>
            <details className="display-settings">
              <summary>
                <Settings2 size={16} />
                <span>Affichage & animations</span>
                <small>
                  {preferencesSaved === false
                    ? "Réglages temporaires"
                    : "Préférences locales"}
                </small>
              </summary>
              {preferencesSaved === false && (
                <p className="preferences-note">
                  Le stockage du navigateur est indisponible. Les réglages
                  restent utilisables pour cette session.
                </p>
              )}
              <div className="visual-controls">
                <label className="voltage-toggle">
                  <input
                    type="checkbox"
                    checked={voltageColors}
                    onChange={(e) =>
                      updatePreference("voltageColors", e.target.checked)
                    }
                  />
                  Couleur = tension
                </label>
                <div
                  className="voltage-scale"
                  title="Tension relative à la masse. Les couleurs saturent aux limites choisies ; les chiffres restent exacts."
                >
                  <span>−{voltageRange} V</span>
                  <i />
                  <span>0</span>
                  <b />
                  <span>+{voltageRange} V</span>
                </div>
                <label className="range-control">
                  Échelle ±
                  <input
                    aria-label="Échelle de couleur en volts"
                    type="number"
                    min="0.1"
                    max="1000000"
                    step="1"
                    value={voltageRange}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 0.1 && n <= 1000000 && Number.isFinite(n))
                        updatePreference("voltageRange", n);
                    }}
                  />
                  V
                </label>
                <label className="flow-mode-label">
                  <Activity size={13} />
                  <select
                    aria-label="Sens des particules animées"
                    value={flowMode}
                    onChange={(e) =>
                      updatePreference(
                        "flowMode",
                        e.target.value as DisplayPreferences["flowMode"],
                      )
                    }
                  >
                    <option value="electrons">Électrons −</option>
                    <option value="conventional">
                      Courant conventionnel +
                    </option>
                    <option value="off">Animation en pause</option>
                  </select>
                </label>
                <label className="speed-control">
                  Vitesse{" "}
                  <input
                    aria-label="Vitesse des particules"
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.25"
                    value={flowSpeed}
                    onChange={(e) =>
                      updatePreference("flowSpeed", Number(e.target.value))
                    }
                  />
                  <span>×{flowSpeed}</span>
                </label>
                <button
                  className="visual-info"
                  aria-label="Comprendre les couleurs et les points animés"
                  title="Points symboliques : dans les conducteurs métalliques, les électrons vont à l’opposé du courant conventionnel. La vitesse est pédagogique, pas une vitesse réelle d’électrons. Sous 1 nA, l’animation est masquée. Dans un réseau de fils idéaux comportant des boucles, le trajet animé est une répartition illustrative, pas un courant de fil unique."
                  onClick={() =>
                    setNotice(
                      "Électrons : sens inverse du courant conventionnel. Points symboliques, vitesse pédagogique. Boucles idéales : trajet indicatif ; courants inférieurs à 1 nA masqués.",
                    )
                  }
                >
                  <Info size={14} />
                </button>
              </div>
              <div className="flow-explanation">
                {flowMode === "electrons"
                  ? "Électrons − : sens opposé au courant conventionnel dans les conducteurs."
                  : flowMode === "conventional"
                    ? "Courant conventionnel + : sens positif des charges."
                    : "Points animés en pause."}
                <span>
                  {!sim
                    ? "Lance un calcul pour voir les couleurs et les points."
                    : stale
                      ? "Animation suspendue : recalcule le circuit modifié."
                      : Object.values(sim.wire_current_status || {}).some(
                            (x) => x === "underdetermined",
                          )
                        ? "Boucles idéales : trajets animés indicatifs, répartition des fils non unique."
                        : "Points symboliques · vitesse visuelle · flux inférieur à 1 nA masqué."}
                </span>
              </div>
            </details>
            <p className="animation-caption">
              Les mesures viennent de ngspice ; les points animés illustrent le
              transport des charges.
              {flowMode === "off"
                ? " Animation en pause : utilise « Animer les courants »."
                : ""}
              {sim &&
                !stale &&
                Object.values(sim.currents || {}).length > 0 &&
                Object.values(sim.currents || {}).every(
                  (i) => Math.abs(i) < 1e-9,
                ) && (
                  <strong className="zero-current-note">
                    {" "}
                    Pas de défilement : les courants calculés sont nuls ou
                    inférieurs à 1 nA.
                    {p?.components.some((c) => c.kind === "capacitor") &&
                    analysis === "op"
                      ? " En OP, un condensateur est ouvert en continu. Choisis TRAN pour observer sa charge."
                      : ""}
                  </strong>
                )}
            </p>
            {analysis === "tran" && (
              <div className="tran-settings">
                <label>
                  Durée{" "}
                  <input
                    value={stopTime}
                    onChange={(e) => setStopTime(e.target.value)}
                    type="number"
                    min="0.000001"
                    step="0.01"
                  />{" "}
                  s
                </label>
                <label>
                  Pas demandé{" "}
                  <input
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                    type="number"
                    min="0.000000001"
                    step="0.0001"
                  />{" "}
                  s
                </label>
                <span>
                  Conditions initiales : consulte les hypothèses du calcul.
                </span>
              </div>
            )}
            <div className={`views ${p?.ui.view || "split"}`}>
              <section className="schematic-panel">
                <div className="view-heading">
                  <div>
                    <span className="view-number">01</span>
                    <h2>Schéma électrique</h2>
                    <span className="synced">
                      <Link2 size={11} />
                      Synchronisé
                    </span>
                  </div>
                  <div className="view-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={showVolts}
                        onChange={(e) =>
                          updatePreference("showVolts", e.target.checked)
                        }
                      />
                      Tensions
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={showCurrent}
                        onChange={(e) =>
                          updatePreference("showCurrent", e.target.checked)
                        }
                      />
                      Courant
                    </label>
                    <button
                      title="Agrandir ou restaurer le schéma"
                      aria-label="Agrandir ou restaurer le schéma"
                      onClick={() =>
                        act([
                          {
                            type: "set_ui",
                            view:
                              p?.ui.view === "schematic"
                                ? "split"
                                : "schematic",
                          },
                        ])
                      }
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
                {emptyCircuit && (
                  <div className="circuit-empty">
                    <CircuitBoard size={28} />
                    <div>
                      <strong>Ton prochain circuit commence ici.</strong>
                      <p>
                        Ajoute une source, une résistance et une masse. Relie
                        ensuite leurs bornes pour former une boucle.
                      </p>
                    </div>
                    <button className="outline" onClick={focusLibrary}>
                      Choisir un composant
                      <Plus size={14} />
                    </button>
                  </div>
                )}
                <div
                  className="schematic-scroll"
                  role="region"
                  aria-label="Schéma : zone défilable"
                  tabIndex={0}
                >
                  <svg
                    ref={svgRef}
                    className={`schematic canvas-${tool}`}
                    viewBox="0 0 900 360"
                    aria-label="Éditeur de schéma électrique"
                    onPointerDown={(e) => {
                      if (
                        e.target !== e.currentTarget &&
                        !(e.target as Element).classList.contains("grid-bg")
                      )
                        return;
                      const pt = toSvg(e);
                      if (tool === "junction")
                        act([
                          {
                            type: "add_junction",
                            x: Math.round(pt.x / 10) * 10,
                            y: Math.round(pt.y / 10) * 10,
                          },
                        ]);
                      else if (tool === "pan") {
                        const start = {
                          x: e.clientX,
                          y: e.clientY,
                          px: pan.x,
                          py: pan.y,
                        };
                        const move = (ev: PointerEvent) =>
                          setPan({
                            x:
                              start.px +
                              ((ev.clientX - start.x) * 900) /
                                e.currentTarget.getBoundingClientRect().width,
                            y:
                              start.py +
                              ((ev.clientY - start.y) * 360) /
                                e.currentTarget.getBoundingClientRect().height,
                          });
                        const svg = e.currentTarget;
                        const safe = (ev: PointerEvent) =>
                          setPan({
                            x:
                              start.px +
                              ((ev.clientX - start.x) * 900) /
                                svg.getBoundingClientRect().width,
                            y:
                              start.py +
                              ((ev.clientY - start.y) * 360) /
                                svg.getBoundingClientRect().height,
                          });
                        void move;
                        window.addEventListener("pointermove", safe);
                        window.addEventListener(
                          "pointerup",
                          () => window.removeEventListener("pointermove", safe),
                          { once: true },
                        );
                      } else if (!pending)
                        act([{ type: "set_ui", selected: [] }]);
                    }}
                    onWheel={(e) => {
                      if (e.ctrlKey || e.metaKey)
                        setZoom((z) =>
                          Math.min(
                            3,
                            Math.max(0.1, z * (e.deltaY < 0 ? 1.1 : 0.9)),
                          ),
                        );
                    }}
                  >
                    <defs>
                      <pattern
                        id="dots"
                        width="20"
                        height="20"
                        patternUnits="userSpaceOnUse"
                      >
                        <circle cx="1" cy="1" r=".8" fill="#24334a" />
                      </pattern>
                      <marker
                        id="currentArrow"
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3"
                        orient="auto-start-reverse"
                      >
                        <path d="M0 0L6 3L0 6" fill="none" stroke="#efbe68" />
                      </marker>
                    </defs>
                    <rect
                      className="grid-bg"
                      width="100%"
                      height="100%"
                      fill="url(#dots)"
                    />
                    <g
                      transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}
                    >
                      {p &&
                        boardLinks(p).map((link, i) => {
                          const a = points[link.a],
                            b = points[link.b];
                          return a && b ? (
                            <path
                              key={`board_${i}`}
                              d={wirePath(p, link.a, link.b, points)}
                              stroke={wirePaint(tn[link.a])}
                              strokeWidth="1.5"
                              strokeDasharray="5 5"
                              fill="none"
                            >
                              <title>
                                Continuité par la breadboard : {link.group} ·{" "}
                                {link.a} ↔ {link.b}
                              </title>
                            </path>
                          ) : null;
                        })}
                      {p?.wires.map((w) => {
                        const a = points[w.a],
                          b = points[w.b];
                        if (!a || !b) return null;
                        const net = tn[w.a],
                          netName = state?.topology.nets.find(
                            (n) => n.id === net,
                          )?.name,
                          active =
                            selected.includes(w.id) ||
                            selectedNets.has(net) ||
                            hoverNet === net;
                        return (
                          <g
                            key={w.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              select(w.id);
                            }}
                            onMouseEnter={() => setHoverNet(net)}
                            onMouseLeave={() => setHoverNet(null)}
                          >
                            <path
                              d={wirePath(p, w.a, w.b, points)}
                              stroke={wirePaint(net || "")}
                              className={active ? "wire-selected" : ""}
                              strokeDasharray={
                                voltageColors &&
                                sim?.voltages[net] === undefined
                                  ? "4 5"
                                  : undefined
                              }
                              strokeWidth={active ? 3 : 2}
                              fill="none"
                            />
                            <path
                              d={wirePath(p, w.a, w.b, points)}
                              stroke="transparent"
                              strokeWidth="13"
                              fill="none"
                            />
                            <title>
                              {w.id} : {w.a} ↔ {w.b} · {netName || net} ·{" "}
                              {format(sim?.voltages[net])} ·{" "}
                              {sim?.wire_current_status?.[w.id] === "unique"
                                ? `Courant de fil : ${format(sim.wire_currents?.[w.id] ?? undefined, "A")}`
                                : "Trajet animé indicatif si une boucle idéale rend la répartition indéterminée."}
                            </title>
                            <FlowParticles
                              path={wirePath(p, w.a, w.b, points)}
                              current={
                                sim?.wire_currents?.[w.id] ??
                                sim?.wire_flow_hints?.[w.id]
                              }
                              mode={animatedMode}
                              speed={flowSpeed}
                              indicative={
                                sim?.wire_current_status?.[w.id] !== "unique"
                              }
                            />
                            {netName &&
                              p.net_labels &&
                              Object.values(p.net_labels).includes(netName) && (
                                <text
                                  className="network-name"
                                  x={(a[0] + b[0]) / 2 + 7}
                                  y={(a[1] + b[1]) / 2 - 7}
                                >
                                  {netName}
                                </text>
                              )}
                          </g>
                        );
                      })}
                      {p?.junctions.map((j) => (
                        <g key={j.id} onClick={() => clickPin(j.id)}>
                          <circle
                            cx={j.x}
                            cy={j.y}
                            r="5"
                            fill={pending === j.id ? "#f2c16e" : "#91b4cb"}
                          />
                          <circle cx={j.x} cy={j.y} r="12" fill="transparent" />
                          <text x={j.x + 9} y={j.y - 8} className="pin-label">
                            {j.id}
                          </text>
                        </g>
                      ))}
                      {p?.components.map((c) => {
                        const pos =
                          drag?.id === c.id
                            ? drag
                            : p.schematic[c.id] || { x: 150, y: 150 };
                        const isSel =
                          selected.includes(c.id) || highlights.includes(c.id);
                        const unit = state?.catalog[c.kind]?.unit || "";
                        return (
                          <g
                            key={c.id}
                            transform={`translate(${pos.x},${pos.y})`}
                            role="group"
                            tabIndex={0}
                            aria-label={`${c.label || c.id}, ${kindNames[c.kind]}, Entrée pour sélectionner`}
                            onKeyDown={(e) => {
                              if (
                                e.target === e.currentTarget &&
                                (e.key === "Enter" || e.key === " ")
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                select(c.id);
                              }
                            }}
                            className={
                              isSel
                                ? "electrical-component selected"
                                : "electrical-component"
                            }
                            onPointerDown={(e) => {
                              if (tool !== "select") return;
                              e.stopPropagation();
                              select(c.id);
                              const start = toSvg(e);
                              const initial = { x: pos.x, y: pos.y };
                              const svg = svgRef.current!;
                              const move = (ev: PointerEvent) => {
                                const pt = new DOMPoint(
                                  ev.clientX,
                                  ev.clientY,
                                ).matrixTransform(
                                  svg.getScreenCTM()!.inverse(),
                                );
                                setDrag({
                                  id: c.id,
                                  x:
                                    Math.round(
                                      (initial.x +
                                        (pt.x - pan.x) / zoom -
                                        start.x) /
                                        10,
                                    ) * 10,
                                  y:
                                    Math.round(
                                      (initial.y +
                                        (pt.y - pan.y) / zoom -
                                        start.y) /
                                        10,
                                    ) * 10,
                                });
                              };
                              const up = (ev: PointerEvent) => {
                                window.removeEventListener("pointermove", move);
                                const pt = new DOMPoint(
                                  ev.clientX,
                                  ev.clientY,
                                ).matrixTransform(
                                  svg.getScreenCTM()!.inverse(),
                                );
                                const x =
                                    Math.round(
                                      (initial.x +
                                        (pt.x - pan.x) / zoom -
                                        start.x) /
                                        10,
                                    ) * 10,
                                  y =
                                    Math.round(
                                      (initial.y +
                                        (pt.y - pan.y) / zoom -
                                        start.y) /
                                        10,
                                    ) * 10;
                                setDrag(null);
                                if (
                                  Math.abs(x - initial.x) +
                                    Math.abs(y - initial.y) >
                                  5
                                )
                                  act([
                                    { type: "move_component", id: c.id, x, y },
                                  ]);
                              };
                              window.addEventListener("pointermove", move);
                              window.addEventListener("pointerup", up, {
                                once: true,
                              });
                            }}
                          >
                            <rect
                              className="selection-box"
                              x="-60"
                              y="-54"
                              width="120"
                              height="108"
                              rx="10"
                            />
                            <g
                              transform={`rotate(${p.schematic[c.id]?.rotation || 0})`}
                            >
                              <Symbol c={c} />
                              {Object.entries(pinOffsets(c)).map(
                                ([name, point]) => {
                                  const value =
                                    sim?.terminal_currents?.[c.id]?.[name];
                                  if (value !== undefined) {
                                    return (
                                      <FlowParticles
                                        key={`flux_${name}`}
                                        path={`M${point[0]} ${point[1]}L0 0`}
                                        current={value}
                                        mode={animatedMode}
                                        speed={flowSpeed}
                                      />
                                    );
                                  }
                                  const entries = Object.entries(pinOffsets(c));
                                  if (
                                    entries.length !== 2 ||
                                    name !== entries[0][0]
                                  )
                                    return null;
                                  return (
                                    <FlowParticles
                                      key="branch_flux"
                                      path={`M${entries[0][1]}L${entries[1][1]}`}
                                      current={sim?.currents[c.id]}
                                      mode={animatedMode}
                                      speed={flowSpeed}
                                    />
                                  );
                                },
                              )}
                              {Object.entries(pinOffsets(c)).map(
                                ([name, [x, y]]) => (
                                  <g
                                    key={name}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Borne ${c.pins[name]}, ${pending === c.pins[name] ? "en attente" : "activer pour relier ou placer"}`}
                                    aria-pressed={pending === c.pins[name]}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        clickPin(c.pins[name]);
                                      }
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      clickPin(c.pins[name]);
                                    }}
                                    onMouseEnter={() =>
                                      setHoverNet(tn[c.pins[name]])
                                    }
                                    onMouseLeave={() => setHoverNet(null)}
                                  >
                                    <circle
                                      className={`terminal ${pending === c.pins[name] ? "pending" : ""}`}
                                      cx={x}
                                      cy={y}
                                      r="4"
                                    />
                                    <circle
                                      cx={x}
                                      cy={y}
                                      r="11"
                                      fill="transparent"
                                    />
                                    <title>
                                      {c.id} · {name.toUpperCase()} ·{" "}
                                      {c.pins[name]} ·{" "}
                                      {format(voltage(c.pins[name]))}
                                    </title>
                                    {(isSel ||
                                      c.kind === "npn" ||
                                      c.kind === "pnp") && (
                                      <text
                                        className="pin-label"
                                        x={x + (x < 0 ? -8 : 8)}
                                        y={y - 7}
                                        textAnchor={x < 0 ? "end" : "start"}
                                      >
                                        {name.toUpperCase()}
                                      </text>
                                    )}
                                    {showVolts && sim && (
                                      <text
                                        className="voltage-label"
                                        x={x}
                                        y={y + (y > 0 ? 20 : -15)}
                                        textAnchor="middle"
                                      >
                                        {format(voltage(c.pins[name]))}
                                      </text>
                                    )}
                                  </g>
                                ),
                              )}
                            </g>
                            <text
                              className="component-label"
                              x="0"
                              y={
                                c.kind === "ground"
                                  ? -66
                                  : c.kind === "npn" || c.kind === "pnp"
                                    ? -66
                                    : -42
                              }
                              textAnchor="middle"
                            >
                              {c.label || c.id}
                            </text>
                            <text
                              className="component-value"
                              x="0"
                              y="47"
                              textAnchor="middle"
                            >
                              {[
                                "ground",
                                "voltage_probe",
                                "current_probe",
                              ].includes(c.kind)
                                ? ""
                                : c.kind === "switch" || c.kind === "button"
                                  ? c.value
                                    ? "Fermé"
                                    : "Ouvert"
                                  : ["npn", "pnp", "diode"].includes(c.kind)
                                    ? c.model || "Générique"
                                    : format(c.value, unit)}
                            </text>
                            {showCurrent &&
                              sim?.currents[c.id] !== undefined && (
                                <CurrentArrow
                                  c={c}
                                  current={sim.currents[c.id]}
                                  rotation={p.schematic[c.id]?.rotation || 0}
                                />
                              )}
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                </div>
                <p className="scroll-hint">
                  Vue défilable ↔ · zoom et recentrage ci-dessous
                </p>
                <div className="canvas-foot">
                  <span>
                    {pending ? (
                      <>
                        <i className="live-dot" />
                        Connexion depuis {pending} · Échap pour annuler
                      </>
                    ) : (
                      <>
                        <MousePointer2 size={12} />
                        {tool === "wire"
                          ? "Clique deux bornes pour créer un fil"
                          : tool === "junction"
                            ? "Clique dans le schéma pour créer une jonction"
                            : "Déplace un composant · W pour câbler"}
                      </>
                    )}
                  </span>
                  <div>
                    <button
                      title="Dézoomer"
                      aria-label="Dézoomer"
                      onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                    >
                      <ZoomOut size={14} />
                    </button>
                    <span>{Math.round(zoom * 100)} %</span>
                    <button
                      title="Zoomer"
                      aria-label="Zoomer"
                      onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
                    >
                      <ZoomIn size={14} />
                    </button>
                    <button
                      title="Centrer le circuit"
                      aria-label="Centrer le circuit"
                      onClick={() => centerCircuit()}
                    >
                      <Maximize2 size={13} />
                    </button>
                  </div>
                </div>
              </section>
              {state && (
                <>
                  {boardPreview && (
                    <div className="layout-preview" role="status">
                      <div>
                        <strong>
                          Implantation proposée — aucun changement appliqué
                        </strong>
                        <p>
                          Les composants sont espacés et les jumpers conservent
                          les réseaux du schéma. Les sources et sondes restent
                          des raccordements externes.
                        </p>
                        {state.project.revision !==
                          boardPreview.project.revision && (
                          <p>
                            Le circuit a changé : actualise l’aperçu avant
                            d’appliquer.
                          </p>
                        )}
                      </div>
                      <div className="layout-preview-actions">
                        <button
                          className="run"
                          disabled={
                            state.project.revision !==
                              boardPreview.project.revision || busy
                          }
                          onClick={applyBoardLayout}
                        >
                          Appliquer cette implantation
                        </button>
                        <button
                          className="outline"
                          onClick={previewBoardLayout}
                        >
                          Actualiser l’aperçu
                        </button>
                        <button
                          className="outline"
                          onClick={() => setBoardPreview(null)}
                        >
                          Annuler l’aperçu
                        </button>
                      </div>
                    </div>
                  )}
                  <BreadboardView
                    state={boardPreview || state}
                    simulation={boardPreview ? null : sim}
                    stale={!!boardPreview || stale}
                    flowMode={animatedMode}
                    flowSpeed={flowSpeed}
                    voltageColors={voltageColors}
                    voltageRange={voltageRange}
                    pending={pending}
                    pinToPlace={pinToPlace}
                    tool={tool}
                    boardWire={boardWire}
                    preview={!!boardPreview}
                    onSelect={select}
                    onPin={setPinToPlace}
                    onTool={setTool}
                    onBoardWire={setBoardWire}
                    onPending={setPending}
                    onNotice={setNotice}
                    onError={setError}
                    onLayout={previewBoardLayout}
                    act={act}
                  />
                </>
              )}
            </div>
            <section
              className="results"
              id="simulation-results"
              tabIndex={-1}
              aria-label="Résultats de simulation"
            >
              {calculationFailed && (
                <div className="failed-result" role="status">
                  <Info size={19} />
                  <div>
                    <strong>
                      {rawSim?.status === "cancelled"
                        ? "Calcul arrêté"
                        : rawSim?.status === "timeout"
                          ? "Durée de calcul atteinte"
                          : "Le calcul n’a pas abouti"}
                    </strong>
                    <p>
                      {sim
                        ? `Les mesures visibles viennent du dernier calcul réussi (révision ${sim.project_revision}).`
                        : "Aucune nouvelle mesure n’est disponible."}{" "}
                      Le circuit est conservé. Consulte les diagnostics pour
                      examiner les connexions, les hypothèses et le journal
                      ngspice.
                    </p>
                  </div>
                  <button
                    className="outline"
                    onClick={() => setTab("diagnostics")}
                  >
                    Voir les diagnostics
                  </button>
                </div>
              )}
              {stale && !calculationFailed && (
                <p className="context-help">
                  Mesures précédentes : le circuit a changé depuis leur calcul.
                  Relance Simuler.
                </p>
              )}
              <nav className="result-tabs" aria-label="Vues des résultats">
                {[
                  ["measures", "Mesures", Activity],
                  ["scope", "Oscilloscope", Activity],
                  ["diagnostics", "Diagnostics", ShieldCheck],
                  ["truth", "Table de vérité", Workflow],
                  ["netlist", "Netlist", Copy],
                ].map(([id, label, Icon]) => (
                  <button
                    key={String(id)}
                    className={tab === id ? "active" : ""}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => setTab(String(id))}
                  >
                    {React.createElement(Icon as typeof Activity, { size: 14 })}
                    {String(label)}
                    {id === "diagnostics" && diags.length > 0 && (
                      <b>{diags.length}</b>
                    )}
                  </button>
                ))}
                <span className={`sim-status ${stale ? "stale" : ""}`}>
                  <i />
                  {busy || state?.running
                    ? "Calcul en cours…"
                    : stale
                      ? "Mesures précédentes · recalcul nécessaire"
                      : sim
                        ? "Mesures ngspice"
                        : "Prêt à simuler"}
                </span>
              </nav>
              {tab === "measures" && (
                <div className="measure-panel">
                  <div className="measure-cards">
                    {Object.entries(sim?.currents || {})
                      .slice(0, 4)
                      .map(([id, current]) => (
                        <button
                          key={id}
                          className="measure-card"
                          onClick={() => select(id)}
                        >
                          <span>COURANT · {id}</span>
                          <strong>{format(current, "A")}</strong>
                          <small>Sens défini par les bornes du composant</small>
                        </button>
                      ))}
                    {!sim && (
                      <div className="empty compact simulation-empty">
                        <Activity size={24} />
                        <p>
                          {calculationFailed
                            ? "Le moteur n’a pas fourni de mesures exploitables."
                            : "Prêt à vérifier ta prédiction ?"}
                        </p>
                        <span>
                          {emptyCircuit
                            ? "Ajoute et relie les composants avant le calcul."
                            : "Simuler calcule les tensions et les courants ; choisir un composant permet ensuite de les expliquer."}
                        </span>
                        {!calculationFailed && (
                          <button
                            className="outline"
                            disabled={!state || emptyCircuit || calculationBusy}
                            onClick={run}
                          >
                            <Play size={14} />
                            Calculer les premières mesures
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="voltmeter">
                    <span>
                      <ArrowLeftRight size={15} />
                      Voltmètre différentiel
                    </span>
                    <select
                      aria-label="Point positif"
                      value={measureA}
                      onChange={(e) => setMeasureA(e.target.value)}
                    >
                      <option value="">Point +</option>
                      {Object.keys(tn).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <span>−</span>
                    <select
                      aria-label="Point négatif"
                      value={measureB}
                      onChange={(e) => setMeasureB(e.target.value)}
                    >
                      <option value="0">Masse · 0 V</option>
                      {Object.keys(tn).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <strong>
                      {sim && measureA
                        ? format(
                            (voltage(measureA) ?? NaN) -
                              (measureB === "0"
                                ? 0
                                : (voltage(measureB) ?? NaN)),
                          )
                        : "— V"}
                    </strong>
                  </div>
                  {showCurrent && (
                    <p className="legend">
                      <span>→</span>Courant conventionnel : sens positif de la
                      première borne vers la seconde ; pour un transistor,
                      courant entrant par le collecteur. Une valeur négative
                      inverse la flèche.
                    </p>
                  )}
                </div>
              )}
              {tab === "scope" && <Oscilloscope sim={sim} />}
              {tab === "diagnostics" && (
                <div className="diagnostics">
                  {diags.length ? (
                    diags.map((d, i) => (
                      <button
                        key={i}
                        className={`diagnostic ${d.severity || ""}`}
                        onClick={() =>
                          d.targets &&
                          act([{ type: "set_ui", highlights: d.targets }])
                        }
                      >
                        <ShieldCheck size={17} />
                        <div>
                          <span>
                            {d.category || "Observation"} ·{" "}
                            {d.code || "Diagnostic"}
                          </span>
                          <strong>{d.message || JSON.stringify(d)}</strong>
                          {d.explanation && <p>{d.explanation}</p>}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="empty compact">
                      <ShieldCheck size={23} />
                      <p>Aucune anomalie topologique signalée.</p>
                      <span>
                        Un calcul réussi ne valide pas automatiquement un
                        montage physique.
                      </span>
                    </div>
                  )}
                  {sim?.assumptions?.map((a, i) => (
                    <p className="assumption" key={i}>
                      <Info size={13} />
                      {a}
                    </p>
                  ))}
                  {rawSim?.log && (
                    <details>
                      <summary>Journal ngspice</summary>
                      <pre>{rawSim.log}</pre>
                    </details>
                  )}
                </div>
              )}
              {tab === "truth" && (
                <div className="truth-panel">
                  <div className="truth-heading">
                    <div>
                      <strong>Soustracteur à deux bits</strong>
                      <p>
                        D = (A − B) modulo 4 · emprunt final = 1 si A &lt; B ·
                        entrée d’emprunt nulle.
                      </p>
                    </div>
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={testTruth}
                    >
                      <Play size={13} />
                      Tester les 16 combinaisons
                    </button>
                  </div>
                  {truth ? (
                    <TruthTable report={truth} />
                  ) : (
                    <p className="muted">
                      Chaque ligne conservera les tensions ngspice, les seuils
                      logiques et l’état de convergence. Le test utilise une
                      copie du projet d’exemple.
                    </p>
                  )}
                </div>
              )}
              {tab === "netlist" && (
                <pre className="netlist">
                  {rawSim?.netlist ||
                    "* La netlist apparaîtra après le premier calcul."}
                </pre>
              )}
            </section>
          </section>
          <aside className="inspector">
            <div className="section-title">
              INSPECTEUR <Settings2 size={14} />
            </div>
            {comp ? (
              <>
                <div className="inspector-top">
                  <span className="big-symbol" aria-hidden="true">
                    <ComponentGlyph kind={comp.kind} />
                  </span>
                  <div>
                    <h3>{comp.label || comp.id}</h3>
                    <p>{kindNames[comp.kind]}</p>
                  </div>
                  <span className="tag">{comp.id}</span>
                </div>
                {![
                  "ground",
                  "diode",
                  "npn",
                  "pnp",
                  "voltage_probe",
                  "current_probe",
                ].includes(comp.kind) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act([
                        {
                          type: "set_value",
                          id: comp.id,
                          value: Number(draftValue),
                        },
                      ]);
                    }}
                  >
                    <label className="field-label">
                      {["switch", "button"].includes(comp.kind)
                        ? "ÉTAT · 0 OUVERT / 1 FERMÉ"
                        : "VALEUR EN UNITÉS SI"}
                    </label>
                    <div className="value-input">
                      <input
                        aria-label="Valeur du composant"
                        type="number"
                        step="any"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                      />
                      <span>{state?.catalog[comp.kind]?.unit}</span>
                      <button
                        title="Appliquer la valeur"
                        aria-label="Appliquer la valeur"
                      >
                        <Check size={15} />
                      </button>
                    </div>
                  </form>
                )}
                {["switch", "button"].includes(comp.kind) && (
                  <button
                    className="outline full"
                    onClick={() =>
                      act([
                        {
                          type: "set_value",
                          id: comp.id,
                          value: comp.value ? 0 : 1,
                        },
                      ])
                    }
                  >
                    Basculer {comp.value ? "ouvert" : "fermé"}
                  </button>
                )}
                <div className="inspector-section">
                  <h4>Orientation du schéma</h4>
                  <div className="rotation-controls">
                    <span>
                      {(((p?.schematic[comp.id]?.rotation || 0) % 360) + 360) %
                        360}
                      °
                    </span>
                    <button
                      className="outline"
                      onClick={() => rotateSelection(-1)}
                      aria-label="Tourner de 90° vers la gauche"
                    >
                      −90°
                    </button>
                    <button
                      className="outline"
                      onClick={() => rotateSelection(1)}
                      aria-label="Tourner de 90° vers la droite"
                    >
                      +90°
                    </button>
                  </div>
                </div>
                <div className="inspector-section">
                  <h4>
                    Bornes & mesures{" "}
                    <span>{Object.keys(comp.pins).length}</span>
                  </h4>
                  {Object.entries(comp.pins).map(([name, id]) => (
                    <button
                      className={`pin-row ${pinToPlace === id ? "active" : ""}`}
                      key={id}
                      onClick={() => {
                        setPinToPlace(id);
                        setPending(id);
                      }}
                    >
                      <span className="pin-name">{name.toUpperCase()}</span>
                      <div>
                        <strong>{id}</strong>
                        <small>
                          {p?.breadboard.placements[id] ||
                            "Non placé sur breadboard"}
                        </small>
                      </div>
                      <b>
                        {format(voltage(id))}
                        {sim?.terminal_currents?.[comp.id]?.[name] !==
                          undefined && (
                          <small>
                            {format(sim.terminal_currents[comp.id][name], "A")}{" "}
                            entrant
                          </small>
                        )}
                      </b>
                    </button>
                  ))}
                  <p className="inspector-hint">
                    Choisis une borne, puis clique un trou pour la placer. Deux
                    bornes dans le même groupe sont reliées.
                  </p>
                  <label className="field-label">PLACEMENT DE LA BORNE</label>
                  <select
                    className="full"
                    aria-label="Borne à placer"
                    value={pinToPlace}
                    onChange={(e) => {
                      setPinToPlace(e.target.value);
                      setPending(e.target.value);
                    }}
                  >
                    {Object.entries(comp.pins).map(([n, id]) => (
                      <option key={id} value={id}>
                        {n.toUpperCase()} · {id}
                      </option>
                    ))}
                  </select>
                  <form
                    className="net-name-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (pinToPlace)
                        act([
                          {
                            type: "set_net_label",
                            terminal: pinToPlace,
                            name: netName,
                          },
                        ]);
                    }}
                  >
                    <label className="field-label">NOM DU RÉSEAU</label>
                    <div className="value-input">
                      <input
                        aria-label="Nom du réseau"
                        placeholder="Ex. VCC, sortie…"
                        maxLength={80}
                        value={netName}
                        onChange={(e) => setNetName(e.target.value)}
                      />
                      <button
                        title="Nommer le réseau"
                        aria-label="Nommer le réseau"
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  </form>
                  <form
                    className="board-placement-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!pinToPlace) return;
                      const hole = boardHoleDraft.trim().toLowerCase();
                      const next = await act([
                        { type: "place_pin", terminal: pinToPlace, hole },
                      ]);
                      if (next) {
                        setPending(null);
                        setNotice(`${pinToPlace} placé dans ${hole}.`);
                      }
                    }}
                  >
                    <label className="field-label" htmlFor="board-hole">
                      TROU SUR LA BREADBOARD
                    </label>
                    <div className="value-input">
                      <input
                        id="board-hole"
                        aria-label="Trou de breadboard"
                        placeholder="a12 ou rail_top_p1"
                        value={boardHoleDraft}
                        onChange={(e) => setBoardHoleDraft(e.target.value)}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                      <button
                        title="Placer la borne dans ce trou"
                        aria-label="Placer la borne dans ce trou"
                        disabled={!boardHoleDraft.trim()}
                      >
                        <Check size={15} />
                      </button>
                    </div>
                  </form>
                  {p?.breadboard.placements[pinToPlace] && (
                    <button
                      className="text-button"
                      onClick={() =>
                        act([
                          {
                            type: "place_pin",
                            terminal: pinToPlace,
                            hole: null,
                          },
                        ])
                      }
                    >
                      Retirer de la breadboard
                    </button>
                  )}
                </div>
                <div className="inspector-section">
                  <h4>Modèle électrique</h4>
                  <span className="generic-label">
                    {comp.model || "Élément idéal"}
                  </span>
                  <p className="inspector-hint">
                    {["npn", "pnp", "diode"].includes(comp.kind)
                      ? "Modèle générique pédagogique. Les paramètres et le brochage ne certifient aucun composant réel."
                      : "Hypothèses idéales : valeurs nominales, sans tolérances ni échauffement."}
                  </p>
                  {(state?.catalog[comp.kind]?.models?.length || 0) > 0 && (
                    <select
                      aria-label="Modèle du composant"
                      className="full"
                      value={comp.model || ""}
                      onChange={(e) =>
                        act([
                          {
                            type: "set_model",
                            id: comp.id,
                            model: e.target.value,
                          },
                        ])
                      }
                    >
                      {state?.catalog[comp.kind]?.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {state?.catalog[comp.kind]?.pins.map((pin) => (
                    <div className="package-pin" key={pin.name}>
                      <span>{pin.label || pin.name}</span>
                      <code>Broche {pin.package_pin}</code>
                    </div>
                  ))}
                </div>
                <button className="delete-component" onClick={remove}>
                  <Trash2 size={14} />
                  Supprimer le composant
                </button>
              </>
            ) : (
              <div className="inspector-empty">
                <MousePointer2 size={28} />
                <h3>Tout commence par un point.</h3>
                <p>
                  Sélectionne un composant pour consulter ses bornes, modifier
                  sa valeur et mesurer son comportement.
                </p>
                <div className="circuit-summary">
                  <span>
                    Composants<b>{p?.components.length || 0}</b>
                  </span>
                  <span>
                    Fils<b>{p?.wires.length || 0}</b>
                  </span>
                  <span>
                    Réseaux<b>{state?.topology.nets.length || 0}</b>
                  </span>
                </div>
              </div>
            )}
            <div className="inspector-section annotations">
              <h4>
                Carnet de l’atelier <BookOpen size={13} />
              </h4>
              {p?.ui.annotations.map((a, i) => (
                <p className="note" key={a.id || i}>
                  {a.text}
                </p>
              ))}
              <textarea
                aria-label="Annotation pédagogique"
                placeholder="Une observation, une hypothèse…"
                value={annotation}
                onChange={(e) => setAnnotation(e.target.value)}
              />
              <button
                className="text-button"
                disabled={!annotation.trim()}
                onClick={() => {
                  act([
                    { type: "annotate", text: annotation, targets: selected },
                  ]);
                  setAnnotation("");
                }}
              >
                <Plus size={13} />
                Ajouter une note
              </button>
            </div>
            <div className="safety-note">
              <ShieldCheck size={16} />
              <span>
                La simulation aide à comprendre.
                <br />
                Le montage physique se vérifie par des mesures.
              </span>
            </div>
          </aside>
        </main>
        <footer>
          <span role="status" aria-live="polite" aria-atomic="true">
            <i className="live-dot" />
            {error
              ? "Action non appliquée"
              : notice || "Prêt. Imagine ton prochain circuit."}
          </span>
          <span>
            {p?.components.length || 0} composants <i /> {p?.wires.length || 0}{" "}
            fils <i />{" "}
            {state ? "Service local connecté" : "Connexion au service…"}
          </span>
        </footer>
        {error && (
          <div className="error-toast" role="alert">
            <Info size={18} />
            <span>{error}</span>
            <button
              title="Fermer"
              aria-label="Fermer"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
      {help && (
        <dialog
          ref={guideRef}
          className="modal-backdrop"
          aria-labelledby="guide-title"
          aria-describedby="guide-intro"
          onCancel={(e) => {
            e.preventDefault();
            setHelp(false);
          }}
          onClick={() => setHelp(false)}
        >
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              autoFocus
              aria-label="Fermer le guide"
              onClick={() => setHelp(false)}
              title="Fermer le guide"
            >
              <X />
            </button>
            <span className="eyebrow">BIENVENUE DANS TON ATELIER</span>
            <h2 id="guide-title">
              Le circuit prend vie
              <br />
              quand tu le comprends.
            </h2>
            <p id="guide-intro">
              Ajouter → relier → simuler → comprendre. Chaque étape reste
              accessible dans l’atelier, sans fermer ton circuit.
            </p>
            <ol>
              <li>
                <strong>Compose ton circuit.</strong> Ajoute des composants
                depuis la bibliothèque et déplace-les dans le schéma.
              </li>
              <li>
                <strong>Relie des bornes.</strong> Clique deux bornes pour
                câbler. Les croisements restent isolés ; une jonction crée un
                point commun.
              </li>
              <li>
                <strong>Passe à la breadboard.</strong> Choisis une borne puis
                un trou. A–E d’une même colonne sont communs, F–J forment un
                autre groupe. Les rails sont coupés après 15 par défaut.
              </li>
              <li>
                <strong>Mesure et explore.</strong> Lance le calcul continu ou
                temporel. Le voltmètre et l’oscilloscope lisent les données
                ngspice.
              </li>
              <li>
                <strong>Fais une hypothèse.</strong> Note-la, modifie une valeur
                et compare les résultats. Annule avec ⌘Z.
              </li>
            </ol>
            <div className="help-bottom">
              <ShieldCheck size={20} />
              <p>
                Le brochage affiché vient du modèle explicite. Vérifie toujours
                la référence et la documentation de ton composant réel.
              </p>
            </div>
            <button className="run" onClick={() => setHelp(false)}>
              Entrer dans l’atelier
              <ChevronRight size={15} />
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
function TruthTable({ report }: { report: Record<string, unknown> }) {
  const rows = (report.rows || report.cases || report.results || []) as Record<
    string,
    unknown
  >[];
  return (
    <>
      <p className="truth-summary">
        Seuils : bas ≤ 1,5 V · haut ≥ 3,5 V · entre les deux : indéterminé.{" "}
        <button
          className="text-button"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], {
                type: "application/json",
              }),
            );
            a.download = "table-verite-ngspice.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }}
        >
          <ArrowDownToLine size={12} />
          Rapport JSON
        </button>
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>A</th>
              <th>B</th>
              <th>Entrées</th>
              <th>Tensions calculées</th>
              <th>Attendu</th>
              <th>Observé</th>
              <th>Convergence / résultat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ins = (r.inputs || {}) as Record<string, number>;
              const a = r.A ?? r.a ?? (ins.A1 || 0) * 2 + (ins.A0 || 0),
                b = r.B ?? r.b ?? (ins.B1 || 0) * 2 + (ins.B0 || 0);
              const volts = (r.voltages ||
                r.measured_voltages ||
                r.measured ||
                {}) as Record<string, unknown>;
              const status = r.pass ?? r.passed ?? r.matches ?? r.status;
              return (
                <tr key={i}>
                  <td>{String(a)}</td>
                  <td>{String(b)}</td>
                  <td>
                    {Object.entries(ins)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </td>
                  <td>
                    {Object.entries(volts)
                      .map(
                        ([k, v]) =>
                          `${k} ${typeof v === "number" ? format(v) : JSON.stringify(v)}`,
                      )
                      .join(" · ")}
                  </td>
                  <td>
                    <code>{JSON.stringify(r.expected)}</code>
                  </td>
                  <td>
                    <code>{JSON.stringify(r.observed || r.logic)}</code>
                  </td>
                  <td>
                    <span
                      className={
                        status === true ||
                        status === "success" ||
                        status === "pass"
                          ? "pass-pill"
                          : "neutral-pill"
                      }
                    >
                      {String(r.convergence ?? r.converged ?? r.status ?? "—")}{" "}
                      · {status === true ? "Conforme" : String(status ?? "—")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <pre>{JSON.stringify(report, null, 2)}</pre>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
