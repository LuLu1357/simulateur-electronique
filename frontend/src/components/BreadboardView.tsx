import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircuitBoard,
  Hand,
  Info,
  Link2,
  MousePointer2,
  Maximize2,
  RotateCw,
  Plus,
  Download,
  X,
} from "lucide-react";
import type { Component, Op, Project, Simulation, State } from "../types";
import { format } from "../types";
import { voltageColor } from "../visuals";
import { downloadSvgView, svgMeasurementProvenance } from "../svgExport";
import { FlowParticles } from "./FlowParticles";
import {
  BOARD,
  adjacentBoardHole,
  boardGroup,
  boardHolePoint,
  boardHolesOnBoard,
  boardNumber,
  holeOnBoard,
  defaultFootprint,
  externalComponent,
  ledVisualState,
  orderedPins,
  placeBoardPin,
  rigidJumperPath,
  rotateFootprint,
  snapBoardHole,
  translateFootprint,
} from "../breadboard";
import type { BoardPoint, PlacementProposal } from "../breadboard";
import "../breadboard.css";

export type BreadboardViewProps = {
  state: State;
  simulation: Simulation | null;
  stale: boolean;
  flowMode: string;
  flowSpeed: number;
  voltageColors: boolean;
  voltageRange: number;
  pending: string | null;
  pinToPlace: string | null;
  tool: string;
  boardWire: string | null;
  preview?: boolean;
  suspended?: boolean;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onTool: (tool: string) => void;
  onBoardWire: (hole: string | null) => void;
  onPending: (id: string | null) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onLayout: () => void;
  onDropComponent?: (kind: string, hole: string) => void;
  onPosition?: (id: string, position: number) => void;
  act: (operations: Op[], preview?: boolean) => Promise<State | undefined>;
};

type Drag = {
  mode: "body" | "pin";
  componentId: string;
  terminal: string;
  start: BoardPoint;
  anchor: BoardPoint;
  moved: boolean;
  proposal: PlacementProposal | null;
};
const kindNames: Record<string, string> = {
  resistor: "Résistance",
  inductor: "Inductance",
  diode: "Diode",
  led: "LED",
  potentiometer: "Potentiomètre",
  capacitor: "Condensateur",
  npn: "NPN",
  pnp: "PNP",
  switch: "Interrupteur",
  button: "Bouton",
  voltage_source: "Alimentation",
  ground: "Masse",
  voltage_probe: "Sonde V",
  current_probe: "Sonde A",
};
const rejected = (message: string): PlacementProposal => ({
  ok: false,
  operations: [],
  placements: {},
  message,
});

export function BreadboardView(props: BreadboardViewProps) {
  const {
    state,
    simulation,
    stale,
    flowMode,
    flowSpeed,
    voltageColors,
    voltageRange,
    pending,
    pinToPlace,
    tool,
    boardWire,
    preview = false,
    suspended = false,
    onSelect,
    onPin,
    onTool,
    onBoardWire,
    onPending,
    onNotice,
    onError,
    onLayout,
    onDropComponent,
    onPosition,
    act,
  } = props;
  const project = state.project;
  const boardCount = project.breadboard.board_count || 1;
  const [activeBoard, setActiveBoard] = useState(1);
  const allPlacements = project.breadboard.placements;
  const placements = Object.fromEntries(
    Object.entries(allPlacements).filter(
      ([, hole]) => boardNumber(hole) === activeBoard,
    ),
  );
  const localHole = (hole: string) => holeOnBoard(hole, activeBoard);
  const snapActiveHole = (x: number, y: number, maxDistance = 18) =>
    snapBoardHole(x, y, maxDistance, activeBoard);
  const svgRef = useRef<SVGSVGElement>(null);
  const suppressClick = useRef(false);
  const capturedPointer = useRef<{ element: SVGElement; id: number } | null>(
    null,
  );
  const jumperCounter = useRef(0);
  const [hoverHole, setHoverHole] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [trayDragId, setTrayDragId] = useState<string | null>(null);
  const [paletteOver, setPaletteOver] = useState(false);
  const [keyboardHole, setKeyboardHole] = useState("a1");
  const [boardFocused, setBoardFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holeDraft, setHoleDraft] = useState("");
  const [potDraft, setPotDraft] = useState(0.5);
  const potCommit = useRef("");
  const disabled = preview || busy || suspended;
  const releaseCapture = () => {
    const captured = capturedPointer.current;
    capturedPointer.current = null;
    if (captured?.element.hasPointerCapture?.(captured.id))
      captured.element.releasePointerCapture(captured.id);
  };
  useEffect(() => () => releaseCapture(), []);
  useEffect(() => {
    releaseCapture();
    setDrag(null);
    setPlacingId(null);
    setTrayDragId(null);
    setPaletteOver(false);
    setHoverHole(null);
    suppressClick.current = false;
    setKeyboardHole(holeOnBoard("a1", activeBoard));
  }, [project.id, preview, activeBoard, suspended]);
  useEffect(() => {
    setActiveBoard(1);
    onBoardWire(null);
  }, [project.id]);
  useEffect(() => {
    setActiveBoard((current) => Math.min(current, boardCount));
  }, [boardCount]);
  const selected = project.ui.selected;
  const highlights = project.ui.highlights.filter(
    (id): id is string => typeof id === "string",
  );
  const activePin = pending || pinToPlace || "";
  const activeComponent = project.components.find((c) =>
    selected.includes(c.id),
  );
  useEffect(() => {
    const hole =
      activeComponent &&
      Object.values(activeComponent.pins)
        .map((pin) => allPlacements[pin])
        .find(Boolean);
    if (hole) setActiveBoard(boardNumber(hole));
  }, [activeComponent?.id, project.id, preview]);
  const activePosition =
    (activeComponent as (Component & { position?: number }) | undefined)
      ?.position ?? 0.5;
  useEffect(() => {
    setPotDraft(activePosition);
    potCommit.current = "";
  }, [activeComponent?.id, activePosition]);
  const applyPosition = (value: number) => {
    if (
      !activeComponent ||
      activeComponent.kind !== "potentiometer" ||
      disabled ||
      !onPosition
    )
      return;
    const key = `${activeComponent.id}:${value}`;
    if (
      potCommit.current === key ||
      (!potCommit.current && value === activePosition)
    )
      return;
    potCommit.current = key;
    onPosition(activeComponent.id, value);
  };
  const unplaced = project.components.filter((c) =>
    Object.values(c.pins).some((pin) => !allPlacements[pin]),
  );
  const hiddenWires = project.wires.filter(
    (wire) => !allPlacements[wire.a] || !allPlacements[wire.b],
  ).length;
  const interboardWires = project.wires.filter(
    (wire) =>
      allPlacements[wire.a] &&
      allPlacements[wire.b] &&
      boardNumber(allPlacements[wire.a]) !== boardNumber(allPlacements[wire.b]),
  );
  const lastBoardOccupied = Object.values(allPlacements).some(
    (hole) => boardNumber(hole) === boardCount,
  );
  const changeBoardCount = async (count: number) => {
    setBusy(true);
    try {
      const next = await act([{ type: "set_board_count", count }]);
      if (next) {
        setActiveBoard(count);
        onNotice(
          count > boardCount
            ? `Plaque ${count} ajoutée. Ses rails sont indépendants des autres plaques.`
            : "Dernière plaque vide retirée.",
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const selectedNets = useMemo(
    () =>
      new Set(
        project.components
          .filter((c) => selected.includes(c.id))
          .flatMap((c) =>
            Object.values(c.pins).map(
              (id) => state.topology.terminal_to_net[id],
            ),
          ),
      ),
    [project.components, selected, state.topology.terminal_to_net],
  );
  const point = (event: { clientX: number; clientY: number }): BoardPoint => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return [0, 0];
    const transformed = p.matrixTransform(matrix.inverse());
    return [transformed.x, transformed.y];
  };
  const paint = (terminal: string) => {
    const net = state.topology.terminal_to_net[terminal];
    if (voltageColors && simulation && !stale && !preview)
      return voltageColor(simulation.voltages[net], voltageRange);
    return net === "0" ? "#477ca7" : "#33866b";
  };
  const reset = () => {
    releaseCapture();
    setDrag(null);
    setPlacingId(null);
    setTrayDragId(null);
    setPaletteOver(false);
    setHoverHole(null);
    suppressClick.current = false;
    onPending(null);
    onPin("");
    onBoardWire(null);
  };
  async function commit(
    proposal: PlacementProposal,
    componentId?: string,
    clearPin = true,
  ) {
    if (disabled) return;
    if (!proposal.ok) {
      onError(proposal.message);
      return;
    }
    setBusy(true);
    try {
      const operations = componentId
        ? [...proposal.operations, { type: "set_ui", selected: [componentId] }]
        : proposal.operations;
      const result = await act(operations);
      if (!result) {
        onNotice(
          "Placement non appliqué : les bornes et la sélection en attente sont conservées.",
        );
        return;
      }
      if (clearPin) {
        onPending(null);
        onPin("");
      }
      setPlacingId(null);
      setTrayDragId(null);
      onNotice(
        "Implantation mise à jour. Les fils suivent leurs bornes ; vérifie les nouvelles continuités avant de recalculer.",
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  function proposalAt(current: Drag, xy: BoardPoint): PlacementProposal {
    const anchor =
      current.mode === "body"
        ? [
            current.anchor[0] + xy[0] - current.start[0],
            current.anchor[1] + xy[1] - current.start[1],
          ]
        : xy;
    const hole = snapActiveHole(anchor[0], anchor[1]);
    if (!hole)
      return rejected(
        "Aucun trou sous la patte : déplacement annulé, implantation conservée.",
      );
    return current.mode === "body"
      ? translateFootprint(project, current.componentId, hole)
      : placeBoardPin(project, current.terminal, hole);
  }
  function startBody(event: React.PointerEvent<SVGGElement>, c: Component) {
    if (disabled || event.button !== 0 || event.isPrimary === false) return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.focus({ preventScroll: true });
    suppressClick.current = false;
    const terminal = orderedPins(c)[0]?.[1];
    const anchor = boardHolePoint(placements[terminal] || "");
    if (!anchor || orderedPins(c).some(([, id]) => !placements[id])) {
      setPlacingId(c.id);
      onNotice(
        `${c.label} : choisis un trou pour placer l’ensemble de ses bornes.`,
      );
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    capturedPointer.current = {
      element: event.currentTarget,
      id: event.pointerId,
    };
    setDrag({
      mode: "body",
      componentId: c.id,
      terminal,
      start: point(event),
      anchor,
      moved: false,
      proposal: null,
    });
  }
  function startPin(
    event: React.PointerEvent<SVGGElement>,
    c: Component,
    terminal: string,
  ) {
    if (disabled || event.button !== 0 || event.isPrimary === false) return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.focus({ preventScroll: true });
    suppressClick.current = false;
    const anchor = boardHolePoint(placements[terminal] || "");
    if (!anchor) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    capturedPointer.current = {
      element: event.currentTarget,
      id: event.pointerId,
    };
    setDrag({
      mode: "pin",
      componentId: c.id,
      terminal,
      start: point(event),
      anchor,
      moved: false,
      proposal: null,
    });
  }
  function finishDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (
      !drag ||
      (capturedPointer.current &&
        capturedPointer.current.id !== event.pointerId)
    )
      return;
    const xy = point(event);
    const moved =
      drag.moved ||
      Math.hypot(xy[0] - drag.start[0], xy[1] - drag.start[1]) > 4;
    suppressClick.current = true;
    releaseCapture();
    setDrag(null);
    if (!moved) {
      onSelect(drag.componentId);
      if (drag.mode === "pin") {
        onPin(drag.terminal);
        onPending(drag.terminal);
        setPlacingId(null);
      }
      return;
    }
    const proposal = proposalAt(drag, xy);
    if (drag.mode === "pin") {
      // Conserver la patte en attente aussi si le serveur refuse une révision
      // périmée ; commit ne la libère qu'après confirmation de l'état obtenu.
      onPin(drag.terminal);
      onPending(drag.terminal);
    }
    void commit(proposal, drag.componentId, drag.mode === "pin");
  }
  async function clickHole(hole: string) {
    if (disabled || drag) return;
    if (tool === "board-wire") {
      if (!boardWire) {
        onBoardWire(hole);
        onNotice(`Départ du cavalier : ${hole}. Choisis son arrivée.`);
        return;
      }
      if (boardWire === hole) {
        onNotice("Choisis deux trous différents pour le cavalier.");
        return;
      }
      const ops: Op[] = [];
      const stamp = `${Date.now().toString(36)}_${++jumperCounter.current}`;
      const endpoint = (target: string, suffix: string) => {
        const existing = Object.entries(allPlacements).find(
          ([, occupied]) => occupied === target,
        );
        if (existing) return existing[0];
        const id = `Jboard_${stamp}_${suffix}`;
        ops.push(
          { type: "add_junction", id, x: suffix === "a" ? 100 : 220, y: 320 },
          { type: "place_pin", terminal: id, hole: target },
        );
        return id;
      };
      const a = endpoint(boardWire, "a"),
        b = endpoint(hole, "b");
      ops.push({ type: "connect", a, b });
      setBusy(true);
      try {
        if (await act(ops)) {
          onBoardWire(null);
          onNotice(
            "Cavalier rigide ajouté entre les deux trous, visible aussi dans le schéma.",
          );
        }
      } catch (error) {
        onError(String(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (placingId) {
      await commit(defaultFootprint(project, placingId, hole), placingId);
      return;
    }
    if (activePin) {
      await commit(placeBoardPin(project, activePin, hole));
      return;
    }
    const owner = project.components.find((c) =>
      Object.values(c.pins).some((pin) => placements[pin] === hole),
    );
    if (owner) onSelect(owner.id);
    else
      onNotice(
        `${hole} · clique une borne à déplacer, ou active « Cavalier rigide ».`,
      );
  }
  const hoverProposal =
    !disabled && hoverHole && (placingId || trayDragId)
      ? defaultFootprint(project, placingId || trayDragId!, hoverHole)
      : !disabled && hoverHole && activePin
        ? placeBoardPin(project, activePin, hoverHole)
        : null;
  const ghost = drag?.proposal || hoverProposal;
  const ghostComponent = drag?.componentId || placingId || trayDragId;
  const hoverNet = hoverHole ? state.topology.hole_to_net[hoverHole] : null;
  const activatePin = (c: Component, terminal: string) => {
    if (disabled) return;
    onSelect(c.id);
    onPin(terminal);
    onPending(terminal);
    setPlacingId(null);
    onNotice(`${terminal} : déplace la patte ou clique son nouveau trou.`);
  };
  function renderComponent(
    c: Component,
    locations: Record<string, string>,
    isGhost = false,
  ) {
    const entries = orderedPins(c).flatMap(([name, terminal]) => {
      const xy = boardHolePoint(locations[terminal] || "");
      return xy ? [{ name, terminal, xy }] : [];
    });
    if (!entries.length) return null;
    const points = entries.map((p) => p.xy);
    const minX = Math.min(...points.map((p) => p[0])),
      maxX = Math.max(...points.map((p) => p[0]));
    const minY = Math.min(...points.map((p) => p[1])),
      maxY = Math.max(...points.map((p) => p[1]));
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    const isSelected =
      selected.includes(c.id) ||
      highlights.includes(c.id) ||
      drag?.componentId === c.id;
    const isExternal = externalComponent(c);
    const partial = entries.length < Object.keys(c.pins).length;
    const bipolar = c.kind === "npn" || c.kind === "pnp";
    const isLed = c.kind === "led";
    const isPot = c.kind === "potentiometer";
    const position = (c as Component & { position?: number }).position;
    const potPosition =
      typeof position === "number" && Number.isFinite(position)
        ? Math.max(0, Math.min(1, position))
        : 0.5;
    const light = ledVisualState(
      simulation?.currents[c.id],
      stale ||
        simulation?.status !== "success" ||
        preview ||
        isGhost ||
        partial,
    );
    const ledColor =
      c.model === "generic_led_green"
        ? "#4bcf7d"
        : c.model === "generic_led_blue"
          ? "#64a9ff"
          : "#f46354";
    const lightDescription =
      light.state === "unknown"
        ? "état lumineux inconnu · recalcul nécessaire"
        : light.state === "overcurrent"
          ? `courant calculé ${format(simulation?.currents[c.id], "A")} supérieur à 20 mA`
          : light.state === "on"
            ? `allumée · ${format(simulation?.currents[c.id], "A")}`
            : "éteinte";
    const a = entries[0].xy,
      b = entries[1]?.xy || a;
    const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bodyLength = Math.max(22, Math.min(52, distance - 20));
    const labelY = isPot ? minY - 65 : bipolar || isLed ? minY - 51 : minY - 24;
    const detail =
      c.kind === "resistor" || isPot
        ? format(c.value, "Ω")
        : c.kind === "capacitor"
          ? format(c.value, "F")
          : c.kind === "inductor"
            ? format(c.value, "H")
            : c.kind === "voltage_source"
              ? c.waveform
                ? `${format(c.waveform.low, "V")} ↔ ${format(c.waveform.high, "V")}`
                : format(c.value, "V")
              : ["switch", "button"].includes(c.kind)
                ? c.value
                  ? "fermé"
                  : "ouvert"
                : kindNames[c.kind];
    return (
      <g
        key={`${isGhost ? "ghost_" : ""}${c.id}`}
        className={`bb-component ${isSelected ? "selected" : ""} ${isGhost ? "bb-ghost" : ""} ${partial ? "partial" : ""}`}
        data-component-id={c.id}
        role={isGhost ? undefined : "button"}
        tabIndex={isGhost || preview ? -1 : 0}
        aria-label={`${c.label}, ${kindNames[c.kind]}, ${isLed ? `${lightDescription}, ` : ""}${partial ? "implantation partielle" : "glisser le corps pour déplacer toutes les bornes"}`}
        onPointerDown={isGhost ? undefined : (event) => startBody(event, c)}
        onClick={
          isGhost
            ? undefined
            : (event) => {
                event.stopPropagation();
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect(c.id);
              }
        }
        onDoubleClick={
          isGhost || disabled || !["switch", "button"].includes(c.kind)
            ? undefined
            : async (event) => {
                event.stopPropagation();
                try {
                  if (
                    await act([
                      { type: "set_value", id: c.id, value: c.value ? 0 : 1 },
                    ])
                  )
                    onNotice(
                      `${c.label} ${c.value ? "ouvert" : "fermé"}. Recalcule pour actualiser les mesures.`,
                    );
                } catch (error) {
                  onError(String(error));
                }
              }
        }
        onKeyDown={
          isGhost
            ? undefined
            : (event) => {
                if (event.target !== event.currentTarget || disabled) return;
                const delta: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                if (delta[event.key]) {
                  event.preventDefault();
                  event.stopPropagation();
                  const target = adjacentBoardHole(
                    locations[orderedPins(c)[0][1]] || "",
                    ...delta[event.key],
                  );
                  if (target)
                    void commit(
                      translateFootprint(project, c.id, target),
                      c.id,
                      false,
                    );
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(c.id);
                }
              }
        }
      >
        <rect
          className="bb-selection"
          x={minX - 17}
          y={labelY - 15}
          width={Math.max(44, maxX - minX + 34)}
          height={maxY - labelY + 40}
          rx="4"
        />
        {!partial && !isExternal && !bipolar && !isLed && !isPot && (
          <g
            transform={`translate(${a[0]} ${a[1]}) rotate(${angle})`}
            className="bb-body"
          >
            <line x1="0" y1="0" x2={distance} y2="0" className="bb-lead" />
            {c.kind === "capacitor" ? (
              <circle
                cx={distance / 2}
                cy="0"
                r="16"
                className="bb-capacitor"
              />
            ) : c.kind === "inductor" ? (
              <g className="bb-inductor">
                <rect
                  x={(distance - bodyLength) / 2}
                  y="-8"
                  width={bodyLength}
                  height="16"
                  rx="4"
                  className="bb-inductor-core"
                />
                {[0, 1, 2, 3].map((turn) => {
                  const start =
                    (distance - bodyLength) / 2 + (turn * bodyLength) / 4;
                  const end = start + bodyLength / 4;
                  return (
                    <path
                      key={turn}
                      d={`M${start} 0C${start} -11 ${end} -11 ${end} 0`}
                      className="bb-inductor-winding"
                    />
                  );
                })}
              </g>
            ) : (
              <rect
                x={(distance - bodyLength) / 2}
                y={c.kind === "button" || c.kind === "switch" ? -11 : -8}
                width={bodyLength}
                height={c.kind === "button" || c.kind === "switch" ? 22 : 16}
                rx="2"
                className={
                  c.kind === "diode"
                    ? "bb-diode"
                    : ["switch", "button"].includes(c.kind)
                      ? "bb-switch"
                      : "bb-resistor"
                }
              />
            )}
            {c.kind === "diode" && (
              <rect
                x={(distance + bodyLength) / 2 - 6}
                y="-8"
                width="3"
                height="16"
                className="bb-cathode"
              />
            )}
            {["switch", "button"].includes(c.kind) && (
              <path
                d={
                  c.value
                    ? `M${distance / 2 - 8} 0h16`
                    : `M${distance / 2 - 8} 0l16 -7`
                }
                className="bb-switch-contact"
              />
            )}
          </g>
        )}
        {!partial && isLed && (
          <g
            className={`bb-body bb-led bb-led-${light.state}`}
            style={{ "--bb-led-color": ledColor } as React.CSSProperties}
          >
            {entries.map(({ xy, name }) => (
              <path
                key={name}
                d={`M${xy[0]} ${xy[1]}L${cx + (name === "a" ? -8 : 8)} ${minY - 14}`}
                className="bb-lead"
              />
            ))}
            {light.intensity > 0 && (
              <circle
                cx={cx}
                cy={minY - 25}
                r={22 + light.intensity * 7}
                fill={ledColor}
                opacity={0.08 + light.intensity * 0.18}
                className="bb-led-halo"
              />
            )}
            <path
              d={`M${cx - 13} ${minY - 14}V${minY - 26}a13 13 0 0 1 26 0V${minY - 14}Z`}
              className="bb-led-bulb"
              fill={light.intensity > 0 ? ledColor : "#826762"}
              fillOpacity={
                light.intensity > 0 ? 0.45 + light.intensity * 0.55 : 0.6
              }
            />
            <path
              d={`M${cx + 10} ${minY - 29}V${minY - 16}`}
              className="bb-led-flat"
            />
            <path
              d={`M${cx - 8} ${minY - 27}q0 -7 6 -8`}
              className="bb-led-reflection"
            />
            {light.state === "overcurrent" && (
              <text
                x={cx + 21}
                y={minY - 29}
                className="bb-led-warning"
                aria-hidden="true"
              >
                !
              </text>
            )}
            <title>
              {c.label} : {lightDescription}. Intensité lumineuse symbolique
              d’après le courant calculé, sans modèle optique ou thermique.
            </title>
          </g>
        )}
        {!partial && isPot && (
          <g className="bb-body bb-potentiometer">
            {entries.map(({ xy, name }) => (
              <path
                key={name}
                d={`M${xy[0]} ${xy[1]}V${minY - 6}L${cx + (name === "p" ? -18 : name === "n" ? 18 : 0)} ${minY - 13}`}
                className="bb-lead"
              />
            ))}
            <rect
              x={cx - 28}
              y={minY - 54}
              width="56"
              height="44"
              rx="7"
              className="bb-pot-case"
            />
            <circle cx={cx} cy={minY - 33} r="16" className="bb-pot-knob" />
            <path
              d={`M${cx} ${minY - 33}v-11`}
              transform={`rotate(${-135 + potPosition * 270} ${cx} ${minY - 33})`}
              className="bb-pot-pointer"
            />
            <text
              x={cx}
              y={minY - 14}
              textAnchor="middle"
              className="bb-pot-position"
            >
              {Math.round(potPosition * 100)} %
            </text>
            <title>
              Potentiomètre pédagogique : P, curseur W, N. Position{" "}
              {Math.round(potPosition * 100)} % ; P–W représente cette
              proportion de la résistance totale.
            </title>
          </g>
        )}
        {!partial && bipolar && (
          <g className="bb-body">
            {entries.map(({ xy, name }) => (
              <path
                key={name}
                d={`M${xy[0]} ${xy[1]}V${minY - 10}L${cx + (name === "c" ? -13 : name === "e" ? 13 : 0)} ${minY - 24}`}
                className="bb-lead"
              />
            ))}
            <rect
              x={cx - 30}
              y={minY - 42}
              width="60"
              height="25"
              rx="3"
              className="bb-transistor"
            />
            <text
              x={cx}
              y={minY - 25}
              textAnchor="middle"
              className="bb-package-text"
            >
              {c.kind.toUpperCase()}
            </text>
          </g>
        )}
        {!partial && isExternal && (
          <g className="bb-external-symbol">
            {entries.map(({ xy, name }) => (
              <line
                key={name}
                x1={xy[0]}
                y1={xy[1]}
                x2={cx}
                y2={cy}
                className="bb-external-lead"
              />
            ))}
            <rect
              x={cx - 15}
              y={cy - 11}
              width="30"
              height="22"
              rx="2"
              className="bb-external-box"
            />
            <text x={cx} y={cy + 5} textAnchor="middle">
              {c.kind === "voltage_source"
                ? "+/−"
                : c.kind === "ground"
                  ? "0V"
                  : c.kind === "voltage_probe"
                    ? "V"
                    : "A"}
            </text>
          </g>
        )}
        <text x={cx} y={labelY} textAnchor="middle" className="bb-part-label">
          {c.label || c.id}
          <tspan className="bb-part-value">
            {" "}
            · {partial ? "à compléter" : isLed ? lightDescription : detail}
          </tspan>
        </text>
        {entries.map(({ name, terminal, xy }) => (
          <g
            key={terminal}
            className={`bb-pin ${activePin === terminal ? "pending" : ""}`}
            role={isGhost ? undefined : "button"}
            tabIndex={isGhost || preview ? -1 : 0}
            aria-label={`${terminal}, trou ${locations[terminal]}, cliquer puis choisir un trou pour déplacer la patte`}
            onPointerDown={
              isGhost ? undefined : (event) => startPin(event, c, terminal)
            }
            onClick={
              isGhost
                ? undefined
                : (event) => {
                    event.stopPropagation();
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    activatePin(c, terminal);
                  }
            }
            onKeyDown={
              isGhost
                ? undefined
                : (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      activatePin(c, terminal);
                    }
                  }
            }
          >
            <circle cx={xy[0]} cy={xy[1]} r="8" fill="transparent" />
            <circle cx={xy[0]} cy={xy[1]} r="4.8" className="bb-pin-metal" />
            <text
              x={xy[0]}
              y={xy[1] + 18}
              textAnchor="middle"
              className="bb-pin-label"
            >
              {name.toUpperCase()}
            </text>
            <title>
              {terminal} ·{" "}
              {state.catalog[c.kind]?.pins.find((p) => p.name === name)?.role} ·{" "}
              {locations[terminal]} ·{" "}
              {format(
                simulation?.voltages[state.topology.terminal_to_net[terminal]],
              )}
            </title>
          </g>
        ))}
        <title>
          {c.label} · {c.model || kindNames[c.kind]} ·{" "}
          {isExternal
            ? "Connecteur pédagogique virtuel, aucun boîtier physique simulé."
            : "Empreinte pédagogique ; correspondance des bornes définie par le modèle, jamais par la silhouette."}
        </title>
      </g>
    );
  }
  return (
    <section
      className={`breadboard-panel bb-panel ${preview ? "is-preview" : ""}`}
      aria-label="Implantation breadboard à plat"
      onKeyDownCapture={(event) => {
        if (
          event.key === "Escape" &&
          (drag || placingId || activePin || boardWire)
        ) {
          event.preventDefault();
          event.stopPropagation();
          reset();
          onNotice("Placement annulé, circuit conservé.");
        }
      }}
    >
      <div className="view-heading">
        <div>
          <span className="view-number">02</span>
          <h2>Breadboard à plat</h2>
          <span className="board-tag">30 colonnes · vue de dessus</span>
        </div>
        <div className="view-options">
          <button disabled={disabled} onClick={onLayout}>
            <CircuitBoard size={15} />
            Implanter depuis le schéma
          </button>
          <button
            disabled={disabled}
            aria-pressed={tool === "board-wire"}
            onClick={() => {
              onTool(tool === "board-wire" ? "select" : "board-wire");
              onBoardWire(null);
              onPending(null);
              onPin("");
              setPlacingId(null);
              onNotice(
                "Cavalier rigide : clique deux trous. Les courbes Dupont ne sont pas utilisées.",
              );
            }}
          >
            <Link2 size={15} />
            Cavalier rigide
          </button>
          <label>
            <input
              type="checkbox"
              checked={project.breadboard.rail_splits}
              disabled={disabled}
              onChange={(event) =>
                void act([
                  { type: "set_rail_splits", enabled: event.target.checked },
                ])
              }
            />
            Rails coupés à 15{boardCount > 1 ? " · toutes les plaques" : ""}
          </label>
          <button
            aria-label="Exporter la plaque en SVG"
            title="Exporter la plaque affichée en SVG"
            disabled={busy}
            onClick={() => {
              if (svgRef.current) {
                try {
                  downloadSvgView(
                    svgRef.current,
                    `Plaque ${activeBoard} — ${project.title}`,
                    `Implantation pédagogique, plaque ${activeBoard} sur ${boardCount}, projet ${project.title}, révision ${project.revision}. ${preview ? "Prévisualisation non appliquée. " : ""}${svgMeasurementProvenance(simulation, stale)} Les liaisons vers d’autres plaques sont listées séparément dans l’application. Le brochage constructeur reste à vérifier.`,
                  );
                  onNotice(
                    "Plaque exportée en SVG autonome. Les liaisons entre plaques restent indiquées dans l’application.",
                  );
                } catch (cause) {
                  onError(String(cause));
                }
              }
            }}
          >
            <Download size={14} />
            SVG
          </button>
          <button
            disabled={disabled}
            aria-label={
              project.ui.view === "breadboard"
                ? "Voir les deux vues"
                : "Agrandir la breadboard"
            }
            onClick={() =>
              void act([
                {
                  type: "set_ui",
                  view:
                    project.ui.view === "breadboard" ? "split" : "breadboard",
                },
              ])
            }
          >
            <Maximize2 size={15} />
            {project.ui.view === "breadboard"
              ? "Voir les deux vues"
              : "Agrandir la breadboard"}
          </button>
        </div>
      </div>
      <nav className="bb-board-tabs" aria-label="Plaques du circuit">
        <div>
          {Array.from({ length: boardCount }, (_, index) => index + 1).map(
            (board) => (
              <button
                key={board}
                aria-label={`Afficher la plaque ${board}`}
                aria-pressed={activeBoard === board}
                disabled={busy}
                onClick={() => setActiveBoard(board)}
              >
                <CircuitBoard size={14} />
                Plaque {board}
                <small>
                  {
                    Object.values(allPlacements).filter(
                      (hole) => boardNumber(hole) === board,
                    ).length
                  }{" "}
                  bornes
                </small>
              </button>
            ),
          )}
        </div>
        <button
          aria-label="Ajouter une breadboard"
          disabled={disabled || boardCount >= 4}
          title="Ajouter une plaque indépendante (4 maximum)"
          onClick={() => void changeBoardCount(boardCount + 1)}
        >
          <Plus size={14} />
          Ajouter
        </button>
        {boardCount > 1 && (
          <button
            aria-label="Retirer la dernière breadboard vide"
            disabled={disabled || lastBoardOccupied}
            title={
              lastBoardOccupied
                ? "Déplace ou retire d’abord les bornes de la dernière plaque"
                : "Retirer la dernière plaque vide"
            }
            onClick={() => void changeBoardCount(boardCount - 1)}
          >
            <X size={14} />
          </button>
        )}
      </nav>
      <div className="bb-instructions">
        <Hand size={17} />
        <p id="bb-board-instructions">
          <strong>Glisse le corps</strong> pour déplacer toutes ses pattes.{" "}
          <strong>Glisse une patte</strong> pour la déplacer seule. La sélection
          est partagée avec le schéma ; les fils restent attachés aux bornes.
          <span className="bb-keyboard-help">
            Au clavier : tabule jusqu’à la plaque, utilise les flèches pour
            choisir un trou et Entrée pour agir.
          </span>
        </p>
      </div>
      {(placingId || activePin || boardWire) && (
        <div className="bb-placement-status">
          <MousePointer2 size={16} />
          <span>
            {placingId
              ? `${placingId} : choisis le trou de sa première patte.`
              : boardWire
                ? `Cavalier depuis ${boardWire} : choisis son arrivée.`
                : `${activePin} : choisis le nouveau trou.`}
          </span>
          <button disabled={busy} onClick={reset}>
            <X size={15} />
            Annuler · Échap
          </button>
        </div>
      )}
      {activeComponent && (
        <div className="bb-selected-controls">
          <span>
            <strong>{activeComponent.label}</strong> ·{" "}
            {kindNames[activeComponent.kind]}
          </span>
          <button
            disabled={disabled}
            onClick={() => {
              setPlacingId(activeComponent.id);
              onPending(null);
              onPin("");
              onTool("select");
            }}
          >
            <Hand size={14} />
            {Object.values(activeComponent.pins).some(
              (pin) =>
                allPlacements[pin] &&
                boardNumber(allPlacements[pin]) !== activeBoard,
            )
              ? `Transférer sur la plaque ${activeBoard}`
              : "Placer l’ensemble"}
          </button>
          {!externalComponent(activeComponent) && (
            <button
              disabled={
                disabled ||
                Object.values(activeComponent.pins).some(
                  (pin) => !placements[pin],
                )
              }
              onClick={() =>
                void commit(
                  rotateFootprint(project, activeComponent.id),
                  activeComponent.id,
                  false,
                )
              }
            >
              <RotateCw size={14} />
              Tourner 90°
            </button>
          )}
          {["switch", "button"].includes(activeComponent.kind) && (
            <button
              disabled={disabled}
              onClick={() =>
                void act([
                  {
                    type: "set_value",
                    id: activeComponent.id,
                    value: activeComponent.value ? 0 : 1,
                  },
                ])
              }
            >
              {activeComponent.value ? "Ouvrir" : "Fermer"}
            </button>
          )}
          {activeComponent.kind === "potentiometer" && onPosition && (
            <label className="bb-pot-control">
              Curseur P → W
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={potDraft}
                disabled={disabled}
                aria-label={`Position du potentiomètre ${activeComponent.label}`}
                onChange={(event) => setPotDraft(Number(event.target.value))}
                onPointerUp={(event) =>
                  applyPosition(Number(event.currentTarget.value))
                }
                onKeyUp={(event) => {
                  if (
                    [
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  )
                    applyPosition(Number(event.currentTarget.value));
                }}
                onBlur={(event) =>
                  applyPosition(Number(event.currentTarget.value))
                }
              />
              <output>{Math.round(potDraft * 100)} %</output>
            </label>
          )}
          {orderedPins(activeComponent).map(([name, terminal]) => (
            <button
              key={terminal}
              disabled={disabled}
              className={activePin === terminal ? "active" : ""}
              onClick={() => activatePin(activeComponent, terminal)}
            >
              {name.toUpperCase()} · {placements[terminal] || "hors plaque"}
            </button>
          ))}
          {Object.values(activeComponent.pins).some(
            (pin) => placements[pin],
          ) && (
            <button
              disabled={disabled}
              onClick={async () => {
                if (
                  await act(
                    Object.values(activeComponent.pins).map((terminal) => ({
                      type: "place_pin",
                      terminal,
                      hole: null,
                    })),
                  )
                ) {
                  reset();
                  onNotice(
                    `${activeComponent.label} retiré de la plaque. Son schéma et ses fils sont conservés ; les contacts physiques ont changé.`,
                  );
                }
              }}
            >
              Retirer de la plaque
            </button>
          )}
        </div>
      )}
      {activePin && (
        <form
          className="bb-hole-form"
          onSubmit={(event) => {
            event.preventDefault();
            void commit(
              placeBoardPin(
                project,
                activePin,
                holeDraft.includes(":")
                  ? holeDraft.trim().toLowerCase()
                  : localHole(holeDraft.trim().toLowerCase()),
              ),
            );
          }}
        >
          <label htmlFor="bb-target-hole">
            Déplacer {activePin} dans le trou
          </label>
          <input
            id="bb-target-hole"
            value={holeDraft}
            onChange={(event) => setHoleDraft(event.target.value)}
            placeholder="ex. c12"
            autoComplete="off"
            disabled={disabled}
          />
          <button className="outline" disabled={disabled || !holeDraft.trim()}>
            <Check size={14} />
            Placer la patte
          </button>
        </form>
      )}
      <div
        className="bb-board-scroll"
        tabIndex={0}
        role="region"
        aria-label="Plaque à plat défilable horizontalement"
      >
        <svg
          ref={svgRef}
          className={`bb-board ${paletteOver ? "bb-palette-over" : ""}`}
          viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
          aria-label="Breadboard plane, groupes A–E et F–J, rails séparés"
          aria-describedby="bb-board-instructions"
          tabIndex={disabled ? -1 : 0}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setBoardFocused(true);
          }}
          onBlur={(event) => {
            if (event.target === event.currentTarget) setBoardFocused(false);
          }}
          onKeyDown={(event) => {
            if (disabled || event.target !== event.currentTarget) return;
            const deltas: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const delta = deltas[event.key];
            if (delta) {
              event.preventDefault();
              event.stopPropagation();
              const next = adjacentBoardHole(keyboardHole, ...delta);
              if (next) {
                setKeyboardHole(next);
                setHoverHole(next);
              }
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              void clickHole(keyboardHole);
            }
          }}
          onPointerMove={(event) => {
            if (
              capturedPointer.current &&
              capturedPointer.current.id !== event.pointerId
            )
              return;
            const xy = point(event);
            const hole = snapActiveHole(...xy);
            setHoverHole(hole);
            if (drag)
              setDrag({
                ...drag,
                moved:
                  drag.moved ||
                  Math.hypot(xy[0] - drag.start[0], xy[1] - drag.start[1]) > 4,
                proposal: proposalAt(drag, xy),
              });
          }}
          onPointerUp={finishDrag}
          onPointerCancel={(event) => {
            if (
              capturedPointer.current &&
              capturedPointer.current.id !== event.pointerId
            )
              return;
            releaseCapture();
            setDrag(null);
            setHoverHole(null);
            suppressClick.current = false;
            onNotice("Geste interrompu : aucun déplacement appliqué.");
          }}
          onPointerLeave={() => {
            if (!drag) setHoverHole(null);
          }}
          onDragOver={(event) => {
            const componentData = event.dataTransfer.types.includes(
              "application/x-atelier-component",
            );
            if (
              disabled ||
              (!trayDragId && !(onDropComponent && componentData))
            )
              return;
            event.preventDefault();
            event.dataTransfer.dropEffect = trayDragId ? "move" : "copy";
            setPaletteOver(!trayDragId);
            setHoverHole(snapActiveHole(...point(event)));
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setPaletteOver(false);
              setHoverHole(null);
            }
          }}
          onDrop={(event) => {
            if (disabled) return;
            event.preventDefault();
            const id =
              trayDragId ||
              event.dataTransfer.getData("application/x-atelier-component");
            const hole = snapActiveHole(...point(event));
            if (id && hole && project.components.some((c) => c.id === id))
              void commit(defaultFootprint(project, id, hole), id);
            else if (id && hole && onDropComponent && state.catalog[id])
              onDropComponent(id, hole);
            else onNotice("Dépose la première patte sur un trou de la plaque.");
            setTrayDragId(null);
            setPaletteOver(false);
            setHoverHole(null);
          }}
        >
          <rect
            x="28"
            y="17"
            width="874"
            height="492"
            rx="5"
            className="bb-flat-surface"
          />
          <rect
            x="55"
            y="244"
            width="820"
            height="31"
            rx="1"
            className="bb-center-gap"
          />
          <text x="465" y="265" textAnchor="middle" className="bb-gap-label">
            A–E et F–J sont séparés
          </text>
          {Array.from({ length: 30 }, (_, index) => {
            const x = BOARD.firstColumnX + index * BOARD.pitch;
            return (
              <g key={index}>
                <text
                  x={x}
                  y="100"
                  textAnchor="middle"
                  className="bb-coordinate"
                >
                  {index + 1}
                </text>
                <text
                  x={x}
                  y="431"
                  textAnchor="middle"
                  className="bb-coordinate"
                >
                  {index + 1}
                </text>
              </g>
            );
          })}
          {"abcdefghij".split("").map((row) => (
            <text
              key={row}
              x="64"
              y={boardHolePoint(`${row}1`)![1] + 4}
              textAnchor="middle"
              className="bb-coordinate"
            >
              {row.toUpperCase()}
            </text>
          ))}
          {(["top", "bottom"] as const).flatMap((side) =>
            (["p", "n"] as const).map((polarity) => {
              const y = boardHolePoint(`rail_${side}_${polarity}1`)![1];
              return (
                <g key={`${side}${polarity}`}>
                  <text
                    x="62"
                    y={y + 4}
                    className={`bb-rail-label ${polarity}`}
                  >
                    {polarity === "p" ? "+" : "−"}
                  </text>
                  {(project.breadboard.rail_splits
                    ? [
                        [1, 15],
                        [16, 30],
                      ]
                    : [[1, 30]]
                  ).map(([from, to]) => (
                    <line
                      key={from}
                      x1={
                        boardHolePoint(`rail_${side}_${polarity}${from}`)![0] -
                        9
                      }
                      x2={
                        boardHolePoint(`rail_${side}_${polarity}${to}`)![0] + 9
                      }
                      y1={y - 10}
                      y2={y - 10}
                      className={`bb-rail-line ${polarity}`}
                    />
                  ))}
                  {project.breadboard.rail_splits && (
                    <text
                      x={
                        (boardHolePoint("a15")![0] +
                          boardHolePoint("a16")![0]) /
                        2
                      }
                      y={y - 9}
                      className="bb-cut-label"
                      textAnchor="middle"
                    >
                      //
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {Array.from({ length: 30 }, (_, index) =>
            ["a", "f"].map((row) => {
              const first = localHole(`${row}${index + 1}`),
                end = localHole(`${row === "a" ? "e" : "j"}${index + 1}`);
              const net = state.topology.hole_to_net[first];
              const active = net && (net === hoverNet || selectedNets.has(net));
              return (
                <line
                  key={first}
                  x1={boardHolePoint(first)![0]}
                  y1={boardHolePoint(first)![1]}
                  x2={boardHolePoint(end)![0]}
                  y2={boardHolePoint(end)![1]}
                  className={`bb-metal-band ${active ? "active" : ""}`}
                />
              );
            }),
          )}
          {boardHolesOnBoard(activeBoard).map((hole) => {
            const xy = boardHolePoint(hole)!;
            const net = state.topology.hole_to_net[hole];
            const occupied = Object.entries(placements).find(
              ([, current]) => current === hole,
            );
            const active =
              hole === hoverHole ||
              (boardFocused && hole === keyboardHole) ||
              hole === boardWire ||
              Boolean(net && (net === hoverNet || selectedNets.has(net)));
            return (
              <g
                key={hole}
                className={`bb-hole ${active ? "active" : ""} ${occupied ? "occupied" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  void clickHole(hole);
                }}
              >
                <circle cx={xy[0]} cy={xy[1]} r="9" fill="transparent" />
                <circle
                  cx={xy[0]}
                  cy={xy[1]}
                  r={active ? 5.2 : 3.4}
                  className="bb-hole-dot"
                />
                <title>
                  {hole} · {boardGroup(hole, project.breadboard.rail_splits)}
                  {occupied ? ` · ${occupied[0]}` : " · libre"} ·{" "}
                  {format(net ? simulation?.voltages[net] : undefined)}
                </title>
              </g>
            );
          })}
          <g className="bb-jumpers">
            {project.wires.map((wire, index) => {
              const a = boardHolePoint(placements[wire.a] || ""),
                b = boardHolePoint(placements[wire.b] || "");
              if (!a || !b) return null;
              const path = rigidJumperPath(a, b, index);
              const isSelected =
                selected.includes(wire.id) || highlights.includes(wire.id);
              return (
                <g
                  key={wire.id}
                  role="button"
                  tabIndex={preview ? -1 : 0}
                  aria-label={`Cavalier ${wire.id} entre ${placements[wire.a]} et ${placements[wire.b]}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!disabled) onSelect(wire.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !disabled &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onSelect(wire.id);
                    }
                  }}
                >
                  <path
                    className={`bb-jumper ${isSelected ? "selected" : ""}`}
                    d={path}
                    stroke={
                      !voltageColors && wire.color ? wire.color : paint(wire.a)
                    }
                  />
                  <path
                    d={path}
                    stroke="transparent"
                    strokeWidth="12"
                    fill="none"
                  />
                  <title>
                    {wire.id} · {wire.a} ↔ {wire.b} ·{" "}
                    {simulation?.wire_current_status?.[wire.id] === "unique"
                      ? `courant ${format(simulation.wire_currents?.[wire.id] ?? undefined, "A")}`
                      : "répartition du courant indéterminée dans les boucles de conducteurs idéaux"}
                  </title>
                  <FlowParticles
                    path={path}
                    current={
                      simulation?.wire_currents?.[wire.id] ??
                      simulation?.wire_flow_hints?.[wire.id]
                    }
                    mode={stale || preview ? "off" : flowMode}
                    speed={flowSpeed}
                    indicative={
                      simulation?.wire_current_status?.[wire.id] !== "unique"
                    }
                  />
                </g>
              );
            })}
          </g>
          {project.components.map((component) =>
            renderComponent(component, placements),
          )}
          {ghost?.ok &&
            ghostComponent &&
            project.components
              .filter((c) => c.id === ghostComponent)
              .map((component) =>
                renderComponent(
                  component,
                  { ...placements, ...ghost.placements },
                  true,
                ),
              )}
          {ghost &&
            Object.values(ghost.placements).map((hole) => {
              const p = boardHolePoint(hole);
              return (
                p && (
                  <circle
                    key={hole}
                    cx={p[0]}
                    cy={p[1]}
                    r="9"
                    className={`bb-ghost-target ${ghost.ok ? "valid" : "invalid"}`}
                  />
                )
              );
            })}
          {hoverHole && ghost && !ghost.ok && (
            <circle
              cx={boardHolePoint(hoverHole)![0]}
              cy={boardHolePoint(hoverHole)![1]}
              r="10"
              className="bb-ghost-target invalid"
            />
          )}
          {paletteOver && hoverHole && (
            <circle
              cx={boardHolePoint(hoverHole)![0]}
              cy={boardHolePoint(hoverHole)![1]}
              r="11"
              className="bb-palette-target"
            />
          )}
        </svg>
      </div>
      <p className={`bb-board-feedback ${ghost && !ghost.ok ? "invalid" : ""}`}>
        {preview
          ? "Prévisualisation : aucune modification n’est appliquée avant confirmation."
          : paletteOver
            ? hoverHole
              ? `Déposer ici : première borne dans ${hoverHole}. Le placement sera refusé si le corps ou une patte rencontre un obstacle.`
              : "Survole un trou pour placer la première borne du composant."
            : boardFocused && !drag && !hoverProposal
              ? `Trou clavier : ${keyboardHole} · ${Object.entries(placements).find(([, occupied]) => occupied === keyboardHole)?.[0] || "libre"}. Flèches pour se déplacer, Entrée pour agir.`
              : drag
                ? ghost?.message ||
                  "Glisse vers un trou libre. Toutes les pattes du corps se déplacent ensemble."
                : hoverProposal
                  ? hoverProposal.message
                  : "A–E d’une colonne sont reliés ; F–J forment un groupe distinct. Un déplacement peut créer ou supprimer une connexion physique."}
      </p>
      {interboardWires.length > 0 && (
        <details className="bb-interboard">
          <summary>
            <Link2 size={14} />
            Liaisons entre plaques · {interboardWires.length}
          </summary>
          <div>
            {interboardWires.map((wire) => {
              const a = allPlacements[wire.a],
                b = allPlacements[wire.b];
              return (
                <div
                  key={wire.id}
                  className={selected.includes(wire.id) ? "selected" : ""}
                >
                  <button onClick={() => onSelect(wire.id)}>
                    {wire.id}
                    <span>
                      {wire.a} · plaque {boardNumber(a)} {a.split(":").at(-1)} ↔{" "}
                      {wire.b} · plaque {boardNumber(b)} {b.split(":").at(-1)}
                    </span>
                  </button>
                  <button
                    aria-label={`Voir le fil ${wire.id} sur la plaque ${boardNumber(a) === activeBoard ? boardNumber(b) : boardNumber(a)}`}
                    onClick={() => {
                      setActiveBoard(
                        boardNumber(a) === activeBoard
                          ? boardNumber(b)
                          : boardNumber(a),
                      );
                      onSelect(wire.id);
                    }}
                  >
                    Voir l’autre plaque
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}
      {unplaced.length > 0 && (
        <div className="bb-unplaced">
          <h3>
            <CircuitBoard size={16} />À implanter · {unplaced.length} composant
            {unplaced.length > 1 ? "s" : ""}
          </h3>
          <p>
            Glisse un composant vers un trou, ou choisis « Placer l’ensemble ».
            Aucune implantation automatique silencieuse.
          </p>
          <div className="bb-tray">
            {unplaced.map((c) => (
              <div
                key={c.id}
                className={`bb-tray-part ${selected.includes(c.id) ? "selected" : ""}`}
                draggable={!disabled}
                onDragStart={(event) => {
                  if (disabled) return;
                  event.dataTransfer.setData(
                    "application/x-atelier-component",
                    c.id,
                  );
                  event.dataTransfer.effectAllowed = "move";
                  setTrayDragId(c.id);
                }}
                onDragEnd={() => {
                  setTrayDragId(null);
                  setHoverHole(null);
                }}
              >
                <strong>
                  {c.label} <span>{kindNames[c.kind]}</span>
                </strong>
                <div className="bb-tray-pins">
                  {orderedPins(c).map(([name, pin]) => (
                    <button
                      key={pin}
                      disabled={disabled}
                      onClick={() => activatePin(c, pin)}
                    >
                      {name.toUpperCase()} · {placements[pin] || "hors plaque"}
                    </button>
                  ))}
                </div>
                <button
                  disabled={disabled}
                  onClick={() => {
                    onSelect(c.id);
                    setPlacingId(c.id);
                    onPending(null);
                    onPin("");
                    onTool("select");
                  }}
                >
                  <Hand size={14} />
                  Placer l’ensemble
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bb-legend">
        <Info size={16} />
        <p>
          Boîtiers pédagogiques à plat ; A/K et C/B/E viennent du modèle
          explicite. Alimentation, masse et sondes sont des{" "}
          <strong>connecteurs virtuels</strong>, pas des boîtiers réels. Les
          cavaliers sont des segments rigides à angle droit.
          {project.components.some((c) => c.kind === "led") &&
            " La lumière des LED est symbolique et dépend du courant calculé ; elle reste inconnue avant calcul ou après modification. Un courant supérieur à 20 mA est signalé, sans modèle thermique."}
          {hiddenWires > 0 &&
            ` ${hiddenWires} liaison(s) restent hors plaque jusqu’au placement de leurs extrémités.`}
        </p>
      </div>
    </section>
  );
}
