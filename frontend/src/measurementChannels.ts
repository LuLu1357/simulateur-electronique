import type { ScopeCurve } from "./scope";

export type ChannelFilter = "all" | "voltage" | "current";

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function unitWords(unit: string): string {
  if (unit === "V") return "V volt volts tension tensions";
  if (unit === "A") return "A ampère ampères ampere amperes courant courants";
  return unit;
}

/** Recherche uniquement dans les métadonnées disponibles, jamais dans les valeurs. */
export function filterMeasurementChannels<T extends ScopeCurve>(
  curves: readonly T[],
  query: string,
  filter: ChannelFilter = "all",
): T[] {
  const words = normalized(query).trim().split(/\s+/).filter(Boolean);
  return curves.filter((curve) => {
    if (filter === "voltage" && curve.unit !== "V") return false;
    if (filter === "current" && curve.unit !== "A") return false;
    const text = normalized(
      `${curve.id} ${curve.label} ${unitWords(curve.unit)}`,
    );
    return words.every((word) => text.includes(word));
  });
}

/** Le premier affichage propose trois tensions, ou trois mesures si aucune tension. */
export function initialMeasurementSelection(
  curves: readonly ScopeCurve[],
): string[] {
  const voltages = curves.filter((curve) => curve.unit === "V");
  return [
    ...new Set((voltages.length ? voltages : curves).map((c) => c.id)),
  ].slice(0, 3);
}

/** Conserve les choix encore présents, y compris le choix explicite de n'en garder aucun. */
export function reconcileMeasurementSelection(
  selectedIds: readonly string[],
  curves: readonly ScopeCurve[],
): string[] {
  const available = new Set(curves.map((curve) => curve.id));
  return [...new Set(selectedIds)].filter((id) => available.has(id));
}
