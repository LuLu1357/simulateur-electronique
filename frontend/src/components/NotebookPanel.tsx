import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  BookmarkPlus,
  FlaskConical,
  GitCompareArrows,
  Trash2,
} from "lucide-react";
import { format } from "../types";
import type { Project, Simulation, State } from "../types";
import {
  appendNotebookCapture,
  compareNotebookCaptures,
  createNotebookCapture,
  describeNotebookChanges,
  maxCaptures,
  notebookHasUnsavedCaptures,
  notebookHasIncompleteSampleProvenance,
  readNotebook,
  writeNotebook,
} from "../notebook";
import type { NotebookCapture, NotebookStorage } from "../notebook";
import "../notebook.css";

function storage(): NotebookStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function captureTime(capture: NotebookCapture): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(capture.capturedAt));
}
function captureLabel(capture: NotebookCapture): string {
  return `${captureTime(capture)} · rév. ${capture.revision} · ${capture.analysisLabel}${capture.note ? ` · ${capture.note.slice(0, 32)}` : ""}`;
}

export function NotebookPanel({
  project,
  simulation,
  stale,
  topology,
}: {
  project: Project;
  simulation: Simulation | null;
  stale: boolean;
  topology: State["topology"];
}) {
  const [captures, setCaptures] = useState<NotebookCapture[]>(() =>
    readNotebook(storage()),
  );
  const [note, setNote] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("current");
  const [persisted, setPersisted] = useState<boolean | null>(() =>
    notebookHasUnsavedCaptures(storage()) ? false : null,
  );
  const [feedback, setFeedback] = useState("");
  const current = useMemo(
    () => createNotebookCapture(project, simulation, topology, stale),
    [project, simulation, topology, stale],
  );
  const projectCaptures = captures.filter(
    (capture) => capture.projectId === project.id,
  );
  const baseline =
    projectCaptures.find((capture) => capture.id === baselineId) ||
    projectCaptures[0] ||
    null;
  const candidate =
    candidateId === "current"
      ? current
      : projectCaptures.find((capture) => capture.id === candidateId) || null;
  const comparison = compareNotebookCaptures(baseline, candidate);
  const { changes, incompleteProvenance } = comparison.comparable
    ? describeNotebookChanges(baseline, candidate)
    : { changes: [], incompleteProvenance: false };
  const fieldLabels = {
    value: "valeur",
    model: "modèle",
    position: "curseur",
    initial_voltage: "tension initiale",
    waveform: "signal",
  };
  const commit = (next: NotebookCapture[]) => {
    setCaptures(next);
    setPersisted(writeNotebook(storage(), next));
  };
  const capture = () => {
    const next = createNotebookCapture(
      project,
      simulation,
      topology,
      stale,
      note,
    );
    if (!next) return;
    commit(appendNotebookCapture(captures, next));
    if (!baseline) setBaselineId(next.id);
    setNote("");
    setFeedback(
      next.sampleTime === undefined
        ? "Mesures capturées. Modifie une valeur, recalcule et compare."
        : `Mesures capturées · ${next.analysisLabel}. Choisis le même instant pour comparer un autre essai.`,
    );
  };
  const exportCaptures = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { version: 1, project: project.title, captures: projectCaptures },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "carnet-de-labo.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="notebook-panel" aria-label="Carnet de labo">
      <div className="notebook-heading">
        <div className="notebook-heading-icon">
          <FlaskConical size={22} />
        </div>
        <div>
          <span className="notebook-kicker">
            OBSERVER · MODIFIER · COMPARER
          </span>
          <h3>Chaque essai raconte quelque chose.</h3>
          <p>
            Garde une mesure de référence, change une valeur et observe la
            différence.
          </p>
        </div>
        <button
          className="notebook-export"
          onClick={exportCaptures}
          disabled={!projectCaptures.length}
        >
          <ArrowDownToLine size={15} />
          Exporter
        </button>
      </div>
      <div className="notebook-capture-form">
        <label htmlFor="notebook-note">
          Note de l’expérience <span>facultative</span>
        </label>
        <div>
          <input
            id="notebook-note"
            value={note}
            maxLength={280}
            placeholder="Ex. : R1 passe de 1 kΩ à 2 kΩ…"
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            className="notebook-capture"
            onClick={capture}
            disabled={!current}
            title={
              stale
                ? "Recalcule le circuit avant de capturer ses mesures"
                : !current
                  ? "Lance un calcul réussi pour capturer ses mesures"
                  : "Conserver les tensions et courants calculés"
            }
          >
            <BookmarkPlus size={16} />
            Capturer les mesures
          </button>
        </div>
      </div>
      {current && (
        <p
          className="notebook-table-note"
          aria-label="Mesures prêtes à capturer"
        >
          Mesures affichées prêtes à capturer · {current.analysisLabel}
        </p>
      )}
      <p className="notebook-storage-note">
        {persisted === false
          ? "Stockage du navigateur indisponible : tes captures restent dans cette session. Exporte-les pour les conserver."
          : `Conservé dans ce navigateur · ${captures.length}/${maxCaptures} captures · les plus anciennes sont remplacées.`}
      </p>
      <p className="notebook-feedback" role="status">
        {feedback}
      </p>
      {!projectCaptures.length ? (
        <div className="notebook-empty">
          <GitCompareArrows size={26} />
          <strong>Ton premier point de comparaison.</strong>
          <p>
            Lance un calcul, capture les mesures, puis change un composant. Le
            carnet montrera ce qui a changé.
          </p>
        </div>
      ) : (
        <>
          <div className="notebook-comparison-heading">
            <GitCompareArrows size={16} />
            <h4>Comparer les essais</h4>
            <span>
              {projectCaptures.length} capture
              {projectCaptures.length > 1 ? "s" : ""} pour ce projet
            </span>
          </div>
          <div className="notebook-selectors">
            <label>
              Référence
              <select
                aria-label="Capture de référence"
                value={baseline?.id || ""}
                onChange={(event) => setBaselineId(event.target.value)}
              >
                {projectCaptures.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {captureLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            <span aria-hidden="true">→</span>
            <label>
              Comparer avec
              <select
                aria-label="Mesures à comparer"
                value={candidateId}
                onChange={(event) => setCandidateId(event.target.value)}
              >
                <option value="current">
                  {stale
                    ? "Mesures actuelles · recalcul nécessaire"
                    : `Mesures actuelles${current ? ` · ${current.analysisLabel}` : ""}`}
                </option>
                {projectCaptures.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {captureLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {comparison.comparable ? (
            <>
              <div className="notebook-comparison-meta">
                <span>{candidate?.analysisLabel}</span>
                <span>
                  {changes.length
                    ? `${changes.length} composant${changes.length > 1 ? "s" : ""} modifié${changes.length > 1 ? "s" : ""} · ${changes.map((change) => `${project.components.find((component) => component.id === change.id)?.label || change.id} (${change.fields.map((field) => fieldLabels[field]).join(", ")})`).join(" · ")}`
                    : incompleteProvenance
                      ? "Provenance ancienne partielle"
                      : "Réglages des composants identiques"}
                </span>
              </div>
              {incompleteProvenance && (
                <p className="notebook-table-note">
                  Une ancienne capture ne conserve pas tous les modèles,
                  signaux, réglages ou détails de l’échantillon. Les écarts
                  restent comparables selon l’analyse enregistrée ; leur
                  provenance est partielle.
                </p>
              )}
              <div
                className="notebook-table-scroll"
                role="region"
                aria-label="Écarts entre les mesures"
                tabIndex={0}
              >
                <table className="notebook-table">
                  <thead>
                    <tr>
                      <th scope="col">Mesure</th>
                      <th scope="col">Référence</th>
                      <th scope="col">
                        {candidateId === "current" ? "Actuel" : "Essai"}
                      </th>
                      <th scope="col">Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row" title={row.label}>
                          {row.unit === "A" ? "I · " : "U · "}
                          {row.label}
                        </th>
                        <td>{format(row.baseline, row.unit)}</td>
                        <td>{format(row.value, row.unit)}</td>
                        <td
                          className={
                            Math.abs(row.delta) > 1e-12 ? "notebook-delta" : ""
                          }
                        >
                          {row.delta > 0 ? "+" : ""}
                          {format(row.delta, row.unit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="notebook-table-note">
                Écart = essai − référence. Les courants conservent leur signe
                conventionnel.
              </p>
            </>
          ) : (
            <p className="notebook-comparison-notice">
              {candidateId === "current" && !current
                ? stale
                  ? "Le circuit a changé : recalcule pour comparer les nouvelles mesures."
                  : "Lance un calcul réussi pour comparer les mesures actuelles."
                : comparison.reason}
            </p>
          )}
          <div className="notebook-history" aria-label="Captures enregistrées">
            {projectCaptures.map((entry, index) => (
              <article className="notebook-entry" key={entry.id}>
                <span className="notebook-entry-number">
                  {String(projectCaptures.length - index).padStart(2, "0")}
                </span>
                <div>
                  <strong>{entry.note || "Mesures sans note"}</strong>
                  <span>
                    {captureTime(entry)} · rév. {entry.revision} ·{" "}
                    {entry.analysisLabel}
                  </span>
                  {notebookHasIncompleteSampleProvenance(entry) && (
                    <span>Provenance temporelle ancienne partielle.</span>
                  )}
                </div>
                <button
                  aria-label={`Supprimer la capture ${captureLabel(entry)}`}
                  title="Supprimer cette capture"
                  onClick={() => {
                    commit(captures.filter((item) => item.id !== entry.id));
                    if (candidateId === entry.id) setCandidateId("current");
                    setFeedback("Capture supprimée.");
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
