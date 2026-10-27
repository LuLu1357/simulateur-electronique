import { useEffect, useRef, useState } from "react";
import {
  CircuitBoard,
  Download,
  FolderOpen,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import type { State } from "../types";
import "../projectLibrary.css";

type SavedProject = {
  id: string;
  project_id: string;
  title: string;
  revision: number;
  saved_at: string;
  component_count: number;
  wire_count: number;
};
type Library = { projects: SavedProject[]; capacity: number };

export function ProjectLibrary({
  open,
  onClose,
  currentTitle,
  onLoaded,
  getRevision,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  currentTitle: string;
  onLoaded: (state: State) => void;
  getRevision: () => number | null | Promise<number | null>;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    setError("");
    setNotice("");
    setConfirmDelete("");
    setLibrary(null);
    api<Library>("projects")
      .then((next) => {
        if (alive) setLibrary(next);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
      dialog.current?.close();
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  const operate = async (action: "save" | "load" | "delete", id = "") => {
    if (locked.current || busy) return;
    locked.current = true;
    setPending(`${action}:${id}`);
    setError("");
    setNotice("");
    try {
      const revision = await getRevision();
      if (revision === null)
        throw new Error("Le circuit n’est pas encore disponible.");
      if (action === "load") {
        const next = await api<State>("projects/load", {
          id,
          expected_revision: revision,
        });
        onLoaded(next);
        onClose();
      } else {
        const next = await api<Library>(
          `projects/${action}`,
          action === "save" ? { expected_revision: revision } : { id },
        );
        setLibrary(next);
        setConfirmDelete("");
        setNotice(
          action === "save"
            ? "Une copie du circuit est enregistrée. Tu peux continuer à modifier l’original."
            : "Copie supprimée. Le circuit ouvert est conservé.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      setPending("");
    }
  };
  const exportCopy = async (entry: SavedProject) => {
    if (locked.current) return;
    locked.current = true;
    setPending(`export:${entry.id}`);
    setError("");
    try {
      const project = await api<unknown>(`projects/export/${entry.id}`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(project, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${entry.title.replace(/[^\p{L}\d-]/gu, "_")}.atelier.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Copie exportée sans modifier le circuit ouvert.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      setPending("");
    }
  };
  const close = () => {
    if (!locked.current) onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="project-library"
      aria-labelledby="project-library-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="project-library-inner">
        <div className="project-library-heading">
          <span className="project-library-icon">
            <FolderOpen size={24} />
          </span>
          <div>
            <span className="project-library-kicker">
              CONSERVER · RETROUVER · EXPLORER
            </span>
            <h2 id="project-library-title">
              Mes circuits<span>.</span>
            </h2>
          </div>
          <button
            aria-label="Fermer mes circuits"
            disabled={!!pending}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <p className="project-library-intro">
          Des copies indépendantes pour garder une idée et reprendre un montage.
          Recalcule les mesures après l’ouverture.
        </p>
        <div className="project-library-save">
          <div>
            <span>CIRCUIT OUVERT</span>
            <strong>{currentTitle}</strong>
          </div>
          <button
            className="run"
            disabled={
              busy ||
              !!pending ||
              !library ||
              library.projects.length >= library.capacity
            }
            onClick={() => void operate("save")}
          >
            <Plus size={15} />
            {pending === "save:" ? "Enregistrement…" : "Conserver une copie"}
          </button>
        </div>
        <div className="project-library-counter">
          <span>
            {library
              ? `${library.projects.length} / ${library.capacity} copies`
              : "Chargement des circuits…"}
          </span>
          <span>Enregistrées avec le projet</span>
        </div>
        {error && (
          <p className="project-library-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="project-library-notice" role="status">
            {notice}
          </p>
        )}
        {library && library.projects.length >= library.capacity && (
          <p className="project-library-notice">
            La bibliothèque est pleine. Exporte les circuits à conserver avant
            de supprimer une copie.
          </p>
        )}
        {!library && !error && (
          <div className="project-library-empty" role="status">
            <LoaderCircle size={23} />
            Lecture de la bibliothèque…
          </div>
        )}
        {library && !library.projects.length && (
          <div className="project-library-empty">
            <CircuitBoard size={34} />
            <strong>Une place pour tes prochaines idées.</strong>
            <p>
              Conserve une copie du circuit ouvert pour commencer ta collection.
            </p>
          </div>
        )}
        <div className="project-library-list">
          {library?.projects.map((entry) => (
            <article key={entry.id} className="project-library-entry">
              <span className="project-library-entry-icon">
                <CircuitBoard size={23} />
              </span>
              <div>
                <h3>{entry.title}</h3>
                <p>
                  {entry.component_count} composants · {entry.wire_count} fils ·
                  révision {entry.revision}
                </p>
                <time dateTime={entry.saved_at}>
                  {new Intl.DateTimeFormat("fr-FR", {
                    timeZone: "Europe/Paris",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(entry.saved_at))}
                </time>
              </div>
              <div className="project-library-entry-actions">
                {confirmDelete === entry.id ? (
                  <>
                    <span>Supprimer cette copie ?</span>
                    <button
                      className="project-library-confirm"
                      disabled={!!pending || busy}
                      onClick={() => void operate("delete", entry.id)}
                    >
                      Supprimer
                    </button>
                    <button
                      disabled={!!pending}
                      onClick={() => setConfirmDelete("")}
                    >
                      Garder
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="outline"
                      disabled={busy || !!pending}
                      onClick={() => void operate("load", entry.id)}
                    >
                      {pending === `load:${entry.id}` ? "Ouverture…" : "Ouvrir"}
                    </button>
                    <button
                      aria-label={`Exporter la copie ${entry.title}`}
                      title="Exporter cette copie"
                      disabled={!!pending}
                      onClick={() => void exportCopy(entry)}
                    >
                      <Download size={15} />
                    </button>
                    <button
                      aria-label={`Supprimer la copie ${entry.title}`}
                      title="Supprimer cette copie"
                      disabled={busy || !!pending}
                      onClick={() => setConfirmDelete(entry.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
        <p className="project-library-footnote">
          L’ouverture remplace le circuit actif et reste annulable. Les copies
          sont stockées dans l’environnement qui exécute l’atelier ; Exporter
          permet d’en garder un fichier sur ton appareil.
        </p>
      </div>
    </dialog>
  );
}
