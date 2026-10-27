import { useEffect, useState } from "react";
import { ArrowRight, Download, Play, ScanLine } from "lucide-react";
import { format } from "../types";
import type { State } from "../types";
import { parseEngineeringValue } from "../units";
import { sweepCsv, sweepValues } from "../sweep";
import type { SweepReport, SweepRequest } from "../sweep";
import "../sweep.css";

const statusText = (status: string) =>
  ({
    success: "Calcul réussi",
    partial: "Certains points ont échoué",
    cancelled: "Balayage arrêté",
    timeout: "Durée limite atteinte",
    error: "Calcul impossible",
  })[status] || status;
const known = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function ParameterSweep({
  state,
  busy,
  onRun,
  report,
  stale,
}: {
  state: State;
  busy: boolean;
  onRun: (request: SweepRequest) => Promise<SweepReport | null>;
  report: SweepReport | null;
  stale: boolean;
}) {
  const eligible = state.project.components.filter(
    (c) =>
      ["resistor", "potentiometer", "voltage_source"].includes(c.kind) &&
      !c.waveform,
  );
  const [componentId, setComponentId] = useState("");
  const component = eligible.find((c) => c.id === componentId);
  const [start, setStart] = useState("1000");
  const [stop, setStop] = useState("4000");
  const [count, setCount] = useState(8);
  const [logarithmic, setLogarithmic] = useState(false);
  const [probeP, setProbeP] = useState("");
  const [probeN, setProbeN] = useState("0");
  const [mode, setMode] = useState<"current" | "voltage">("current");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(0);
  useEffect(() => {
    if (!component)
      setComponentId(
        eligible.find((c) => state.project.ui.selected.includes(c.id))?.id ||
          eligible.find((c) => c.kind === "resistor")?.id ||
          eligible[0]?.id ||
          "",
      );
  }, [state.project.id, component?.id, eligible.map((c) => c.id).join(";")]);
  useEffect(() => {
    if (!component) return;
    const pot = component.kind === "potentiometer";
    setStart(
      pot
        ? "0"
        : component.kind === "voltage_source"
          ? "0"
          : String(component.value / 2),
    );
    setStop(
      pot
        ? "100"
        : String(
            component.value * (component.kind === "voltage_source" ? 1 : 2),
          ),
    );
    setProbeP(component.pins.w || Object.values(component.pins)[0]);
    setProbeN("0");
    setLogarithmic(false);
    setError("");
    setMode(component.kind === "resistor" ? "current" : "voltage");
  }, [component?.id]);
  useEffect(() => setFocused(0), [report]);
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!component || busy) return;
    const unit =
      component.kind === "potentiometer"
        ? ""
        : component.kind === "resistor"
          ? "Ω"
          : "V";
    const from = parseEngineeringValue(start, unit),
      to = parseEngineeringValue(stop, unit);
    const factor = component.kind === "potentiometer" ? 0.01 : 1;
    const values =
      from === null || to === null
        ? null
        : sweepValues(from * factor, to * factor, count, logarithmic);
    if (!values) {
      setError(
        "Choisis deux valeurs distinctes et finies. L’échelle logarithmique demande des valeurs positives.",
      );
      return;
    }
    if (
      component.kind === "potentiometer" &&
      values.some((value) => value < 0 || value > 1)
    ) {
      setError("Le curseur doit rester entre 0 et 100 %.");
      return;
    }
    if (!probeP || !probeN) {
      setError("Choisis les deux points de mesure.");
      return;
    }
    setError("");
    await onRun({
      component_id: component.id,
      values,
      probe: { p: probeP, n: probeN },
    });
  };
  const exportReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob(["\ufeff", sweepCsv(report)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `balayage-${report.parameter.component_id}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const parameterLabel = (value: number) =>
    report?.parameter.field === "position"
      ? `${Number((value * 100).toPrecision(4))} %`
      : format(value, report?.parameter.unit || "");
  const rows = report?.rows || [];
  const measured = rows.filter(
    (row) => row.status === "success" && known(row[mode]),
  );
  const xMin = measured.length
      ? Math.min(...measured.map((row) => row.value))
      : 0,
    xMax = measured.length ? Math.max(...measured.map((row) => row.value)) : 1;
  const yMin = measured.length
      ? Math.min(0, ...measured.map((row) => row[mode]!))
      : 0,
    yMax = measured.length
      ? Math.max(0, ...measured.map((row) => row[mode]!))
      : 1;
  const x = (value: number) =>
    xMin === xMax ? 405 : 74 + ((value - xMin) / (xMax - xMin)) * 662;
  const y = (value: number) =>
    yMin === yMax ? 108 : 190 - ((value - yMin) / (yMax - yMin)) * 164;
  const paths: string[] = [];
  let active = "";
  rows.forEach((row) => {
    const value = row[mode];
    if (row.status !== "success" || !known(value)) {
      if (active) paths.push(active);
      active = "";
    } else active += `${active ? "L" : "M"}${x(row.value)},${y(value)}`;
  });
  if (active) paths.push(active);
  const unit = mode === "current" ? "A" : "V";
  const selected = rows[focused];
  return (
    <section className="parameter-sweep" aria-label="Balayage de paramètre">
      <div className="sweep-heading">
        <ScanLine size={24} />
        <div>
          <span>UN PARAMÈTRE · PLUSIEURS ESSAIS</span>
          <h3>Observe la tendance.</h3>
          <p>
            Le moteur recalcule chaque point sur une copie. Ton montage reste en
            place.
          </p>
        </div>
      </div>
      {!eligible.length ? (
        <p className="sweep-note">
          Ajoute une résistance, un potentiomètre ou une source continue pour
          explorer ses réglages.
        </p>
      ) : (
        <form className="sweep-form" onSubmit={run}>
          <label>
            Composant
            <select
              aria-label="Composant à balayer"
              value={componentId}
              disabled={busy}
              onChange={(event) => setComponentId(event.target.value)}
            >
              {eligible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.id} ·{" "}
                  {c.kind === "potentiometer"
                    ? "curseur"
                    : c.kind === "resistor"
                      ? "résistance"
                      : "tension continue"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Départ {component?.kind === "potentiometer" ? "(%)" : ""}
            <input
              aria-label="Valeur de départ du balayage"
              value={start}
              disabled={busy}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <ArrowRight className="sweep-range-arrow" size={16} />
          <label>
            Arrivée {component?.kind === "potentiometer" ? "(%)" : ""}
            <input
              aria-label="Valeur finale du balayage"
              value={stop}
              disabled={busy}
              onChange={(event) => setStop(event.target.value)}
            />
          </label>
          <label>
            Points
            <select
              aria-label="Nombre de points du balayage"
              value={count}
              disabled={busy}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {[2, 4, 8, 12, 16].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="sweep-log">
            <input
              type="checkbox"
              checked={logarithmic}
              disabled={busy}
              onChange={(event) => setLogarithmic(event.target.checked)}
            />
            Espacement logarithmique
          </label>
          <div className="sweep-probe">
            <span>Tension mesurée</span>
            <select
              aria-label="Point positif du balayage"
              value={probeP}
              disabled={busy}
              onChange={(event) => setProbeP(event.target.value)}
            >
              {Object.keys(state.topology.terminal_to_net).map((pin) => (
                <option key={pin}>{pin}</option>
              ))}
            </select>
            <span>−</span>
            <select
              aria-label="Point négatif du balayage"
              value={probeN}
              disabled={busy}
              onChange={(event) => setProbeN(event.target.value)}
            >
              <option value="0">Masse · 0 V</option>
              {Object.keys(state.topology.terminal_to_net).map((pin) => (
                <option key={pin}>{pin}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="run sweep-run"
            disabled={busy || !component}
          >
            {busy ? (
              "Calcul en cours…"
            ) : (
              <>
                <Play size={14} />
                Lancer les essais
              </>
            )}
          </button>
        </form>
      )}
      {error && (
        <p className="sweep-error" role="alert">
          {error}
        </p>
      )}
      <p className="sweep-method">
        OP uniquement · 2 à 16 calculs · 45 s au maximum · Courant entrant dans
        le composant choisi. Le bouton Arrêter le calcul interrompt la série.
      </p>
      {report && (
        <>
          <div className="sweep-report-heading">
            <div>
              <strong>
                {report.parameter.label} · {statusText(report.status)}
              </strong>
              <span>
                {report.converged}/{report.total} points convergés · révision{" "}
                {report.project_revision} · {report.elapsed_seconds} s
              </span>
            </div>
            <button className="outline" onClick={exportReport}>
              <Download size={14} />
              CSV
            </button>
          </div>
          {stale && (
            <p className="sweep-note">
              Résultat conservé : le circuit a changé depuis ces essais. Relance
              le balayage pour comparer le montage actuel.
            </p>
          )}
          <div
            className="sweep-plot-controls"
            role="group"
            aria-label="Grandeur tracée"
          >
            <button
              aria-pressed={mode === "current"}
              onClick={() => setMode("current")}
            >
              Courant du composant
            </button>
            <button
              aria-pressed={mode === "voltage"}
              onClick={() => setMode("voltage")}
            >
              Tension différentielle
            </button>
          </div>
          {measured.length > 0 && (
            <svg
              className="sweep-plot"
              viewBox="0 0 760 235"
              tabIndex={0}
              role="img"
              aria-label={`Balayage de ${report.parameter.label} : ${mode === "current" ? "courant" : "tension"}. Flèches pour explorer les échantillons.`}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                setFocused((index) =>
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? rows.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            rows.length - 1,
                            index + (event.key === "ArrowRight" ? 1 : -1),
                          ),
                        ),
                );
              }}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <g key={i}>
                  <line
                    x1="74"
                    x2="736"
                    y1={26 + i * 41}
                    y2={26 + i * 41}
                    className="sweep-grid"
                  />
                  <text
                    x="64"
                    y={30 + i * 41}
                    textAnchor="end"
                    className="sweep-axis"
                  >
                    {format(yMax - ((yMax - yMin) * i) / 4, unit)}
                  </text>
                  <text
                    x={74 + i * 165.5}
                    y="219"
                    textAnchor="middle"
                    className="sweep-axis"
                  >
                    {parameterLabel(xMin + ((xMax - xMin) * i) / 4)}
                  </text>
                </g>
              ))}
              {paths.map((path, index) => (
                <path key={index} d={path} fill="none" className="sweep-line" />
              ))}
              {measured.map((row) => (
                <circle
                  key={row.index}
                  cx={x(row.value)}
                  cy={y(row[mode]!)}
                  r={focused === row.index ? 5 : 3.5}
                  className={
                    focused === row.index ? "sweep-dot active" : "sweep-dot"
                  }
                  onPointerEnter={() => setFocused(row.index)}
                  onClick={() => setFocused(row.index)}
                >
                  <title>
                    {parameterLabel(row.value)} → {format(row[mode]!, unit)}
                  </title>
                </circle>
              ))}
            </svg>
          )}
          {selected && (
            <p className="sweep-readout" aria-live="polite">
              {parameterLabel(selected.value)}
              <ArrowRight size={13} />
              {selected.status === "success" ? (
                <>
                  <b>{format(selected.voltage ?? undefined, "V")}</b>
                  <span>·</span>
                  <b>{format(selected.current ?? undefined, "A")}</b>
                </>
              ) : (
                statusText(selected.status)
              )}
            </p>
          )}
          <div
            className="sweep-table-scroll"
            role="region"
            aria-label="Mesures du balayage"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Paramètre</th>
                  <th>Tension</th>
                  <th>Courant</th>
                  <th>Calcul</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.index}
                    className={focused === row.index ? "active" : ""}
                  >
                    <td>
                      <button onClick={() => setFocused(row.index)}>
                        {parameterLabel(row.value)}
                      </button>
                    </td>
                    <td>{format(row.voltage ?? undefined, "V")}</td>
                    <td>{format(row.current ?? undefined, "A")}</td>
                    <td
                      title={row.diagnostics.map((d) => d.message).join(" · ")}
                    >
                      {statusText(row.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sweep-method">
            Les points sont calculés ; les segments servent de guides visuels.
            Une mesure indisponible reste vide dans le CSV.
          </p>
        </>
      )}
    </section>
  );
}
