import { useEffect, useMemo, useState } from "react";
import { Download, Zap } from "lucide-react";
import { circuitEnergy, energyCsv, nearestEnergySample } from "../energy";
import type { State } from "../types";
import { format } from "../types";
import "../energy.css";

const energyLabel = (value: number | null) =>
  value === null ? "Indisponible" : format(value, "J");

export function EnergyPanel({
  state,
  busy,
  cursorIndex,
  onCursorChange,
}: {
  state: State;
  busy: boolean;
  cursorIndex?: number;
  onCursorChange?: (index: number) => void;
}) {
  const report = useMemo(() => circuitEnergy(state, busy), [state, busy]);
  const [localCursor, setLocalCursor] = useState(0);
  const ready = report.status === "ready" ? report : null;
  const controlled = cursorIndex !== undefined;
  useEffect(() => {
    if (!controlled) setLocalCursor(ready ? ready.total.length - 1 : 0);
  }, [ready?.key, controlled]);
  const cursor = controlled ? cursorIndex : localCursor;
  const index = ready
    ? Number.isFinite(cursor)
      ? Math.max(0, Math.min(Math.trunc(cursor), ready.total.length - 1))
      : ready.total.length - 1
    : 0;
  const selectCursor = (next: number) => {
    if (!ready || !Number.isFinite(next)) return;
    const clamped = Math.max(
      0,
      Math.min(Math.trunc(next), ready.total.length - 1),
    );
    if (controlled) onCursorChange?.(clamped);
    else setLocalCursor(clamped);
  };
  const chart = useMemo(() => {
    if (!ready || ready.time.length < 2) return null;
    let maximum = 0;
    for (const values of [ready.capacitive, ready.magnetic, ready.total])
      for (const value of values)
        if (value !== null && value > maximum) maximum = value;
    const limit = maximum || 1;
    const first = ready.time[0],
      span = ready.time.at(-1)! - first;
    const x = (i: number) => 12 + 836 * ((ready.time[i] - first) / span);
    const path = (values: (number | null)[]) => {
      let pen = false;
      return values
        .map((value, i) => {
          if (value === null) {
            pen = false;
            return "";
          }
          const command = `${pen ? "L" : "M"}${x(i).toFixed(2)},${(152 - 140 * (value / limit)).toFixed(2)}`;
          pen = true;
          return command;
        })
        .join(" ");
    };
    return {
      maximum,
      x,
      paths: [path(ready.capacitive), path(ready.magnetic), path(ready.total)],
    };
  }, [ready]);
  const download = () => {
    if (!ready) return;
    const url = URL.createObjectURL(
      new Blob([energyCsv(ready)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.project.id}_r${ready.revision}.energy.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="energy-panel"
      aria-label="Énergie stockée dans le circuit"
    >
      <div className="energy-heading">
        <div>
          <h3>
            <Zap size={17} /> L’énergie change de forme
          </h3>
          <p>Condensateur : ½ C U² · Inductance : ½ L I²</p>
        </div>
        <button disabled={!ready} onClick={download}>
          <Download size={13} /> CSV
        </button>
      </div>
      {report.status !== "ready" ? (
        <p className="energy-empty" role="status">
          {report.message}
        </p>
      ) : (
        <>
          <div className="energy-totals" aria-live="polite" aria-atomic="true">
            <div>
              <span className="energy-cap">Condensateurs</span>
              <strong>{energyLabel(report.capacitive[index])}</strong>
            </div>
            <div>
              <span className="energy-ind">Inductances</span>
              <strong>{energyLabel(report.magnetic[index])}</strong>
            </div>
            <div>
              <span>Total stocké</span>
              <strong>{energyLabel(report.total[index])}</strong>
            </div>
          </div>
          {chart && (
            <>
              <div className="energy-chart">
                <span>{format(chart.maximum, "J")}</span>
                <svg
                  viewBox="0 0 860 174"
                  role="img"
                  aria-label="Énergies électrique, magnétique et totale en fonction du temps. Le curseur ci-dessous parcourt les échantillons."
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.isPrimary === false) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (!bounds.width) return;
                    const ratio = Math.max(
                      0,
                      Math.min(
                        1,
                        (((event.clientX - bounds.left) / bounds.width) * 860 -
                          12) /
                          836,
                      ),
                    );
                    selectCursor(
                      nearestEnergySample(
                        report.time,
                        report.time[0] +
                          ratio * (report.time.at(-1)! - report.time[0]),
                      ),
                    );
                  }}
                >
                  {[12, 82, 152].map((y) => (
                    <line
                      key={y}
                      x1="12"
                      x2="848"
                      y1={y}
                      y2={y}
                      className="energy-grid"
                    />
                  ))}
                  {chart.paths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      className={
                        [
                          "energy-curve-cap",
                          "energy-curve-ind",
                          "energy-curve-total",
                        ][i]
                      }
                    />
                  ))}
                  <line
                    x1={chart.x(index)}
                    x2={chart.x(index)}
                    y1="6"
                    y2="156"
                    className="energy-cursor"
                  />
                </svg>
                <div className="energy-time-ends">
                  <span>{format(report.time[0], "s")}</span>
                  <span>{format(report.time.at(-1), "s")}</span>
                </div>
              </div>
              <label className="energy-sample-control">
                Échantillon {index + 1} / {report.time.length} · t ={" "}
                {format(report.time[index], "s")}
                <input
                  type="range"
                  min={0}
                  max={report.time.length - 1}
                  step={1}
                  value={index}
                  onChange={(event) => selectCursor(Number(event.target.value))}
                  aria-label="Curseur temporel de l’énergie"
                  aria-valuetext={`Échantillon ${index + 1} sur ${report.time.length}, temps ${format(report.time[index], "s")}`}
                />
              </label>
            </>
          )}
          <div className="energy-table-scroll">
            <table>
              <caption>
                {report.time.length
                  ? "Énergie au curseur temporel"
                  : "Énergie à l’état stabilisé"}{" "}
                · calcul révision {report.revision}
              </caption>
              <thead>
                <tr>
                  <th>Élément</th>
                  <th>Stockage</th>
                  <th>Énergie</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.id}
                      {row.label !== row.id ? ` · ${row.label}` : ""}
                    </td>
                    <td>
                      {row.kind === "capacitor" ? "Électrique" : "Magnétique"}
                    </td>
                    <td>{energyLabel(row.values[index])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="energy-explanation">
            Les courbes suivent l’énergie des condensateurs et inductances
            idéaux du montage. Les résistances dissipent de l’énergie ; la
            source peut en fournir ou en récupérer. Une mesure manquante reste
            indisponible.
          </p>
        </>
      )}
    </section>
  );
}
