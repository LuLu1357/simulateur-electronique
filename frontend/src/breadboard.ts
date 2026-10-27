import type { Component, Op, Project } from "./types";

/** Plaque vue de dessus : coordonnées planes, sans perspective ni boîtier inféré. */
export const BOARD = {
  width: 940,
  height: 530,
  firstColumnX: 92,
  pitch: 26,
  columns: 30,
  rows: [
    "rail_top_p",
    "rail_top_n",
    ..."abcdefghij",
    "rail_bottom_p",
    "rail_bottom_n",
  ],
  ys: [39, 65, 117, 143, 169, 195, 221, 299, 325, 351, 377, 403, 455, 481],
} as const;
export type BoardPoint = [number, number];
export type PlacementProposal = {
  ok: boolean;
  placements: Record<string, string>;
  operations: Op[];
  message: string;
};

export function parseBoardHole(
  hole: string,
): { row: string; column: number; board?: number } | null {
  const prefix = /^([2-4]):(.+)$/.exec(hole);
  const local = prefix ? prefix[2] : hole;
  const matched = /^(rail_(?:top|bottom)_[pn]|[a-j])(\d+)$/.exec(local);
  if (!matched) return null;
  const column = Number(matched[2]);
  return column >= 1 && column <= 30 && String(column) === matched[2]
    ? {
        row: matched[1],
        column,
        ...(prefix ? { board: Number(prefix[1]) } : {}),
      }
    : null;
}

export function boardNumber(hole: string): number {
  return parseBoardHole(hole)?.board || 1;
}
export function holeOnBoard(local: string, board = 1): string {
  return board === 1
    ? local.replace(/^[2-4]:/, "")
    : `${board}:${local.replace(/^[2-4]:/, "")}`;
}
export function boardHolesOnBoard(board = 1): string[] {
  return boardHoles.map((hole) => holeOnBoard(hole, board));
}

export function boardHolePoint(hole: string): BoardPoint | null {
  const parsed = parseBoardHole(hole);
  if (!parsed) return null;
  const rowIndex = (BOARD.rows as readonly string[]).indexOf(parsed.row);
  return rowIndex < 0
    ? null
    : [
        BOARD.firstColumnX + (parsed.column - 1) * BOARD.pitch,
        BOARD.ys[rowIndex],
      ];
}

export const boardHoles: string[] = BOARD.rows.flatMap((row) =>
  Array.from({ length: BOARD.columns }, (_, index) => `${row}${index + 1}`),
);

export function snapBoardHole(
  x: number,
  y: number,
  maxDistance = 18,
  board = 1,
): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let closest: string | null = null;
  let distance = maxDistance;
  for (const hole of boardHoles) {
    const point = boardHolePoint(hole)!;
    const candidate = Math.hypot(point[0] - x, point[1] - y);
    if (candidate <= distance) {
      closest = hole;
      distance = candidate;
    }
  }
  return closest ? holeOnBoard(closest, board) : null;
}

export function boardGroup(hole: string, splitRails = true): string | null {
  const parsed = parseBoardHole(hole);
  if (!parsed) return null;
  const group = parsed.row.startsWith("rail_")
    ? `${parsed.row}_${splitRails && parsed.column > 15 ? "right" : "left"}`
    : `${parsed.row < "f" ? "AE" : "FJ"}${parsed.column}`;
  return parsed.board ? `${parsed.board}:${group}` : group;
}

export function orderedPins(component: Component): [string, string][] {
  const order = ["diode", "led"].includes(component.kind)
    ? ["a", "k"]
    : component.kind === "potentiometer"
      ? ["p", "w", "n"]
      : ["npn", "pnp"].includes(component.kind)
        ? ["c", "b", "e"]
        : component.kind === "ground"
          ? ["g"]
          : ["p", "n"];
  return order
    .filter((name) => component.pins[name])
    .map((name) => [name, component.pins[name]]);
}

export function externalComponent(component: Component): boolean {
  return [
    "voltage_source",
    "ground",
    "voltage_probe",
    "current_probe",
  ].includes(component.kind);
}

function rejected(message: string): PlacementProposal {
  return { ok: false, placements: {}, operations: [], message };
}

/** Libérer d'abord toutes les pattes évite une collision transitoire C→ancienne B. */
export function placementOperations(placements: Record<string, string>): Op[] {
  return [
    ...Object.keys(placements).map((terminal) => ({
      type: "place_pin",
      terminal,
      hole: null,
    })),
    ...Object.entries(placements).map(([terminal, hole]) => ({
      type: "place_pin",
      terminal,
      hole,
    })),
  ];
}

export type BodyBounds = {
  board?: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
/** Encombrement plan du corps, distinct des fils qui peuvent se croiser sans jonction. */
export function componentBodyBounds(
  component: Component,
  locations: Record<string, string>,
): BodyBounds | null {
  if (externalComponent(component)) return null;
  const bounds = (value: BodyBounds): BodyBounds => ({
    ...value,
    board: boardNumber(locations[orderedPins(component)[0]?.[1]] || ""),
  });
  const pins = orderedPins(component).map(([, pin]) =>
    boardHolePoint(locations[pin] || ""),
  );
  if (!pins.length || pins.some((point) => !point)) return null;
  const points = pins as BoardPoint[];
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  if (["npn", "pnp"].includes(component.kind))
    return bounds({
      left: cx - 31,
      right: cx + 31,
      top: minY - 43,
      bottom: minY - 16,
    });
  if (component.kind === "led")
    return bounds({
      left: cx - 16,
      right: cx + 16,
      top: minY - 39,
      bottom: minY - 7,
    });
  if (component.kind === "potentiometer")
    return bounds({
      left: cx - 30,
      right: cx + 30,
      top: minY - 57,
      bottom: minY - 7,
    });
  if (component.kind === "capacitor")
    return bounds({
      left: cx - 17,
      right: cx + 17,
      top: cy - 17,
      bottom: cy + 17,
    });
  const a = points[0],
    b = points[1] || a;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const halfWidth =
    Math.max(22, Math.min(52, Math.hypot(b[0] - a[0], b[1] - a[1]) - 20)) / 2;
  const halfHeight = ["switch", "button"].includes(component.kind) ? 12 : 9;
  const dx =
    Math.abs(Math.cos(angle)) * halfWidth +
    Math.abs(Math.sin(angle)) * halfHeight;
  const dy =
    Math.abs(Math.sin(angle)) * halfWidth +
    Math.abs(Math.cos(angle)) * halfHeight;
  return bounds({
    left: cx - dx,
    right: cx + dx,
    top: cy - dy,
    bottom: cy + dy,
  });
}

export function validatePlacement(
  project: Project,
  placements: Record<string, string>,
): PlacementProposal {
  const moving = new Set(Object.keys(placements));
  const targets = new Set<string>();
  for (const [terminal, hole] of Object.entries(placements)) {
    if (
      !boardHolePoint(hole) ||
      boardNumber(hole) > (project.breadboard.board_count || 1)
    )
      return rejected(
        `${terminal} sortirait de la plaque : déplacement refusé.`,
      );
    if (targets.has(hole))
      return rejected(`Deux bornes aboutiraient au même trou ${hole}.`);
    targets.add(hole);
    const occupant = Object.entries(project.breadboard.placements).find(
      ([id, occupied]) => !moving.has(id) && occupied === hole,
    );
    if (occupant)
      return rejected(
        `${hole} est déjà occupé par ${occupant[0]}. Aucun déplacement appliqué.`,
      );
  }
  const combined = { ...project.breadboard.placements, ...placements };
  const movingComponents = project.components.filter((component) =>
    Object.values(component.pins).some((pin) => moving.has(pin)),
  );
  for (const component of movingComponents) {
    if (
      !externalComponent(component) &&
      new Set(
        Object.values(component.pins)
          .filter((pin) => combined[pin])
          .map((pin) => boardNumber(combined[pin])),
      ).size > 1
    )
      return rejected(
        `Pour changer de plaque, transfère ${component.id} en entier avec « Placer l’ensemble ».`,
      );
    const body = componentBodyBounds(component, combined);
    if (!body) continue;
    if (
      body.left < 28 ||
      body.right > 902 ||
      body.top < 17 ||
      body.bottom > 509
    )
      return rejected(`Le corps de ${component.id} sortirait de la plaque.`);
    for (const other of project.components) {
      if (other.id === component.id) continue;
      const obstacle = componentBodyBounds(other, combined);
      if (
        obstacle &&
        (obstacle.board || 1) === (body.board || 1) &&
        body.left < obstacle.right &&
        body.right > obstacle.left &&
        body.top < obstacle.bottom &&
        body.bottom > obstacle.top
      )
        return rejected(
          `Le corps de ${component.id} recouvrirait ${other.id}. Choisis une autre position.`,
        );
    }
  }
  return {
    ok: true,
    placements,
    operations: placementOperations(placements),
    message: "Implantation prête. Les fils restent attachés aux mêmes bornes.",
  };
}

export function placeBoardPin(
  project: Project,
  terminal: string,
  hole: string,
): PlacementProposal {
  const known =
    project.components.some((c) => Object.values(c.pins).includes(terminal)) ||
    project.junctions.some((j) => j.id === terminal);
  return known
    ? validatePlacement(project, { [terminal]: hole })
    : rejected("Borne inconnue : sélectionne d’abord une borne du circuit.");
}

/** Translation réellement rigide : tous les écarts en coordonnées sont conservés. */
export function translateFootprint(
  project: Project,
  componentId: string,
  targetAnchorHole: string,
): PlacementProposal {
  const component = project.components.find((c) => c.id === componentId);
  if (!component) return rejected("Composant inconnu.");
  const pins = orderedPins(component);
  const oldAnchor = boardHolePoint(
    project.breadboard.placements[pins[0]?.[1]] || "",
  );
  const newAnchor = boardHolePoint(targetAnchorHole);
  if (
    !oldAnchor ||
    !newAnchor ||
    pins.some(
      ([, terminal]) =>
        !boardHolePoint(project.breadboard.placements[terminal] || ""),
    )
  )
    return rejected(
      "Place toutes les bornes avant de déplacer le corps, ou utilise « Placer l’ensemble ».",
    );
  const dx = newAnchor[0] - oldAnchor[0],
    dy = newAnchor[1] - oldAnchor[1];
  const proposed: Record<string, string> = {};
  for (const [, terminal] of pins) {
    const point = boardHolePoint(project.breadboard.placements[terminal])!;
    const hole = snapBoardHole(
      point[0] + dx,
      point[1] + dy,
      0.1,
      boardNumber(targetAnchorHole),
    );
    if (!hole)
      return rejected(
        "Le corps ne tient pas à cet endroit : une patte ne rejoindrait aucun trou. Aucun déplacement appliqué.",
      );
    proposed[terminal] = hole;
  }
  return validatePlacement(project, proposed);
}

/** Empreinte pédagogique explicite ; la documentation du boîtier réel reste nécessaire. */
export function defaultFootprint(
  project: Project,
  componentId: string,
  anchorHole: string,
): PlacementProposal {
  const component = project.components.find((c) => c.id === componentId);
  const anchor = parseBoardHole(anchorHole);
  if (!component || !anchor)
    return rejected("Choisis un composant et un trou valide.");
  const pins = orderedPins(component);
  const proposed: Record<string, string> = {};
  for (const [index, [, terminal]] of pins.entries()) {
    if (
      externalComponent(component) &&
      anchor.row.startsWith("rail_") &&
      pins.length === 2
    ) {
      const row = anchor.row.replace(/_[pn]$/, index === 0 ? "_p" : "_n");
      proposed[terminal] = holeOnBoard(
        `${row}${anchor.column}`,
        anchor.board || 1,
      );
    } else {
      const stride = ["npn", "pnp", "potentiometer", "led"].includes(
        component.kind,
      )
        ? 1
        : 3;
      proposed[terminal] = holeOnBoard(
        `${anchor.row}${anchor.column + index * stride}`,
        anchor.board || 1,
      );
    }
  }
  const proposal = validatePlacement(project, proposed);
  if (!proposal.ok) return proposal;
  if (
    !externalComponent(component) &&
    new Set(
      Object.values(proposed).map((hole) =>
        boardGroup(hole, project.breadboard.rail_splits),
      ),
    ).size < pins.length
  )
    return rejected(
      "Cette position réunirait les bornes du composant dans une même bande métallique. Choisis des colonnes distinctes dans A–E ou F–J.",
    );
  return proposal;
}

/** Validate a palette drop before the component is added to the shared model.
 * The caller can commit add_component and these placement operations together. */
export function insertionFootprint(
  project: Project,
  component: Component,
  anchorHole: string,
): PlacementProposal {
  if (project.components.some((existing) => existing.id === component.id))
    return rejected("Cet identifiant de composant existe déjà.");
  return defaultFootprint(
    { ...project, components: [...project.components, component] },
    component.id,
    anchorHole,
  );
}

/** Symbolic light intensity from measured forward current, never a predicted
 * current or a cached result from another electrical revision. */
export function ledVisualState(
  current: unknown,
  stale = false,
): {
  state: "unknown" | "off" | "on" | "overcurrent";
  intensity: number;
} {
  if (stale || typeof current !== "number" || !Number.isFinite(current))
    return { state: "unknown", intensity: 0 };
  if (current <= 1e-6) return { state: "off", intensity: 0 };
  return {
    state: current > 0.02 ? "overcurrent" : "on",
    intensity: Math.min(1, Math.sqrt(current / 0.02)),
  };
}

export function adjacentBoardHole(
  hole: string,
  dx: number,
  dy: number,
): string | null {
  const parsed = parseBoardHole(hole);
  if (!parsed) return null;
  const row = (BOARD.rows as readonly string[]).indexOf(parsed.row) + dy;
  const column = parsed.column + dx;
  return row >= 0 && row < BOARD.rows.length && column >= 1 && column <= 30
    ? holeOnBoard(`${BOARD.rows[row]}${column}`, parsed.board || 1)
    : null;
}

export function rotateFootprint(
  project: Project,
  componentId: string,
  quarterTurns = 1,
): PlacementProposal {
  const component = project.components.find((c) => c.id === componentId);
  if (!component) return rejected("Composant inconnu.");
  const pins = orderedPins(component);
  const pivot = boardHolePoint(
    project.breadboard.placements[pins[0]?.[1]] || "",
  );
  if (
    !pivot ||
    pins.some(
      ([, terminal]) =>
        !boardHolePoint(project.breadboard.placements[terminal] || ""),
    )
  )
    return rejected("Place toutes les bornes avant de tourner l’implantation.");
  const angle = (quarterTurns * Math.PI) / 2;
  const proposed: Record<string, string> = {};
  for (const [, terminal] of pins) {
    const point = boardHolePoint(project.breadboard.placements[terminal])!;
    const dx = point[0] - pivot[0],
      dy = point[1] - pivot[1];
    const hole = snapBoardHole(
      pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
      pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
      0.1,
      boardNumber(project.breadboard.placements[pins[0]?.[1]] || ""),
    );
    if (!hole)
      return rejected(
        "Cette rotation ne rejoint pas les trous de la plaque. Déplace le corps ou les pattes avant de réessayer.",
      );
    proposed[terminal] = hole;
  }
  const oldGroups = pins.map(([, terminal]) =>
    boardGroup(
      project.breadboard.placements[terminal],
      project.breadboard.rail_splits,
    ),
  );
  const newGroups = pins.map(([, terminal]) =>
    boardGroup(proposed[terminal], project.breadboard.rail_splits),
  );
  if (
    newGroups.some((group, i) =>
      newGroups.some(
        (other, j) =>
          j !== i && group === other && oldGroups[i] !== oldGroups[j],
      ),
    )
  )
    return rejected(
      "Cette rotation mettrait en contact des bornes auparavant séparées sur une même bande métallique.",
    );
  return validatePlacement(project, proposed);
}

/** Cavaliers rigides : segments droits et coudes à 90°, aucun câble courbe. */
export function rigidJumperPath(
  a: BoardPoint,
  b: BoardPoint,
  lane = 0,
): string {
  const offset = 12 + (Math.abs(lane) % 4) * 4;
  if (a[1] === b[1]) return `M${a[0]} ${a[1]}V${a[1] - offset}H${b[0]}V${b[1]}`;
  if (a[0] === b[0]) return `M${a[0]} ${a[1]}H${a[0] + offset}V${b[1]}H${b[0]}`;
  const elbowY = (a[1] + b[1]) / 2 + ((lane % 3) - 1) * 4;
  return `M${a[0]} ${a[1]}V${elbowY}H${b[0]}V${b[1]}`;
}
