export type ScopeCurveMeasurements = {
  /** Horodatages finis compris dans la fenêtre, valeurs manquantes incluses. */
  sampleCount: number;
  missingCount: number;
  start: number | null;
  end: number | null;
  min: number | null;
  max: number | null;
  peakToPeak: number | null;
  mean: number | null;
  rms: number | null;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Mesures sur les échantillons réels de la fenêtre, bornes incluses.
 * Les extrema ignorent les valeurs manquantes. La moyenne et la valeur efficace
 * intègrent le signal linéaire entre points adjacents ; un trou ou un temps
 * non croissant dans cet intervalle rend ces deux intégrales indisponibles.
 * Aucune interpolation ne prolonge les données jusqu'aux bords de la fenêtre.
 */
export function measureScopeCurve(
  time: readonly number[],
  values: readonly number[],
  range: { start: number; end: number },
): ScopeCurveMeasurements {
  const result: ScopeCurveMeasurements = {
    sampleCount: 0,
    missingCount: 0,
    start: null,
    end: null,
    min: null,
    max: null,
    peakToPeak: null,
    mean: null,
    rms: null,
  };
  if (!finite(range.start) || !finite(range.end) || range.end < range.start)
    return result;

  let first = -1;
  let last = -1;
  let amplitude = 0;
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (!finite(t) || t < range.start || t > range.end) continue;
    if (first === -1) {
      first = i;
      result.start = t;
    }
    last = i;
    result.end = t;
    result.sampleCount++;
    const value = values[i];
    if (!finite(value)) {
      result.missingCount++;
      continue;
    }
    result.min = result.min === null ? value : Math.min(result.min, value);
    result.max = result.max === null ? value : Math.max(result.max, value);
    amplitude = Math.max(amplitude, Math.abs(value));
  }
  if (result.min !== null && result.max !== null) {
    const span = result.max - result.min;
    result.peakToPeak = finite(span) ? span : null;
  }
  if (
    result.sampleCount < 2 ||
    result.missingCount ||
    last - first + 1 !== result.sampleCount
  )
    return result;

  const start = result.start!;
  const end = result.end!;
  if (end <= start) return result;
  const duration = end - start;
  // Deux temps finis de signes opposés peuvent avoir une différence infinie.
  // Diviser avant de soustraire conserve leurs rapports temporels sans overflow.
  const halfDuration = end / 2 - start / 2;
  const halfTimes = !finite(duration);
  let mean = 0;
  let square = 0;
  let weightSum = 0;
  let meanCorrection = 0;
  let squareCorrection = 0;
  let weightCorrection = 0;
  for (let i = first; i < last; i++) {
    const aTime = time[i];
    const bTime = time[i + 1];
    if (!finite(aTime) || !finite(bTime) || bTime <= aTime) return result;
    const weight = halfTimes
      ? (bTime / 2 - aTime / 2) / halfDuration
      : (bTime - aTime) / duration;
    if (!finite(weight) || weight < 0) return result;
    // Les amplitudes normalisées évitent a², a*b ou a+b hors limites.
    const a = amplitude ? values[i] / amplitude : 0;
    const b = amplitude ? values[i + 1] / amplitude : 0;
    const meanTerm = (weight * (a + b)) / 2 - meanCorrection;
    const nextMean = mean + meanTerm;
    meanCorrection = nextMean - mean - meanTerm;
    mean = nextMean;
    const squareTerm =
      (weight * (a * a + a * b + b * b)) / 3 - squareCorrection;
    const nextSquare = square + squareTerm;
    squareCorrection = nextSquare - square - squareTerm;
    square = nextSquare;
    const weightTerm = weight - weightCorrection;
    const nextWeight = weightSum + weightTerm;
    weightCorrection = nextWeight - weightSum - weightTerm;
    weightSum = nextWeight;
  }
  if (!(weightSum > 0) || !finite(weightSum)) return result;
  // Les arrondis ne doivent pas dépasser l'amplitude finie de départ.
  const normalizedMean = Math.max(-1, Math.min(1, mean / weightSum));
  const normalizedSquare = Math.max(0, Math.min(1, square / weightSum));
  result.mean = normalizedMean * amplitude;
  result.rms = Math.sqrt(normalizedSquare) * amplitude;
  return result;
}
