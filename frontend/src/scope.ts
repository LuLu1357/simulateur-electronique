/** Pure sampling helpers. The cursor always reports a computed sample. */
export type ScopeRange = { start: number; end: number };
export type ScopeCurve = {
  id: string;
  label: string;
  unit: string;
  values: number[];
};

/** Scale before subtracting to avoid overflow across opposite finite extrema. */
export function plotFraction(value: number, min: number, max: number): number {
  if (![value, min, max].every(Number.isFinite)) return 0.5;
  if (min === max) return 0.5;
  const scale = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const fraction = (value / scale - min / scale) / (max / scale - min / scale);
  return Math.max(0, Math.min(1, fraction));
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function timeRange(time: readonly unknown[]): ScopeRange | null {
  let start = Infinity;
  let end = -Infinity;
  for (const value of time) {
    if (!finite(value)) continue;
    if (value < start) start = value;
    if (value > end) end = value;
  }
  return finite(start) && finite(end) ? { start, end } : null;
}

/** Handles absent samples and invalid entries without inventing a value. */
export function nearestSampleIndex(
  time: readonly unknown[],
  target: number,
  range?: ScopeRange | null,
): number {
  if (!finite(target)) return -1;
  let closest = -1;
  let distance = Infinity;
  for (let index = 0; index < time.length; index++) {
    const value = time[index];
    if (!finite(value) || (range && (value < range.start || value > range.end)))
      continue;
    const nextDistance = Math.abs(value - target);
    if (nextDistance < distance || closest === -1) {
      closest = index;
      distance = nextDistance;
    }
  }
  return closest;
}

export function curveRange(
  curves: readonly ScopeCurve[],
  time: readonly number[],
  range: ScopeRange,
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const curve of curves) {
    for (
      let index = 0;
      index < curve.values.length && index < time.length;
      index++
    ) {
      const value = curve.values[index];
      if (
        !finite(value) ||
        !finite(time[index]) ||
        time[index] < range.start ||
        time[index] > range.end
      )
        continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === max) return { min: -1, max: 1 };
  const padding = (max - min) * 0.08;
  if (!finite(padding) || !finite(min - padding) || !finite(max + padding))
    return { min, max };
  return { min: min - padding, max: max + padding };
}

/** Resize around the cursor, then slide the window to keep it in the dataset. */
export function zoomTimeRange(
  full: ScopeRange,
  current: ScopeRange,
  focus: number,
  factor: number,
): ScopeRange {
  const span = full.end - full.start;
  const width = (current.end - current.start) * factor;
  if (
    !finite(span) ||
    span <= 0 ||
    !finite(width) ||
    width <= 0 ||
    !finite(focus) ||
    !finite(factor) ||
    factor <= 0
  )
    return { ...full };
  if (width >= span) return { ...full };
  const center = Math.min(full.end, Math.max(full.start, focus));
  let start = center - width / 2;
  let end = center + width / 2;
  if (start < full.start) {
    end += full.start - start;
    start = full.start;
  }
  if (end > full.end) {
    start -= end - full.end;
    end = full.end;
  }
  return { start: Math.max(full.start, start), end: Math.min(full.end, end) };
}

function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export all real input samples, without cursor interpolation or decimation. */
export function scopeCsv(
  time: readonly number[],
  curves: readonly ScopeCurve[],
): string {
  const rows = [
    ["temps [s]", ...curves.map((curve) => `${curve.label} [${curve.unit}]`)]
      .map(csvText)
      .join(","),
  ];
  for (let index = 0; index < time.length; index++) {
    if (!finite(time[index])) continue;
    rows.push(
      [
        String(time[index]),
        ...curves.map((curve) =>
          finite(curve.values[index]) ? String(curve.values[index]) : "",
        ),
      ].join(","),
    );
  }
  return rows.join("\r\n") + "\r\n";
}
