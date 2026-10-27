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
  FlaskConical,
  FolderOpen,
  Hand,
  Info,
  Link2,
  Maximize2,
  MousePointer2,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
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
import {
  rotationOperations,
  duplicateSelectionOperations,
  moveSelectionOperations,
  selectedInBox,
} from "./editing";
import { parseEngineeringValue } from "./units";
import { createSimulationController } from "./simulationController";
import {
  withMeasurements,
  publishSimulationState,
  publishProjectState,
  isCurrentProjectRevision,
  electricalSignature,
} from "./stateMerge";
import type { SimulationSnapshot } from "./simulationController";
import { handleEditorKey, isEditingTarget } from "./interactions";
import { readPreferences, writePreferences } from "./preferences";
import type { DisplayPreferences, PreferencesStorage } from "./preferences";
import { voltageColor, fitCircuitView } from "./visuals";
import { FlowParticles } from "./components/FlowParticles";
import { BreadboardView } from "./components/BreadboardView";
import { ExperimentGallery } from "./components/ExperimentGallery";
import { NotebookPanel } from "./components/NotebookPanel";
import { Oscilloscope } from "./components/Oscilloscope";
import { CircuitCoach } from "./components/CircuitCoach";
import { SourceWaveform } from "./components/SourceWaveform";
import { WireInspector } from "./components/WireInspector";
import { ProjectLibrary } from "./components/ProjectLibrary";
import { ParameterSweep } from "./components/ParameterSweep";
import type { SweepReport, SweepRequest } from "./sweep";
import { insertionFootprint } from "./breadboard";
import { boardLinks, wirePath } from "./connectivity";
import { colors, format, pinOffsets, pinPoints } from "./types";
import type { Component, Wire, Op, Project, State } from "./types";
import "./style.css";
import "./workbench.css";
import "./editor.css";
const kindNames: Record<string, string> = {
  resistor: "Résistance",
  voltage_source: "Source de tension",
  switch: "Interrupteur",
  button: "Bouton",
  diode: "Diode",
  led: "LED",
  potentiometer: "Potentiomètre",
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
      ) : kind === "potentiometer" ? (
        <>
          <path d="M1 12H6M18 12H23M12 1V8M9 5L12 8L15 5" />
          <rect x="6" y="8" width="12" height="8" rx="1" />
        </>
      ) : kind === "diode" || kind === "led" ? (
        <>
          <path d="M1 12H7M17 12H23M17 5V19M7 5L17 12L7 19Z" />
          {kind === "led" && <path d="M12 3L16 0M17 4L21 1" />}
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
      {k === "resistor" || k === "potentiometer" ? (
        <>
          <path d="M-48 0H-25M25 0H48" />
          <rect x="-25" y="-10" width="50" height="20" rx="2" />
          {k === "potentiometer" && <path d="M0 -48V-12M-5 -20L0 -12L5 -20" />}
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
      ) : k === "diode" || k === "led" ? (
        <>
          <path d="M-48 0H-16M16 0H48M16 -17V17" />
          <path d="M-16 -17L16 0L-16 17Z" />
          {k === "led" && (
            <path d="M2 -25L17 -40M10 -41L17 -40L16 -33M14 -20L29 -35M22 -36L29 -35L28 -28" />
          )}
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
function CurrentArrow({
  c,
  current,
  rotation = 0,
}: {
  c: Component;
  current: number;
  rotation?: number;
}) {
  if (c.kind === "potentiometer")
    return (
      <text className="current-label" x="0" y="65" textAnchor="middle">
        I(P) = {format(current, "A")}
      </text>
    );
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
    [drag, setDrag] = useState<{
      ids: string[];
      dx: number;
      dy: number;
    } | null>(null),
    [selectionBox, setSelectionBox] = useState<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    } | null>(null),
    [pointer, setPointer] = useState<{ x: number; y: number } | null>(null),
    [paletteKind, setPaletteKind] = useState<string | null>(null),
    [autoSimulate, setAutoSimulate] = useState(false),
    [valueError, setValueError] = useState(""),
    [potDraft, setPotDraft] = useState(50),
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
    [galleryOpen, setGalleryOpen] = useState(false),
    [projectLibraryOpen, setProjectLibraryOpen] = useState(false),
    [routeDrag, setRouteDrag] = useState<{
      id: string;
      points: { x: number; y: number }[];
    } | null>(null),
    [componentQuery, setComponentQuery] = useState(""),
    [componentCategory, setComponentCategory] = useState("all"),
    [truth, setTruth] = useState<Record<string, unknown> | null>(null),
    [sweepReport, setSweepReport] = useState<
      (SweepReport & { sourceSignature: string }) | null
    >(null),
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
  const gestureCleanup = useRef<(() => void) | null>(null);
  const autoAttempt = useRef("");
  const reservedIds = useRef(new Set<string>());
  const duplicating = useRef(false);
  const spacePressed = useRef(false);
  useEffect(() => () => gestureCleanup.current?.(), []);
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
  const publishProject = useCallback(
    (incoming: State): State => {
      const published = publishProjectState(stateRef.current, incoming);
      if (published !== incoming) {
        void refresh();
        return published;
      }
      control.invalidatePolls();
      stateRef.current = published;
      setState((current) => publishProjectState(current, published));
      return published;
    },
    [refresh],
  );
  const act = useCallback(
    (
      ops: Op[] | ((project: Project) => Op[]),
      preview = false,
    ): Promise<State | undefined> => {
      const job = mutationQueue.current.then(async () => {
        const current = stateRef.current;
        if (!current) return;
        try {
          const operations =
            typeof ops === "function" ? ops(current.project) : ops;
          if (!operations.length) return current;
          control.invalidatePolls();
          const committedBefore = simulationCommit.current;
          let next = await api<State>("transaction", {
            expected_revision: current.project.revision,
            operations,
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
  const configureAnalysis = (project: Project) => {
    setAnalysis(project.default_analysis?.kind === "tran" ? "tran" : "op");
    setStopTime(String(project.default_analysis?.stop ?? 0.02));
    setStep(String(project.default_analysis?.step ?? 0.0001));
  };
  // Un nouveau projet est cadré une fois ; le suivi MCP ne déplace pas la caméra.
  useEffect(() => {
    if (p) {
      centerCircuit(p);
      configureAnalysis(p);
      gestureCleanup.current?.();
      setPending(null);
      setPointer(null);
    }
  }, [p?.id]);
  useEffect(() => {
    setBoardHoleDraft(p?.breadboard.placements[pinToPlace] || "");
  }, [pinToPlace, p?.breadboard.placements[pinToPlace]]);
  useEffect(() => {
    if (p) setTitleDraft(p.title);
  }, [p?.title]);
  const selected = p?.ui.selected || [];
  const comp = p?.components.find((c) => selected.includes(c.id));
  const selectedWire = p?.wires.find((wire) => selected.includes(wire.id));
  useEffect(() => {
    setDraftValue(comp ? String(comp.value) : "");
    setValueError("");
    setPotDraft(Math.round((comp?.position ?? 0.5) * 100));
    setPinToPlace(comp ? Object.values(comp.pins)[0] : "");
  }, [comp?.id, comp?.value, comp?.position]);
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
  const movingPoints = new Set<string>();
  if (drag && p) {
    for (const id of drag.ids) {
      const c = p.components.find((item) => item.id === id);
      const pos = p.schematic[id];
      if (c && pos) {
        const angle = ((pos.rotation || 0) * Math.PI) / 180;
        for (const [name, off] of Object.entries(pinOffsets(c))) {
          movingPoints.add(c.pins[name]);
          points[c.pins[name]] = [
            pos.x +
              drag.dx +
              off[0] * Math.cos(angle) -
              off[1] * Math.sin(angle),
            pos.y +
              drag.dy +
              off[0] * Math.sin(angle) +
              off[1] * Math.cos(angle),
          ];
        }
      } else {
        const junction = p.junctions.find((item) => item.id === id);
        if (junction) {
          movingPoints.add(id);
          points[id] = [junction.x + drag.dx, junction.y + drag.dy];
        }
      }
    }
  }
  const routedPoints = (wire: Wire) =>
    routeDrag?.id === wire.id
      ? routeDrag.points
      : drag && movingPoints.has(wire.a) && movingPoints.has(wire.b)
        ? wire.waypoints?.map((point) => ({
            x: point.x + drag.dx,
            y: point.y + drag.dy,
          }))
        : wire.waypoints;
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
  const select = (id: string, additive = false) =>
    act((project) => {
      const selection = project.ui.selected;
      const next = additive
        ? selection.includes(id)
          ? selection.filter((item) => item !== id)
          : [...selection, id]
        : [id];
      return [{ type: "set_ui", selected: next }];
    });
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
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: (pt.x - pan.x) / zoom, y: (pt.y - pan.y) / zoom };
  };
  const watchGesture = (
    move: (event: PointerEvent) => void,
    finish: (event: PointerEvent) => void,
    cancel: () => void,
  ) => {
    gestureCleanup.current?.();
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      gestureCleanup.current = null;
    };
    const up = (event: PointerEvent) => {
      cleanup();
      finish(event);
    };
    const abort = () => {
      cleanup();
      cancel();
    };
    gestureCleanup.current = () => {
      cleanup();
      cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", abort, { once: true });
    window.addEventListener("blur", abort, { once: true });
  };
  const duplicateSelection = () => {
    if (duplicating.current) return;
    duplicating.current = true;
    let changed = false;
    void act((project) => {
      const result = duplicateSelectionOperations(project, project.ui.selected);
      changed = !!result.operations.length;
      return changed
        ? [...result.operations, { type: "set_ui", selected: result.selected }]
        : [];
    })
      .then((next) => {
        if (next && changed)
          setNotice(
            "Sélection dupliquée sans recopier les connexions externes. Les masses gardent la référence commune 0 V.",
          );
      })
      .finally(() => {
        duplicating.current = false;
      });
  };
  const nudgeSelection = (dx: number, dy: number) => {
    void act((project) =>
      moveSelectionOperations(project, project.ui.selected, dx, dy),
    );
  };
  const startObjectDrag = (
    event: React.PointerEvent<SVGElement>,
    id: string,
  ) => {
    if (tool !== "select" || event.button !== 0 || spacePressed.current) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      void select(id, true);
      return;
    }
    const current = stateRef.current?.project;
    if (!current) return;
    const ids = current.ui.selected.includes(id) ? current.ui.selected : [id];
    if (!current.ui.selected.includes(id)) void select(id);
    const start = toSvg(event);
    const delta = (e: { clientX: number; clientY: number }) => {
      const point = toSvg(e);
      const snap = event.altKey ? 1 : 10;
      return {
        dx: Math.round((point.x - start.x) / snap) * snap,
        dy: Math.round((point.y - start.y) / snap) * snap,
      };
    };
    watchGesture(
      (e) => setDrag({ ids, ...delta(e) }),
      (e) => {
        const { dx, dy } = delta(e);
        setDrag(null);
        if (dx || dy)
          void act((project) => moveSelectionOperations(project, ids, dx, dy));
      },
      () => setDrag(null),
    );
  };
  const startCanvasGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "pan" || event.button === 1 || spacePressed.current) {
      event.preventDefault();
      const start = toSvg(event),
        initial = { ...pan };
      watchGesture(
        (e) => {
          const point = toSvg(e);
          setPan({
            x: initial.x + (point.x - start.x) * zoom,
            y: initial.y + (point.y - start.y) * zoom,
          });
        },
        () => {},
        () => setPan(initial),
      );
      return;
    }
    if (
      event.button !== 0 ||
      (event.target !== event.currentTarget &&
        !(event.target as Element).classList.contains("grid-bg"))
    )
      return;
    const start = toSvg(event);
    if (tool === "junction") {
      void act([
        {
          type: "add_junction",
          x: Math.round(start.x / 10) * 10,
          y: Math.round(start.y / 10) * 10,
        },
      ]);
      return;
    }
    if (pending || tool === "wire") return;
    const original = stateRef.current?.project.ui.selected || [];
    const additive = event.shiftKey;
    setSelectionBox({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
    watchGesture(
      (e) => {
        const end = toSvg(e);
        setSelectionBox({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      },
      (e) => {
        const end = toSvg(e);
        setSelectionBox(null);
        const current = stateRef.current?.project;
        if (!current) return;
        const ids = selectedInBox(current, {
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        });
        void act([
          {
            type: "set_ui",
            selected: additive ? [...new Set([...original, ...ids])] : ids,
          },
        ]);
      },
      () => setSelectionBox(null),
    );
  };
  const addComponentAt = async (
    kind: string,
    point?: { x: number; y: number },
    hole?: string,
  ) => {
    const current = stateRef.current;
    const entry = current?.catalog[kind];
    if (!current || !entry) return;
    const prefix: Record<string, string> = {
      resistor: "R",
      voltage_source: "V",
      switch: "S",
      button: "B",
      diode: "D",
      led: "LED",
      potentiometer: "RV",
      npn: "Q",
      pnp: "Q",
      capacitor: "C",
      ground: "G",
      voltage_probe: "P",
      current_probe: "I",
    };
    const occupied = new Set([
      ...current.project.components.map((c) => c.id),
      ...current.project.wires.map((w) => w.id),
      ...current.project.junctions.map((j) => j.id),
      ...current.project.components.flatMap((c) => Object.values(c.pins)),
      ...reservedIds.current,
    ]);
    let suffix = 1;
    while (occupied.has(`${prefix[kind] || "X"}${suffix}`)) suffix++;
    const id = `${prefix[kind] || "X"}${suffix}`;
    reservedIds.current.add(id);
    const location = point || {
      x: (450 - pan.x) / zoom,
      y: (180 - pan.y) / zoom,
    };
    const component: Component = {
      id,
      kind,
      label: id,
      value: entry.default_value,
      model: entry.models[0]?.id,
      pins: Object.fromEntries(
        entry.pins.map((pin) => [pin.name, `${id}.${pin.name}`]),
      ),
      ...(kind === "potentiometer" ? { position: 0.5 } : {}),
    };
    const operations: Op[] = [
      {
        type: "add_component",
        kind,
        id,
        label: id,
        value: entry.default_value,
        x: Math.round(location.x / 10) * 10,
        y: Math.round(location.y / 10) * 10,
      },
    ];
    if (hole) {
      const proposal = insertionFootprint(current.project, component, hole);
      if (!proposal.ok) {
        reservedIds.current.delete(id);
        setError(proposal.message || "Placement impossible à cet endroit.");
        return;
      }
      operations.push(...proposal.operations);
    }
    operations.push({ type: "set_ui", selected: [id] });
    const next = await act(operations);
    reservedIds.current.delete(id);
    if (next) {
      setTool("select");
      setNotice(
        `${kindNames[kind]} ajouté${hole ? ` sur la plaque à partir de ${hole}` : " au schéma"}. Relie ses bornes pour l’intégrer au circuit.`,
      );
    }
    setPaletteKind(null);
  };
  const zoomAt = (factor: number, anchor = { x: 450, y: 180 }) => {
    const next = Math.max(0.03, Math.min(5, zoom * factor));
    setPan({
      x: anchor.x - ((anchor.x - pan.x) * next) / zoom,
      y: anchor.y - ((anchor.y - pan.y) * next) / zoom,
    });
    setZoom(next);
  };
  const applyComponentValue = async (input = draftValue) => {
    if (!comp) return;
    const unit = state?.catalog[comp.kind]?.unit || "";
    const value = parseEngineeringValue(input, unit);
    if (value === null) {
      setValueError(
        `Valeur invalide. Essaie ${unit === "Ω" ? "4,7 kΩ" : unit === "F" ? "100 nF" : "5 V"}.`,
      );
      return;
    }
    const next = await act([{ type: "set_value", id: comp.id, value }]);
    if (next) {
      setValueError("");
      setNotice(
        `${comp.label || comp.id} : ${format(value, unit)}. ${autoSimulate ? "Calcul automatique activé." : "Recalcule pour actualiser les mesures."}`,
      );
    }
  };
  const applyPotPosition = (id: string, position: number) => {
    const current = stateRef.current?.project.components.find(
      (c) => c.id === id,
    );
    if (
      current?.kind === "potentiometer" &&
      position !== (current.position ?? 0.5)
    )
      void act([{ type: "set_position", id, position }]);
  };
  const addWireBend = (event: React.MouseEvent<SVGGElement>, wire: Wire) => {
    if (tool !== "select") return;
    event.stopPropagation();
    event.preventDefault();
    const point = toSvg(event);
    const bends = wire.waypoints || [];
    if (bends.length >= 32) {
      setNotice("Ce fil possède déjà 32 points de passage.");
      return;
    }
    const all = [
      points[wire.a],
      ...bends.map((p) => [p.x, p.y]),
      points[wire.b],
    ];
    let index = 0,
      best = Infinity;
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i],
        b = all[i + 1];
      if (!a || !b) continue;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = dx * dx + dy * dy;
      const t = length
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / length,
            ),
          )
        : 0;
      const distance =
        (point.x - a[0] - t * dx) ** 2 + (point.y - a[1] - t * dy) ** 2;
      if (distance < best) {
        best = distance;
        index = i;
      }
    }
    const next = [...bends];
    next.splice(index, 0, {
      x: Math.round(point.x / 10) * 10,
      y: Math.round(point.y / 10) * 10,
    });
    void act([
      { type: "set_wire_style", id: wire.id, waypoints: next },
      { type: "set_ui", selected: [wire.id] },
    ]);
    setNotice(
      "Point de passage ajouté. Glisse sa poignée pour ajuster le fil ; Suppr sur la poignée le retire.",
    );
  };
  const startBendDrag = (
    event: React.PointerEvent<SVGCircleElement>,
    wire: Wire,
    index: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const original = wire.waypoints || [];
    const changed = (e: { clientX: number; clientY: number }) => {
      const point = toSvg(e);
      return original.map((p, i) =>
        i === index
          ? {
              x: Math.round(point.x / 10) * 10,
              y: Math.round(point.y / 10) * 10,
            }
          : p,
      );
    };
    watchGesture(
      (e) => setRouteDrag({ id: wire.id, points: changed(e) }),
      (e) => {
        setRouteDrag(null);
        void act([
          { type: "set_wire_style", id: wire.id, waypoints: changed(e) },
        ]);
      },
      () => setRouteDrag(null),
    );
  };
  const runSimulation = async (background = false) => {
    await mutationQueue.current;
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
      if (!background) setTab(analysis === "tran" ? "scope" : "measures");
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
  const run = () => runSimulation(false);
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
  const doHistory = (which: string) => {
    const job = mutationQueue.current.then(async () => {
      const current = stateRef.current;
      if (!current) return;
      try {
        control.invalidatePolls();
        publishProject(
          await api<State>(which, {
            expected_revision: current.project.revision,
          }),
        );
        setPending(null);
        setError("");
      } catch (cause) {
        setError(String(cause));
        await refresh();
      }
    });
    mutationQueue.current = job;
    return job;
  };
  const remove = () =>
    void act((project) =>
      project.ui.selected
        .flatMap((id) =>
          project.components.some((c) => c.id === id)
            ? [{ type: "remove_component", id }]
            : project.wires.some((w) => w.id === id)
              ? [{ type: "remove_wire", id }]
              : project.junctions.some((j) => j.id === id)
                ? [{ type: "remove_junction", id }]
                : [],
        )
        .sort(
          (a, b) =>
            (a.type === "remove_wire" ? 0 : 1) -
            (b.type === "remove_wire" ? 0 : 1),
        ),
    );
  const rotateSelection = (direction: 1 | -1 = 1) => {
    void act((project) =>
      rotationOperations(project, project.ui.selected, direction),
    );
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        exampleOpen &&
        !help &&
        !galleryOpen &&
        !projectLibraryOpen &&
        e.key === "Escape" &&
        !isEditingTarget(e.target)
      ) {
        e.preventDefault();
        setExampleOpen(false);
        return;
      }
      handleEditorKey(e, {
        helpOpen: help || galleryOpen || projectLibraryOpen,
        closeHelp: () => {
          if (projectLibraryOpen) setProjectLibraryOpen(false);
          else if (galleryOpen) setGalleryOpen(false);
          else setHelp(false);
        },
        cancelWiring: () => {
          setPending(null);
          setBoardWire(null);
          setTool("select");
          setPointer(null);
          setRouteDrag(null);
          gestureCleanup.current?.();
        },
        removeSelection: remove,
        history: doHistory,
        selectTool: setTool,
        rotateSelection,
        duplicateSelection,
        selectAll: () => {
          void act((project) => [
            {
              type: "set_ui",
              selected: [
                ...project.components.map((c) => c.id),
                ...project.junctions.map((j) => j.id),
              ],
            },
          ]);
        },
        nudgeSelection,
      });
    };
    const spaceDown = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !isEditingTarget(event.target) &&
        !help &&
        !galleryOpen &&
        !projectLibraryOpen &&
        (event.target === svgRef.current ||
          svgRef.current?.contains(event.target as Node))
      ) {
        event.preventDefault();
        spacePressed.current = true;
      }
    };
    const spaceUp = () => {
      spacePressed.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keydown", spaceDown);
    window.addEventListener("keyup", spaceUp);
    window.addEventListener("blur", spaceUp);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keydown", spaceDown);
      window.removeEventListener("keyup", spaceUp);
      window.removeEventListener("blur", spaceUp);
    };
  });
  const save = async () => {
    try {
      await mutationQueue.current;
      await api("save", {
        expected_revision: stateRef.current?.project.revision,
      });
      setNotice("Projet enregistré dans l’environnement de l’atelier.");
    } catch (e) {
      setError(String(e));
    }
  };
  const exportProject = async () => {
    await mutationQueue.current;
    const project = stateRef.current?.project;
    if (!project) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = `${project.title.replace(/[^\p{L}\d-]/gu, "_")}.atelier.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const loadExample = async (id: string, propagateError = false) => {
    const current = stateRef.current;
    if (!current || busy || current.running) {
      if (propagateError)
        throw new Error(
          "Attends la fin du calcul avant de charger une expérience.",
        );
      return;
    }
    try {
      const next = await api<State>("load-example", {
        id,
        expected_revision: current.project.revision,
      });
      if (publishProject(next) !== next)
        throw new Error(
          "Le circuit a changé entre-temps. Réessaie de charger l’expérience.",
        );
      centerCircuit(next.project);
      setTruth(null);
      configureAnalysis(next.project);
      setPending(null);
      setExampleOpen(false);
      setNotice("Exemple chargé. Tu peux annuler pour retrouver ton circuit.");
    } catch (e) {
      setError(String(e));
      if (propagateError) throw e;
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
  const runSweep = async (
    request: SweepRequest,
  ): Promise<SweepReport | null> => {
    await mutationQueue.current;
    const current = stateRef.current;
    if (!current || !control.getSnapshot().canStart) return null;
    const sourceSignature = electricalSignature(current.project);
    setError("");
    try {
      const report = await control.start((signal) =>
        api<SweepReport>(
          "parameter-sweep",
          { ...request, expected_revision: current.project.revision },
          { signal },
        ),
      );
      if (report) {
        setSweepReport({ ...report, sourceSignature });
        setNotice(
          `${report.converged}/${report.total} points de balayage calculés. Le circuit actif est conservé.`,
        );
      }
      await refresh();
      return report || null;
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError")
        setNotice("Balayage interrompu. Le circuit actif est conservé.");
      else setError(String(cause));
      return null;
    }
  };
  const diags = [...(state?.diagnostics || []), ...(rawSim?.diagnostics || [])];
  const emptyCircuit = !!p && !p.components.length;
  const calculationFailed =
    !!rawSim && ["error", "timeout", "cancelled"].includes(rawSim.status);
  const calculationBusy = busy || !!state?.running;
  const autoKey = p
    ? `${p.id}:${electricalSignature(p)}:${analysis}:${step}:${stopTime}`
    : "";
  useEffect(() => {
    if (
      !autoSimulate ||
      !state ||
      emptyCircuit ||
      calculationBusy ||
      boardPreview ||
      (state.diagnostics || []).some(
        (d) => d.category === "connection" && d.severity === "error",
      ) ||
      autoAttempt.current === autoKey
    )
      return;
    const timer = window.setTimeout(() => {
      if (control.getSnapshot().canStart) {
        autoAttempt.current = autoKey;
        void runSimulation(true);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    autoSimulate,
    autoKey,
    calculationBusy,
    !!boardPreview,
    JSON.stringify(
      (state?.diagnostics || []).filter((d) => d.severity === "error"),
    ),
  ]);
  const commonPoints =
    !!p &&
    (p.wires.length > 0 || Object.keys(p.breadboard.placements).length > 0);
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
  const openNotebook = () => {
    setTab("notebook");
    document.getElementById("simulation-results")?.focus();
  };
  const normalizedQuery = componentQuery
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const visibleComponents = Object.entries(kindNames).filter(([kind, name]) => {
    const base = [
      "resistor",
      "potentiometer",
      "voltage_source",
      "capacitor",
      "ground",
      "switch",
      "button",
    ];
    const categoryMatches =
      componentCategory === "all" ||
      (componentCategory === "base"
        ? base.includes(kind)
        : ["diode", "led", "npn", "pnp"].includes(kind));
    return (
      categoryMatches &&
      `${name} ${kind}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  });
  return (
    <div className="app">
      <nav className="rail" aria-label="Navigation de l’atelier">
        <div className="brand-mark">
          <Zap size={22} />
        </div>
        <button
          className={`rail-button ${tab !== "notebook" ? "active" : ""}`}
          title="L’atelier"
          aria-label="L’atelier"
          aria-current={tab !== "notebook" ? "page" : undefined}
          onClick={() => {
            setTab("measures");
            document.getElementById("studio")?.focus();
          }}
        >
          <CircuitBoard />
        </button>
        <button
          className="rail-button"
          onClick={() => setGalleryOpen(true)}
          title="Explorer les expériences"
          aria-label="Explorer les expériences"
          aria-haspopup="dialog"
        >
          <FlaskConical />
        </button>
        <button
          className={`rail-button ${tab === "notebook" ? "active" : ""}`}
          onClick={openNotebook}
          title="Carnet de labo"
          aria-label="Carnet de labo"
        >
          <NotebookPen />
        </button>
        <button
          className="rail-button"
          title="Mes circuits enregistrés"
          aria-label="Mes circuits enregistrés"
          aria-haspopup="dialog"
          onClick={() => setProjectLibraryOpen(true)}
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
          <span className="avatar" title="Atelier Électronique">
            AÉ
          </span>
        </div>
      </nav>
      <div className="workspace">
        <header>
          <div className="heading">
            <span className="eyebrow">
              UN PEU DE THÉORIE. BEAUCOUP D’EXPÉRIENCES.
            </span>
            <h1>
              Atelier<span> / Électronique</span>
            </h1>
          </div>
          <div className="header-right">
            <span className="local-badge">
              <i />
              {state ? "Service local connecté" : "Connexion au laboratoire…"}
            </span>
            <button className="subtle" onClick={() => setHelp(true)}>
              <BookOpen size={16} />
              Guide
            </button>
            <button
              className="subtle"
              onClick={() => setProjectLibraryOpen(true)}
              aria-haspopup="dialog"
            >
              <FolderOpen size={16} />
              Mes circuits
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
            Révision {p?.revision ?? "—"} <i /> Projet local
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
              Les bonnes idées commencent par quelques composants.
            </p>
            <label className="library-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Rechercher un composant"
                placeholder="Chercher un composant…"
                value={componentQuery}
                onChange={(e) => setComponentQuery(e.target.value)}
              />
              {componentQuery && (
                <button
                  aria-label="Effacer la recherche"
                  onClick={() => setComponentQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <div
              className="library-filters"
              role="group"
              aria-label="Catégories de composants"
            >
              {[
                ["all", "Tous"],
                ["base", "Essentiels"],
                ["active", "Actifs"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={componentCategory === id}
                  onClick={() => setComponentCategory(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              className="component-list"
              id="component-library"
              aria-label="Bibliothèque de composants"
            >
              {visibleComponents.map(([kind, name]) => (
                <button
                  className="component-add"
                  key={kind}
                  aria-label={`Ajouter : ${name}`}
                  title={`Ajouter : ${name}`}
                  disabled={!state}
                  draggable={!!state}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      "application/x-atelier-component",
                      kind,
                    );
                    event.dataTransfer.effectAllowed = "copy";
                    setPaletteKind(kind);
                  }}
                  onDragEnd={() => setPaletteKind(null)}
                  onClick={() => void addComponentAt(kind)}
                >
                  <span className={`component-icon ${kind}`} aria-hidden="true">
                    <ComponentGlyph kind={kind} />
                  </span>
                  <span className="component-name">{name}</span>
                  <Plus size={13} />
                </button>
              ))}
              {visibleComponents.length === 0 && (
                <p className="library-no-results" role="status">
                  Aucun composant trouvé. Essaie « résistance » ou « source ».
                </p>
              )}
            </div>
            <p className="scroll-hint library-scroll-hint">
              ↔ Fais défiler les composants, puis choisis celui à ajouter.
            </p>
            <div className="library-tip">
              <FlaskConical size={20} />
              <span className="tip-eyebrow">L’IDÉE DU PROCHAIN ESSAI</span>
              <strong>Et si tu doublais la résistance ?</strong>
              <p>
                Prédis le courant, lance le calcul, puis compare. C’est comme ça
                que l’intuition se construit.
              </p>
              <button onClick={() => setGalleryOpen(true)}>
                Choisir une expérience
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
            <div className="bench-heading">
              <div>
                <span className="bench-kicker">
                  <i /> L’ÉTABLI
                </span>
                <h2>
                  Place à l’expérience<span>.</span>
                </h2>
                <p>Une idée, quelques fils. Observe ce qui change.</p>
              </div>
              <button
                className="experiment-button"
                onClick={() => setGalleryOpen(true)}
                aria-haspopup="dialog"
              >
                <FlaskConical size={16} /> Explorer les expériences{" "}
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="bench-summary" aria-label="État du circuit">
              <span>
                <CircuitBoard size={14} />
                <b>{p?.components.length ?? "—"}</b> composants
              </span>
              <span>
                <Link2 size={14} />
                <b>{p?.wires.length ?? "—"}</b> connexions
              </span>
              <span
                className={`bench-state ${stale || calculationFailed ? "needs-attention" : ""}`}
              >
                <i />
                {calculationBusy
                  ? "Calcul en cours"
                  : calculationFailed
                    ? "Calcul à vérifier"
                    : stale
                      ? "À recalculer"
                      : sim
                        ? "Mesures actualisées"
                        : "À explorer"}
              </span>
              <button onClick={openNotebook}>
                <NotebookPen size={14} /> Ouvrir le carnet
              </button>
            </div>
            {state && (
              <CircuitCoach
                state={state}
                stale={stale}
                busy={calculationBusy}
                onSelect={(ids) =>
                  void act([{ type: "set_ui", selected: ids }])
                }
                onRun={run}
                onOpenExperiments={() => setGalleryOpen(true)}
                onOpenLibrary={() => {
                  setComponentQuery("Masse");
                  setComponentCategory("all");
                  document
                    .querySelector<HTMLInputElement>(
                      '[aria-label="Rechercher un composant"]',
                    )
                    ?.focus();
                }}
              />
            )}
            <div className="editor-mode-bar">
              <div role="group" aria-label="Vue de travail">
                {[
                  ["split", "Les deux"],
                  ["schematic", "Schéma"],
                  ["breadboard", "Montage"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={(p?.ui.view || "split") === id}
                    onClick={() => void act([{ type: "set_ui", view: id }])}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="auto-simulation">
                <input
                  type="checkbox"
                  checked={autoSimulate}
                  onChange={(event) => {
                    autoAttempt.current = "";
                    setAutoSimulate(event.target.checked);
                  }}
                />
                <Zap size={13} />
                Calcul automatique
              </label>
            </div>
            <div
              className="editor-selection-status"
              role="status"
              title={contextualHint}
            >
              <span>
                {selected.length
                  ? `${selected.length} élément${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""} · Maj+clic pour compléter`
                  : "Glisse un composant ici · Trace un rectangle pour sélectionner"}
              </span>
              {selected.length > 0 && (
                <button
                  onClick={() => void act([{ type: "set_ui", selected: [] }])}
                >
                  Désélectionner <X size={12} />
                </button>
              )}
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
                <button
                  title="Dupliquer la sélection (⌘/Ctrl+D)"
                  aria-label="Dupliquer la sélection"
                  disabled={!selected.length}
                  onClick={duplicateSelection}
                >
                  <Copy size={16} />
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
                    tabIndex={0}
                    onPointerDown={startCanvasGesture}
                    onPointerMove={(event) => {
                      if (pending || paletteKind) setPointer(toSvg(event));
                    }}
                    onPointerLeave={() => {
                      if (!drag) setPointer(null);
                    }}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer.types.includes(
                          "application/x-atelier-component",
                        )
                      ) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                        setPointer(toSvg(event));
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const kind = event.dataTransfer.getData(
                        "application/x-atelier-component",
                      );
                      if (kind && state?.catalog[kind])
                        void addComponentAt(kind, toSvg(event));
                      setPaletteKind(null);
                      setPointer(null);
                    }}
                    onWheel={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        const point = toSvg(event);
                        zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, {
                          x: point.x * zoom + pan.x,
                          y: point.y * zoom + pan.y,
                        });
                      }
                    }}
                  >
                    <defs>
                      <pattern
                        id="dots"
                        width="20"
                        height="20"
                        patternUnits="userSpaceOnUse"
                      >
                        <circle cx="1" cy="1" r=".8" fill="#2c3d35" />
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
                            onDoubleClick={(event) => addWireBend(event, w)}
                            onClick={(e) => {
                              e.stopPropagation();
                              select(
                                w.id,
                                e.shiftKey || e.ctrlKey || e.metaKey,
                              );
                            }}
                            onMouseEnter={() => setHoverNet(net)}
                            onMouseLeave={() => setHoverNet(null)}
                          >
                            <path
                              d={wirePath(p, w.a, w.b, points, routedPoints(w))}
                              stroke={
                                !voltageColors && w.color
                                  ? w.color
                                  : wirePaint(net || "")
                              }
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
                              d={wirePath(p, w.a, w.b, points, routedPoints(w))}
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
                              path={wirePath(
                                p,
                                w.a,
                                w.b,
                                points,
                                routedPoints(w),
                              )}
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
                            {selected.includes(w.id) &&
                              (routedPoints(w) || []).map((point, index) => (
                                <circle
                                  key={index}
                                  className="wire-bend-handle"
                                  cx={point.x}
                                  cy={point.y}
                                  r="5"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Point ${index + 1} du fil ${w.id}. Flèches pour déplacer, Suppr pour retirer.`}
                                  onPointerDown={(event) =>
                                    startBendDrag(event, w, index)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    void act([
                                      {
                                        type: "set_wire_style",
                                        id: w.id,
                                        waypoints: (w.waypoints || []).filter(
                                          (_, i) => i !== index,
                                        ),
                                      },
                                    ]);
                                  }}
                                  onKeyDown={(event) => {
                                    let next: typeof w.waypoints;
                                    const step = event.shiftKey ? 1 : 10;
                                    if (
                                      ["Delete", "Backspace"].includes(
                                        event.key,
                                      )
                                    )
                                      next = (w.waypoints || []).filter(
                                        (_, i) => i !== index,
                                      );
                                    else if (
                                      [
                                        "ArrowLeft",
                                        "ArrowRight",
                                        "ArrowUp",
                                        "ArrowDown",
                                      ].includes(event.key)
                                    )
                                      next = (w.waypoints || []).map((p, i) =>
                                        i !== index
                                          ? p
                                          : {
                                              x:
                                                p.x +
                                                (event.key === "ArrowLeft"
                                                  ? -step
                                                  : event.key === "ArrowRight"
                                                    ? step
                                                    : 0),
                                              y:
                                                p.y +
                                                (event.key === "ArrowUp"
                                                  ? -step
                                                  : event.key === "ArrowDown"
                                                    ? step
                                                    : 0),
                                            },
                                      );
                                    else return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void act([
                                      {
                                        type: "set_wire_style",
                                        id: w.id,
                                        waypoints: next,
                                      },
                                    ]);
                                  }}
                                />
                              ))}
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
                        <g
                          key={j.id}
                          onPointerDown={(event) => {
                            if (tool === "select" && !pending)
                              startObjectDrag(event, j.id);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (tool === "wire" || pending) void clickPin(j.id);
                          }}
                          transform={
                            drag?.ids.includes(j.id)
                              ? `translate(${drag.dx},${drag.dy})`
                              : undefined
                          }
                        >
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
                        const originalPos = p.schematic[c.id] || {
                          x: 150,
                          y: 150,
                        };
                        const pos = drag?.ids.includes(c.id)
                          ? {
                              x: originalPos.x + drag.dx,
                              y: originalPos.y + drag.dy,
                            }
                          : originalPos;
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
                            onPointerDown={(event) =>
                              startObjectDrag(event, c.id)
                            }
                            onDoubleClick={(event) => {
                              if (["switch", "button"].includes(c.kind)) {
                                event.stopPropagation();
                                void act([
                                  {
                                    type: "set_value",
                                    id: c.id,
                                    value: c.value ? 0 : 1,
                                  },
                                ]);
                              }
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
                              {c.kind === "led" &&
                                !stale &&
                                sim?.currents[c.id] !== undefined &&
                                sim.currents[c.id] > 1e-6 && (
                                  <circle
                                    r="28"
                                    className="schematic-led-glow"
                                    fill={
                                      c.model === "generic_led_blue"
                                        ? "#77b9ff"
                                        : c.model === "generic_led_green"
                                          ? "#a7eaa0"
                                          : "#ff8375"
                                    }
                                    opacity={Math.min(
                                      0.6,
                                      sim.currents[c.id] / 0.02,
                                    )}
                                  >
                                    <title>
                                      Luminosité symbolique selon le courant
                                      calculé :{" "}
                                      {format(sim.currents[c.id], "A")}
                                    </title>
                                  </circle>
                                )}
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
                                  : ["npn", "pnp", "diode", "led"].includes(
                                        c.kind,
                                      )
                                    ? c.model || "Générique"
                                    : c.kind === "voltage_source" && c.waveform
                                      ? `${format(c.waveform.low, "V")} ↔ ${format(c.waveform.high, "V")} · ${format(1 / c.waveform.period, "Hz")}`
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
                      {pending && pointer && points[pending] && (
                        <path
                          className="pending-wire"
                          d={`M${points[pending][0]} ${points[pending][1]}H${pointer.x}V${pointer.y}`}
                          fill="none"
                          pointerEvents="none"
                        />
                      )}
                      {paletteKind && pointer && (
                        <g
                          transform={`translate(${pointer.x},${pointer.y})`}
                          className="palette-ghost"
                          pointerEvents="none"
                        >
                          <rect
                            x="-57"
                            y="-35"
                            width="114"
                            height="70"
                            rx="10"
                          />
                          <text textAnchor="middle" y="4">
                            {kindNames[paletteKind]}
                          </text>
                        </g>
                      )}
                      {selectionBox && (
                        <rect
                          className="marquee-selection"
                          x={Math.min(selectionBox.x1, selectionBox.x2)}
                          y={Math.min(selectionBox.y1, selectionBox.y2)}
                          width={Math.abs(selectionBox.x2 - selectionBox.x1)}
                          height={Math.abs(selectionBox.y2 - selectionBox.y1)}
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  </svg>
                </div>
                <p className="scroll-hint">
                  Maj+clic : sélection multiple · Flèches : déplacer ·
                  Espace+glisser : naviguer
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
                      onClick={() => zoomAt(1 / 1.2)}
                    >
                      <ZoomOut size={14} />
                    </button>
                    <span>{Math.round(zoom * 100)} %</span>
                    <button
                      title="Zoomer"
                      aria-label="Zoomer"
                      onClick={() => zoomAt(1.2)}
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
                    onDropComponent={(kind, hole) =>
                      void addComponentAt(kind, undefined, hole)
                    }
                    onPosition={applyPotPosition}
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
                  ["notebook", "Carnet de labo", NotebookPen],
                  ["sweep", "Balayage", Settings2],
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
                          <small>
                            {p?.components.find((c) => c.id === id)?.kind ===
                            "potentiometer"
                              ? "Courant entrant par la borne P"
                              : "Sens défini par les bornes du composant"}
                          </small>
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
                      courant entrant par le collecteur ; pour un potentiomètre,
                      courant entrant par P (le curseur a son propre courant).
                      Une valeur négative inverse la flèche.
                    </p>
                  )}
                </div>
              )}
              {tab === "scope" && <Oscilloscope sim={sim} stale={stale} />}
              {tab === "sweep" && state && (
                <ParameterSweep
                  state={state}
                  busy={calculationBusy}
                  onRun={runSweep}
                  report={sweepReport}
                  stale={
                    !!sweepReport &&
                    (sweepReport.project_id !== state.project.id ||
                      sweepReport.sourceSignature !==
                        electricalSignature(state.project))
                  }
                />
              )}
              {tab === "notebook" && p && state && (
                <NotebookPanel
                  project={p}
                  simulation={sim}
                  stale={stale || calculationFailed || calculationBusy}
                  topology={state.topology}
                />
              )}
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
                  "led",
                  "npn",
                  "pnp",
                  "voltage_probe",
                  "current_probe",
                  "switch",
                  "button",
                ].includes(comp.kind) &&
                  !(comp.kind === "voltage_source" && comp.waveform) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void applyComponentValue();
                      }}
                    >
                      <label className="field-label">
                        {["switch", "button"].includes(comp.kind)
                          ? "ÉTAT · 0 OUVERT / 1 FERMÉ"
                          : "VALEUR DU COMPOSANT"}
                      </label>
                      <div className="value-input">
                        <input
                          aria-label="Valeur du composant"
                          type="text"
                          inputMode="decimal"
                          aria-invalid={!!valueError}
                          aria-describedby="component-value-hint"
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
                      <p
                        id="component-value-hint"
                        className={valueError ? "value-error" : "value-hint"}
                        role={valueError ? "alert" : undefined}
                      >
                        {valueError ||
                          "Accepte les préfixes : 4,7 kΩ · 100 nF · 5 V."}
                      </p>
                      <div className="value-presets">
                        {(comp.kind === "resistor" ||
                        comp.kind === "potentiometer"
                          ? ["220 Ω", "1 kΩ", "4,7 kΩ", "10 kΩ"]
                          : comp.kind === "capacitor"
                            ? ["100 nF", "1 µF", "10 µF"]
                            : comp.kind === "voltage_source"
                              ? ["3,3 V", "5 V", "9 V"]
                              : []
                        ).map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => {
                              setDraftValue(value);
                              void applyComponentValue(value);
                            }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </form>
                  )}
                {comp.kind === "potentiometer" && (
                  <div className="pot-control">
                    <label htmlFor="pot-position">
                      Position du curseur <strong>{potDraft} %</strong>
                    </label>
                    <input
                      id="pot-position"
                      aria-label="Position du potentiomètre"
                      type="range"
                      min="0"
                      max="100"
                      value={potDraft}
                      onChange={(e) => setPotDraft(Number(e.target.value))}
                      onPointerUp={(e) =>
                        applyPotPosition(
                          comp.id,
                          Number(e.currentTarget.value) / 100,
                        )
                      }
                      onKeyUp={(e) => {
                        if (
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "Home",
                            "End",
                            "PageUp",
                            "PageDown",
                          ].includes(e.key)
                        )
                          applyPotPosition(
                            comp.id,
                            Number(e.currentTarget.value) / 100,
                          );
                      }}
                      onBlur={(e) =>
                        applyPotPosition(
                          comp.id,
                          Number(e.currentTarget.value) / 100,
                        )
                      }
                    />
                    <small>0 % : curseur côté P · 100 % : côté N</small>
                  </div>
                )}
                {["switch", "button"].includes(comp.kind) && (
                  <button
                    className="switch-control"
                    aria-pressed={!!comp.value}
                    onClick={() =>
                      void act([
                        {
                          type: "set_value",
                          id: comp.id,
                          value: comp.value ? 0 : 1,
                        },
                      ])
                    }
                  >
                    <Zap size={15} />
                    {comp.value
                      ? "Circuit fermé · ouvrir"
                      : "Circuit ouvert · fermer"}
                  </button>
                )}

                {comp.kind === "voltage_source" && (
                  <SourceWaveform
                    component={comp}
                    busy={calculationBusy}
                    onApply={async (waveform) => {
                      const result = await act([
                        { type: "set_waveform", id: comp.id, waveform },
                      ]);
                      return !!result;
                    }}
                  />
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
                    {["npn", "pnp", "diode", "led"].includes(comp.kind)
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
            ) : selectedWire ? (
              <WireInspector
                wire={selectedWire}
                voltageColors={voltageColors}
                onDisableVoltageColors={() =>
                  updatePreference("voltageColors", false)
                }
                onStyle={(style) =>
                  void act([
                    { type: "set_wire_style", id: selectedWire.id, ...style },
                  ])
                }
                onRemove={() =>
                  void act([{ type: "remove_wire", id: selectedWire.id }])
                }
              />
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
                Notes du circuit <BookOpen size={13} />
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
        <ProjectLibrary
          open={projectLibraryOpen}
          onClose={() => setProjectLibraryOpen(false)}
          currentTitle={p?.title || "Circuit"}
          getRevision={async () => {
            await mutationQueue.current;
            return stateRef.current?.project.revision ?? null;
          }}
          busy={!state || calculationBusy}
          onLoaded={(next) => {
            publishProject(next);
            centerCircuit(next.project);
            setPending(null);
            setBoardWire(null);
            setTruth(null);
            configureAnalysis(next.project);
            setNotice(
              "Circuit chargé depuis la bibliothèque. L’ouverture est annulable.",
            );
          }}
        />
        <ExperimentGallery
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onLoad={(id) => loadExample(id, true)}
          availableIds={examples.map((example) => example.id)}
          busy={!state || calculationBusy}
        />
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
