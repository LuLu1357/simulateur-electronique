/** Textes droits, placés hors des symboles et des cibles de bornes. */
export type LabelAnchor = {
  x: number;
  y: number;
  textAnchor: "middle" | "start";
};
export type SchematicLabels = Record<"name" | "value" | "current", LabelAnchor>;
export function schematicLabels(kind: string, rotation = 0): SchematicLabels {
  const angle = Number.isFinite(rotation) ? (rotation * Math.PI) / 180 : 0;
  const vertical = Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle));
  const side = (x: number, currentY = 40): SchematicLabels => ({
    name: { x, y: -10, textAnchor: "start" },
    value: { x, y: 18, textAnchor: "start" },
    current: { x, y: currentY, textAnchor: "start" },
  });
  if (kind === "ground") {
    const labels = side(34);
    labels.name = vertical
      ? { x: 0, y: -32, textAnchor: "middle" }
      : { x: 34, y: 5, textAnchor: "start" };
    return labels;
  }
  if (kind === "potentiometer" || kind === "led") return side(68, 62);
  if (kind === "npn" || kind === "pnp") return side(62, 62);
  if (vertical) return side(42);
  return {
    name: { x: 0, y: -42, textAnchor: "middle" },
    value: { x: 0, y: 47, textAnchor: "middle" },
    current: { x: 0, y: 69, textAnchor: "middle" },
  };
}

/** Estimation conservatrice pour sélection et cadrage, sans mesurer le circuit. */
export function schematicLabelBounds(
  labels: SchematicLabels,
  text: Partial<Record<keyof SchematicLabels, string>>,
) {
  let left = -60,
    top = -60,
    right = 60,
    bottom = 54;
  for (const key of ["name", "value", "current"] as const) {
    const value = text[key];
    if (!value) continue;
    const font = key === "name" ? 16 : key === "value" ? 14 : 12;
    const width = value.length * font * 0.7;
    const anchor = labels[key];
    const x = anchor.x - (anchor.textAnchor === "middle" ? width / 2 : 0);
    left = Math.min(left, x - 8);
    right = Math.max(right, x + width + 8);
    top = Math.min(top, anchor.y - font - 8);
    bottom = Math.max(bottom, anchor.y + 12);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** fitCircuitView réserve déjà 100/80 px ; ajouter seulement le dépassement. */
export function schematicLabelFitPoints(
  position: { x: number; y: number },
  bounds: ReturnType<typeof schematicLabelBounds>,
) {
  return [
    {
      x: position.x + Math.min(0, bounds.x + 100),
      y: position.y + Math.min(0, bounds.y + 80),
    },
    {
      x: position.x + Math.max(0, bounds.x + bounds.width - 100),
      y: position.y + Math.max(0, bounds.y + bounds.height - 80),
    },
  ];
}
