export type SweepRequest = {
  component_id: string;
  values: number[];
  probe: { p: string; n: string };
};
export type SweepRow = {
  index: number;
  value: number;
  voltage: number | null;
  current: number | null;
  status: string;
  diagnostics: { message?: string }[];
};
export type SweepReport = {
  status: string;
  project_id: string;
  project_revision: number;
  circuit_fingerprint: string;
  parameter: {
    component_id: string;
    label: string;
    field: string;
    unit: string;
  };
  probe: { p: string; n: string };
  total: number;
  completed: number;
  converged: number;
  rows: SweepRow[];
  elapsed_seconds: number;
  assumptions: string[];
};

/** Le client ne calcule que les valeurs d’entrée ; les mesures viennent du moteur. */
export function sweepValues(
  start: number,
  stop: number,
  count: number,
  logarithmic = false,
): number[] | null {
  if (
    ![start, stop, count].every(Number.isFinite) ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 16 ||
    start === stop ||
    (logarithmic && (start <= 0 || stop <= 0))
  )
    return null;
  const values = Array.from({ length: count }, (_, index) => {
    if (index === 0) return start;
    if (index === count - 1) return stop;
    const fraction = index / (count - 1);
    return logarithmic
      ? 10 ** (Math.log10(start) * (1 - fraction) + Math.log10(stop) * fraction)
      : start * (1 - fraction) + stop * fraction;
  });
  return values.every(Number.isFinite) ? values : null;
}

export function sweepCsv(report: SweepReport): string {
  const number = (value: number | null) =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  return (
    [
      "parameter_value_SI,voltage_V,current_A,status",
      ...report.rows.map((row) =>
        [
          number(row.value),
          number(row.voltage),
          number(row.current),
          `"${row.status.replaceAll('"', '""')}"`,
        ].join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
