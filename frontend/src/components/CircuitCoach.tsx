import { useMemo } from "react";
import {
  Check,
  ChevronRight,
  CircleHelp,
  Lightbulb,
  Play,
  ScanSearch,
} from "lucide-react";
import type { State } from "../types";
import { format } from "../types";
import { summarizeCircuit } from "../coach";
import "../coach.css";

export function CircuitCoach({
  state,
  stale,
  busy,
  onSelect,
  onRun,
  onOpenExperiments,
  onOpenLibrary,
}: {
  state: State;
  stale: boolean;
  busy: boolean;
  onSelect: (ids: string[]) => void;
  onRun: () => void;
  onOpenExperiments: () => void;
  onOpenLibrary?: () => void;
}) {
  const summary = useMemo(
    () => summarizeCircuit(state, stale, busy),
    [state, stale, busy],
  );
  const blocking = summary.issues.filter(
    (issue) => issue.severity === "error" && issue.category === "connection",
  ).length;
  const nextAction = () => {
    if (summary.next.kind === "examples") onOpenExperiments();
    else if (summary.next.kind === "library") onOpenLibrary?.();
    else if (summary.next.kind === "select") onSelect(summary.next.selectIds);
    else if (summary.next.kind === "run") onRun();
  };
  const observation =
    summary.observations.find((entry) =>
      state.project.ui.selected.includes(entry.id),
    ) || summary.observations[0];
  return (
    <details
      className="circuit-coach"
      open={blocking > 0 || !state.project.components.length ? true : undefined}
    >
      <summary>
        <span className="coach-title">
          <Lightbulb size={16} />
          <strong>Assistant de montage</strong>
        </span>
        <span
          className={`coach-status ${blocking ? "coach-status-attention" : ""}`}
        >
          {blocking
            ? `${blocking} connexion${blocking > 1 ? "s" : ""} à vérifier`
            : summary.hasCurrentMeasurements
              ? "Mesures disponibles"
              : busy
                ? "Calcul en cours"
                : "Vérifier le montage"}
        </span>
        <ChevronRight className="coach-disclosure" size={15} />
      </summary>
      <div className="coach-content">
        <ol
          className="coach-checks"
          aria-label="Repères pour un premier circuit"
        >
          {summary.checks.map((check, index) => (
            <li
              key={check.id}
              className={check.complete ? "coach-check-complete" : ""}
            >
              <span className="coach-check-icon" aria-hidden="true">
                {check.complete ? <Check size={12} /> : index + 1}
              </span>
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="coach-next">
          <span>{summary.next.message}</span>
          {summary.next.kind !== "none" &&
            (summary.next.kind !== "library" || onOpenLibrary) && (
              <button
                disabled={busy && summary.next.kind === "run"}
                onClick={nextAction}
              >
                {summary.next.kind === "run" ? (
                  <Play size={13} />
                ) : summary.next.kind === "select" ? (
                  <ScanSearch size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                {summary.next.label}
              </button>
            )}
        </div>
        {summary.issues.length > 0 && (
          <div className="coach-issues">
            {summary.issues.slice(0, 4).map((issue, index) => (
              <div
                className={`coach-issue coach-issue-${issue.severity}`}
                key={`${issue.code}-${index}`}
              >
                <CircleHelp size={14} />
                <div>
                  <span>
                    {issue.category === "hypothesis"
                      ? "Hypothèse à tester"
                      : issue.category === "solver"
                        ? "Dernier calcul"
                        : issue.category === "connection"
                          ? "Connexion observée"
                          : "Observation"}
                  </span>
                  <p>{issue.message}</p>
                  {issue.explanation && <small>{issue.explanation}</small>}
                </div>
                {issue.selectIds.length > 0 && (
                  <button
                    onClick={() => onSelect(issue.selectIds)}
                    aria-label={`Repérer : ${issue.message}`}
                    title="Sélectionner les composants concernés"
                  >
                    <ScanSearch size={15} />
                  </button>
                )}
              </div>
            ))}
            {summary.issues.length > 4 && (
              <p className="coach-more">
                {summary.issues.length - 4} autre
                {summary.issues.length - 4 > 1 ? "s" : ""} observation
                {summary.issues.length - 4 > 1 ? "s" : ""} dans les diagnostics.
              </p>
            )}
          </div>
        )}
        {observation && (
          <div className="coach-observation">
            <span>COMPRENDRE {observation.label}</span>
            <p>
              <b>U</b> = {format(observation.voltage, "V")}
              <i>·</i>
              <b>I</b> = {format(observation.current, "A")}
              <i>·</i>
              <b>P = U × I</b> = {format(observation.power, "W")}
            </p>
            <small>
              Valeurs du calcul réussi. La puissance d’une résistance se dissipe
              sous forme de chaleur ; compare-la à sa puissance nominale sur la
              fiche réelle.
            </small>
          </div>
        )}
        <p className="coach-footnote">
          Ces repères décrivent le modèle et ses connexions. Ils ne valident pas
          un montage physique.
        </p>
      </div>
    </details>
  );
}
