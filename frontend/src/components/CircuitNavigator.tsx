import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircuitBoard,
  GitBranch,
  Link2,
  ScanSearch,
  Search,
  X,
} from "lucide-react";
import type { State } from "../types";
import {
  buildCircuitSearchIndex,
  searchCircuitTargets,
} from "../circuitSearch";
import type { CircuitSearchTarget } from "../circuitSearch";
import "../circuitNavigator.css";

const kindLabels = {
  component: "Composant",
  wire: "Fil",
  junction: "Jonction",
  net: "Réseau",
};
const kindIcons = {
  component: CircuitBoard,
  wire: Link2,
  junction: GitBranch,
  net: ScanSearch,
};

export function CircuitNavigator({
  open,
  state,
  onClose,
  onChoose,
}: {
  open: boolean;
  state: State;
  onClose: () => void;
  onChoose: (target: CircuitSearchTarget) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const choosing = useRef(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const index = useMemo(
    () => (open ? buildCircuitSearchIndex(state) : []),
    [open, state],
  );
  const found = useMemo(
    () => searchCircuitTargets(index, query, 61),
    [index, query],
  );
  const results = found.slice(0, 60);
  const resultSignature = results.map((item) => item.key).join("\u0000");
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeId = results.length ? `circuit-target-${activeIndex}` : undefined;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setError("");
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);
  useEffect(() => {
    setActive(0);
  }, [query, state.project.id]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`circuit-target-${activeIndex}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, resultSignature]);
  const choose = async (target: CircuitSearchTarget | undefined) => {
    if (!target || choosing.current) return;
    choosing.current = true;
    setBusy(true);
    setError("");
    try {
      await onChoose(target);
    } catch (cause) {
      setError(String(cause).replace(/^Error: /, ""));
    } finally {
      choosing.current = false;
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="circuit-navigator"
      aria-labelledby="circuit-navigator-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="circuit-navigator-content">
        <header>
          <div>
            <span>SE REPÉRER DANS LE MONTAGE</span>
            <h2 id="circuit-navigator-title">
              Chaque élément à portée de main
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer la recherche du circuit"
          >
            <X size={18} />
          </button>
        </header>
        <label className="circuit-navigator-input">
          <Search size={18} />
          <input
            ref={inputRef}
            type="search"
            maxLength={160}
            autoComplete="off"
            role="combobox"
            aria-label="Rechercher dans le circuit"
            aria-controls="circuit-navigator-results"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder="R12, bobine, VCC, une borne…"
            value={query}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || busy) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  Math.max(
                    0,
                    Math.min(results.length - 1, activeIndex + direction),
                  ),
                );
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void choose(results[activeIndex]);
              }
            }}
          />
        </label>
        <p className="circuit-navigator-count" role="status">
          {found.length > 60
            ? "60 premiers résultats · affine ta recherche"
            : `${results.length} résultat${results.length > 1 ? "s" : ""}`}{" "}
          · sélectionner et cadrer dans le schéma
        </p>
        <div
          className="circuit-navigator-results"
          id="circuit-navigator-results"
          role="listbox"
          aria-label="Éléments du circuit"
          aria-busy={busy}
        >
          {results.map((item, position) => {
            const Icon = kindIcons[item.kind];
            return (
              <button
                key={item.key}
                id={`circuit-target-${position}`}
                type="button"
                role="option"
                aria-selected={position === activeIndex}
                tabIndex={-1}
                disabled={busy}
                onMouseMove={() => setActive(position)}
                onClick={() => void choose(item)}
              >
                <span className={`circuit-navigator-kind target-${item.kind}`}>
                  <Icon size={17} />
                </span>
                <span className="circuit-navigator-result-label">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="circuit-navigator-kind-label">
                  {kindLabels[item.kind]}
                </span>
              </button>
            );
          })}
          {!results.length && (
            <p className="circuit-navigator-empty">
              {index.length
                ? "Aucun élément trouvé. Essaie son identifiant, son type ou le nom d’un réseau."
                : "Ce circuit est vide. Ajoute des composants pour commencer ton montage."}
            </p>
          )}
        </div>
        {error && (
          <p className="circuit-navigator-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>↑ ↓ parcourir · Entrée repérer · Échap fermer</span>
          <kbd>⌘ / Ctrl K</kbd>
        </footer>
      </div>
    </dialog>
  );
}
