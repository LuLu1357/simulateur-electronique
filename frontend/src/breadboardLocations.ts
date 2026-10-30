import { parseBoardHole } from "./breadboard";

export type PinLocation =
  | { status: "unplaced"; label: string }
  | {
      status: "active" | "other";
      board: number;
      hole: string;
      label: string;
    };

/** Décrit une implantation globale sans la modifier ni dépendre de la vue. */
export function pinLocation(
  placements: Readonly<Record<string, string>>,
  terminal: string,
  activeBoard: number,
): PinLocation {
  const placement = placements[terminal];
  const parsed = placement ? parseBoardHole(placement) : null;
  if (!parsed) return { status: "unplaced", label: "Non implantée" };

  const board = parsed.board ?? 1;
  const hole = `${parsed.row}${parsed.column}`;
  return {
    status: board === activeBoard ? "active" : "other",
    board,
    hole,
    label: `Plaque ${board} · ${hole}`,
  };
}
