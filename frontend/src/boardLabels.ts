/** Disposition des repères visuels uniquement : aucun trou ou réseau n'est modifié. */
export type BoardLabelCandidate = {
  id: string;
  x: number;
  y: number;
  width: number;
  callout?: boolean;
};
export type BoardLabelPosition = {
  mode: "inline" | "callout";
  x: number;
  y: number;
  width: number;
  height: number;
};

export function layoutBoardLabels(
  candidates: readonly BoardLabelCandidate[],
  boardWidth = 940,
) {
  const padding = 24,
    gap = 12,
    cardWidth = 156,
    cardHeight = 60,
    rowHeight = 76;
  const promoted = new Set(
    candidates
      .filter(
        (label) =>
          label.callout ||
          label.x - label.width / 2 < padding ||
          label.x + label.width / 2 > boardWidth - padding,
      )
      .map((label) => label.id),
  );
  // Sortir tous les libellés d'une collision, sans dépendre de l'ordre du projet.
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i],
        b = candidates[j];
      if (
        Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 8 &&
        Math.abs(a.y - b.y) < 26
      ) {
        promoted.add(a.id);
        promoted.add(b.id);
      }
    }
  }
  const callouts = candidates
    .filter((label) => promoted.has(label.id))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const columns = Math.max(
    1,
    Math.floor((boardWidth - padding * 2 + gap) / (cardWidth + gap)),
  );
  const headerHeight = callouts.length
    ? Math.ceil(callouts.length / columns) * rowHeight + 30
    : 0;
  const labels = new Map<string, BoardLabelPosition>();
  for (const candidate of candidates) {
    labels.set(candidate.id, {
      mode: "inline",
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: 20,
    });
  }
  callouts.forEach((candidate, i) => {
    labels.set(candidate.id, {
      mode: "callout",
      x: padding + (i % columns) * (cardWidth + gap),
      y: -headerHeight + 26 + Math.floor(i / columns) * rowHeight,
      width: cardWidth,
      height: cardHeight,
    });
  });
  return { labels, headerHeight };
}

/** Toute abréviation visible reste indiquée par une ellipse et un titre complet. */
export function boardLabelExcerpt(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length > maximum
    ? `${characters.slice(0, maximum - 1).join("")}…`
    : value;
}

export function boardHoleCaption(hole: string): string {
  return hole
    .replace(/^[2-4]:/, "")
    .replace("rail_top_p", "haut +")
    .replace("rail_top_n", "haut −")
    .replace("rail_bottom_p", "bas +")
    .replace("rail_bottom_n", "bas −");
}
