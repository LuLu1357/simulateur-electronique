import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Download,
  MoveHorizontal,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { colors, format } from "../types";
import type { Simulation } from "../types";
import {
  curveRange,
  nearestSampleIndex,
  plotFraction,
  scopeCsv,
  scopeDisplayCursor,
  timeRange,
  zoomTimeRange,
} from "../scope";
import type { ScopeCurve, ScopeRange } from "../scope";
import { measureScopeCurve } from "../scopeMeasurements";
import "../oscilloscope.css";

const width = 880,
  height = 238,
  left = 84,
  right = 24,
  top = 24,
  bottom = 43;
const chartWidth = width - left - right,
  chartHeight = height - top - bottom;
const fallbackCurves: ScopeCurve[] = [];
const fallbackTime: number[] = [];

export function Oscilloscope({
  sim,
  stale = false,
  cursorIndex: controlledCursorIndex,
  onCursorChange,
}: {
  sim: Simulation | null;
  stale?: boolean;
  cursorIndex?: number;
  onCursorChange?: (index: number) => void;
}) {
  const curves = sim?.curves || fallbackCurves;
  const time = sim?.time || fallbackTime;
  const signature = curves.map((curve) => curve.id).join("\u0000");
  // Polling returns new arrays every second. Preserve cursor and zoom until the
  // actual result changes, rather than resetting on every HTTP response.
  const datasetSignature = JSON.stringify([
    sim?.simulation_id,
    sim?.project_revision,
    sim?.analysis,
    time.length,
    time[0],
    time.at(-1),
    curves.map((curve) => [
      curve.id,
      curve.values.length,
      curve.values[0],
      curve.values.at(-1),
    ]),
  ]);
  const [visible, setVisible] = useState<string[]>([]);
  const [windowRange, setWindowRange] = useState<ScopeRange | null>(null);
  const [localCursorIndex, setLocalCursorIndex] = useState(-1);
  const [exportNotice, setExportNotice] = useState("");
  const [measuredId, setMeasuredId] = useState("");
  const initialized = useRef(false);
  const controlled = controlledCursorIndex !== undefined;
  const cursorIndex = controlled
    ? Number.isFinite(controlledCursorIndex)
      ? Math.max(
          0,
          Math.min(Math.trunc(controlledCursorIndex), time.length - 1),
        )
      : time.length - 1
    : localCursorIndex;
  const selectCursor = (index: number) => {
    if (!time.length || !Number.isFinite(index) || index < 0) return;
    const next = Math.min(Math.trunc(index), time.length - 1);
    if (controlled) onCursorChange?.(next);
    else setLocalCursorIndex(next);
  };
  const full = useMemo(() => timeRange(time), [time]);
  useEffect(() => {
    setVisible((current) => {
      const retained = current.filter((id) =>
        curves.some((curve) => curve.id === id),
      );
      if (initialized.current && retained.length) return retained;
      initialized.current = true;
      const voltages = curves.filter((curve) => curve.unit === "V");
      return (voltages.length ? voltages : curves)
        .slice(0, 3)
        .map((curve) => curve.id);
    });
  }, [signature]);
  useEffect(() => {
    setWindowRange(null);
    setExportNotice("");
  }, [datasetSignature]);
  useEffect(() => {
    if (!controlled) setLocalCursorIndex(time.length ? time.length - 1 : -1);
  }, [datasetSignature, controlled]);
  const range =
    windowRange && full
      ? {
          start: Math.max(full.start, windowRange.start),
          end: Math.min(full.end, windowRange.end),
        }
      : full;
  const selected = useMemo(
    () => curves.filter((curve) => visible.includes(curve.id)),
    [curves, visible],
  );
  const measuredCurve =
    selected.find((curve) => curve.id === measuredId) || selected[0];
  const measurements = useMemo(
    () =>
      measuredCurve && range
        ? measureScopeCurve(time, measuredCurve.values, range)
        : null,
    [measuredCurve, time, range?.start, range?.end],
  );
  const { index: cursor, inView: cursorInView } = scopeDisplayCursor(
    time,
    cursorIndex,
    range,
    controlled,
  );
  const sampleTime = cursor >= 0 ? time[cursor] : undefined;
  const windowSamples = useMemo(
    () =>
      range
        ? time
            .map((value, index) => ({ value, index }))
            .filter(
              ({ value }) =>
                Number.isFinite(value) &&
                value >= range.start &&
                value <= range.end,
            )
            .map(({ index }) => index)
        : [],
    [time, range?.start, range?.end],
  );
  const zoomed =
    !!full && !!range && (range.start > full.start || range.end < full.end);
  const plots = useMemo(() => {
    if (!range) return [];
    return [...new Set(selected.map((curve) => curve.unit))].map((unit) => {
      const plotted = selected.filter((curve) => curve.unit === unit);
      const bounds = curveRange(plotted, time, range);
      const paths = new Map<string, string>();
      for (const curve of plotted) {
        let path = "",
          connected = false;
        for (const index of windowSamples) {
          const value = curve.values[index];
          if (!Number.isFinite(value)) {
            connected = false;
            continue;
          }
          const x =
            left +
            plotFraction(time[index], range.start, range.end) * chartWidth;
          const y =
            top +
            (1 - plotFraction(value, bounds.min, bounds.max)) * chartHeight;
          path += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
          connected = true;
        }
        paths.set(curve.id, path);
      }
      return { unit, plotted, bounds, paths };
    });
  }, [selected, time, range?.start, range?.end, windowSamples]);
  const zoom = (factor: number) => {
    if (!full || !range) return;
    setWindowRange(
      zoomTimeRange(
        full,
        range,
        sampleTime ?? (range.start + range.end) / 2,
        factor,
      ),
    );
  };
  const setCursorFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!range) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    // SVG preserves its aspect ratio, so account for its horizontal letterbox.
    const scale = Math.min(bounds.width / width, bounds.height / height);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const offset = (bounds.width - width * scale) / 2;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        ((event.clientX - bounds.left - offset) / scale - left) / chartWidth,
      ),
    );
    selectCursor(
      nearestSampleIndex(
        time,
        range.start + fraction * (range.end - range.start),
        range,
      ),
    );
  };
  const moveCursor = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!windowSamples.length) return;
    const local = nearestSampleIndex(
      time,
      sampleTime ?? range?.end ?? 0,
      range,
    );
    const offset = windowSamples.indexOf(local);
    const count = event.shiftKey ? 10 : 1;
    let next: number;
    if (event.key === "ArrowLeft") next = Math.max(0, offset - count);
    else if (event.key === "ArrowRight")
      next = Math.min(windowSamples.length - 1, offset + count);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = windowSamples.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    selectCursor(windowSamples[next]);
  };
  const exportCsv = () => {
    try {
      const url = URL.createObjectURL(
        new Blob(["\ufeff", scopeCsv(time, selected)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `oscilloscope-revision-${sim?.project_revision ?? "inconnue"}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNotice(
        "CSV exporté : tous les échantillons calculés des courbes sélectionnées.",
      );
    } catch {
      setExportNotice("Le téléchargement est indisponible dans ce navigateur.");
    }
  };
  return (
    <section className="lab-scope" aria-label="Oscilloscope interactif">
      <div className="lab-scope-heading">
        <div>
          <Activity size={18} />
          <h3>Oscilloscope</h3>
          <span>MESURES TEMPORELLES</span>
        </div>
        <button onClick={exportCsv} disabled={!full || !selected.length}>
          <Download size={14} /> Exporter CSV
        </button>
      </div>
      {stale && (
        <p className="lab-scope-stale" role="status">
          Mesures précédentes · révision {sim?.project_revision}. Recalcule le
          circuit modifié pour actualiser les courbes.
        </p>
      )}
      {!full || !time.length ? (
        <div className="lab-scope-empty">
          <Activity size={34} />
          <h4>Observe ce qui se passe dans le temps.</h4>
          <p>
            Choisis une analyse TRAN et lance le calcul. L’expérience RC permet
            d’observer la charge d’un condensateur.
          </p>
        </div>
      ) : (
        <>
          <div
            className="lab-scope-curves"
            role="group"
            aria-label="Courbes affichées"
          >
            {curves.map((curve, index) => (
              <button
                key={curve.id}
                aria-pressed={visible.includes(curve.id)}
                onClick={() =>
                  setVisible((current) =>
                    current.includes(curve.id)
                      ? current.filter((id) => id !== curve.id)
                      : [...current, curve.id],
                  )
                }
                style={
                  {
                    "--scope-curve": colors[index % colors.length],
                  } as React.CSSProperties
                }
              >
                <i />
                {curve.label}
                <small>{curve.unit}</small>
              </button>
            ))}
          </div>
          <div className="lab-scope-controls">
            <span>
              <MoveHorizontal size={14} /> Survole pour mesurer · ← → pour
              affiner · Maj : 10 points
            </span>
            <div role="group" aria-label="Zoom temporel">
              <button
                aria-label="Agrandir autour du curseur"
                title="Agrandir autour du curseur"
                disabled={
                  windowSamples.length < 4 || !range || range.end <= range.start
                }
                onClick={() => zoom(0.5)}
              >
                <ZoomIn size={15} />
              </button>
              <button
                aria-label="Réduire le zoom temporel"
                title="Réduire le zoom temporel"
                disabled={!zoomed}
                onClick={() => zoom(2)}
              >
                <ZoomOut size={15} />
              </button>
              <button onClick={() => setWindowRange(null)} disabled={!zoomed}>
                <RotateCcw size={13} /> Tout voir
              </button>
            </div>
          </div>
          {!selected.length && (
            <div className="lab-scope-empty compact">
              <p>Sélectionne au moins une courbe pour l’afficher.</p>
            </div>
          )}
          {range &&
            plots.map(({ unit, plotted, bounds, paths }) => {
              const x = (value: number) =>
                left + plotFraction(value, range.start, range.end) * chartWidth;
              const y = (value: number) =>
                top +
                (1 - plotFraction(value, bounds.min, bounds.max)) * chartHeight;
              return (
                <div className="lab-scope-chart" key={unit}>
                  <span className="lab-scope-unit">
                    {unit === "V"
                      ? "TENSIONS"
                      : unit === "A"
                        ? "COURANTS"
                        : unit}
                  </span>
                  <svg
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="slider"
                    tabIndex={0}
                    aria-label={`Curseur de l’oscilloscope, ${unit === "V" ? "tensions" : "courants"}`}
                    aria-valuemin={
                      controlled ? (full?.start ?? range.start) : range.start
                    }
                    aria-valuemax={
                      controlled ? (full?.end ?? range.end) : range.end
                    }
                    aria-valuenow={sampleTime ?? range.start}
                    aria-valuetext={`Temps ${format(sampleTime, "s")}. ${plotted.map((curve) => `${curve.label} ${format(curve.values[cursor], unit)}`).join(". ")}`}
                    onPointerDown={(event) => {
                      event.currentTarget.focus();
                      setCursorFromPointer(event);
                    }}
                    onPointerMove={setCursorFromPointer}
                    onKeyDown={moveCursor}
                  >
                    <title>
                      Flèches gauche et droite : échantillon précédent et
                      suivant. Début et Fin : limites de la fenêtre.
                    </title>
                    {Array.from({ length: 5 }, (_, index) => (
                      <g key={`y${index}`}>
                        <line
                          x1={left}
                          x2={width - right}
                          y1={top + (chartHeight * index) / 4}
                          y2={top + (chartHeight * index) / 4}
                          className="lab-scope-grid"
                        />
                        <text
                          x={left - 10}
                          y={top + (chartHeight * index) / 4 + 4}
                          textAnchor="end"
                          className="lab-scope-axis"
                        >
                          {format(
                            bounds.max * (1 - index / 4) +
                              bounds.min * (index / 4),
                            unit,
                          )}
                        </text>
                      </g>
                    ))}
                    {Array.from({ length: 6 }, (_, index) => (
                      <g key={`x${index}`}>
                        <line
                          x1={left + (chartWidth * index) / 5}
                          x2={left + (chartWidth * index) / 5}
                          y1={top}
                          y2={height - bottom}
                          className="lab-scope-grid"
                        />
                        <text
                          x={left + (chartWidth * index) / 5}
                          y={height - 15}
                          textAnchor="middle"
                          className="lab-scope-axis"
                        >
                          {format(
                            range.start * (1 - index / 5) +
                              range.end * (index / 5),
                            "s",
                          )}
                        </text>
                      </g>
                    ))}
                    {plotted.map((curve) => {
                      const color =
                        colors[curves.indexOf(curve) % colors.length];
                      return (
                        <g key={curve.id}>
                          <path
                            d={paths.get(curve.id)}
                            fill="none"
                            stroke={color}
                            strokeWidth="1.8"
                            vectorEffect="non-scaling-stroke"
                          />
                          {cursorInView &&
                            Number.isFinite(curve.values[cursor]) && (
                              <circle
                                cx={x(time[cursor])}
                                cy={y(curve.values[cursor])}
                                r="4"
                                fill={color}
                                stroke="#101a19"
                                strokeWidth="2"
                              />
                            )}
                        </g>
                      );
                    })}
                    {cursorInView && sampleTime !== undefined && (
                      <line
                        x1={x(sampleTime)}
                        x2={x(sampleTime)}
                        y1={top}
                        y2={height - bottom}
                        className="lab-scope-cursor"
                      />
                    )}
                  </svg>
                </div>
              );
            })}
          {selected.length > 0 && (
            <div className="lab-scope-readout" aria-label="Valeurs au curseur">
              <div>
                <span>TEMPS</span>
                <strong>{format(sampleTime, "s")}</strong>
                <small>
                  Échantillon {cursor >= 0 ? cursor + 1 : "—"} / {time.length}
                  {!cursorInView && controlled ? " · hors fenêtre zoomée" : ""}
                </small>
              </div>
              {selected.map((curve, index) => (
                <div
                  key={curve.id}
                  style={
                    {
                      "--scope-curve":
                        colors[curves.indexOf(curve) % colors.length],
                    } as React.CSSProperties
                  }
                >
                  <span>
                    <i />
                    {curve.label}
                  </span>
                  <strong>{format(curve.values[cursor], curve.unit)}</strong>
                  <small>
                    {curve.unit === "V" ? "Tension" : "Courant"} calculé
                    {curve.unit === "V" ? "e" : ""}
                  </small>
                </div>
              ))}
            </div>
          )}
          {measuredCurve && measurements && (
            <div
              className="lab-scope-measurements"
              aria-label="Mesures sur la fenêtre temporelle"
            >
              <div className="lab-scope-measurement-heading">
                <div>
                  <h4>Mesurer la fenêtre visible</h4>
                  <p>
                    {measurements.sampleCount} échantillons ·{" "}
                    {format(measurements.start ?? undefined, "s")} →{" "}
                    {format(measurements.end ?? undefined, "s")}
                    {stale ? " · mesures précédentes" : ""}
                  </p>
                </div>
                <label>
                  Courbe mesurée
                  <select
                    aria-label="Courbe pour les mesures de fenêtre"
                    value={measuredCurve.id}
                    onChange={(event) => setMeasuredId(event.target.value)}
                  >
                    {selected.map((curve) => (
                      <option key={curve.id} value={curve.id}>
                        {curve.label} [{curve.unit}]
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <dl className="lab-scope-measurement-values">
                {(
                  [
                    ["Minimum", measurements.min],
                    ["Maximum", measurements.max],
                    ["Crête à crête", measurements.peakToPeak],
                    ["Moyenne", measurements.mean],
                    ["Efficace (RMS)", measurements.rms],
                  ] as const
                ).map(([label, value]) => {
                  const amplitude = Math.max(
                    Math.abs(measurements.min ?? 0),
                    Math.abs(measurements.max ?? 0),
                  );
                  // Supprimer uniquement le résidu d'arrondi d'une moyenne nulle.
                  // Les échantillons et les intégrales gardent leur précision d'origine.
                  const displayed =
                    label === "Moyenne" &&
                    value !== null &&
                    amplitude > 0 &&
                    Math.abs(value) / amplitude < 8 * Number.EPSILON
                      ? 0
                      : value;
                  return (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {format(displayed ?? undefined, measuredCurve.unit)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="lab-scope-measurement-method">
                Moyenne et valeur efficace estimées par intégration linéaire des
                échantillons, pondérée par leur durée.
                {measurements.missingCount
                  ? ` ${measurements.missingCount} mesure${measurements.missingCount > 1 ? "s" : ""} indisponible${measurements.missingCount > 1 ? "s" : ""} ; moyenne et RMS indisponibles.`
                  : measurements.mean === null || measurements.rms === null
                    ? " L’intégration exige au moins deux échantillons consécutifs valides et des temps croissants."
                    : ""}
              </p>
            </div>
          )}
          <p className="lab-scope-caption">
            Le curseur lit les échantillons réellement calculés, sans
            interpolation. Les tensions et courants utilisent des échelles
            distinctes.
          </p>
        </>
      )}
      <p className="lab-scope-export-notice" role="status">
        {exportNotice}
      </p>
    </section>
  );
}
