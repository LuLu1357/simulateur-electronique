import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { colors } from "../types";
import type { ScopeCurve } from "../scope";
import { filterMeasurementChannels } from "../measurementChannels";
import type { ChannelFilter } from "../measurementChannels";
import "../measurementChannels.css";

const pageSize = 20;
const unitLabel = (unit: string) =>
  unit === "V"
    ? "Tension [V]"
    : unit === "A"
      ? "Courant [A]"
      : unit || "Unité non renseignée";

export function MeasurementChannelSelector({
  curves,
  selectedIds,
  onToggle,
}: {
  curves: readonly ScopeCurve[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  const chosen = useMemo(
    () => curves.filter((curve) => selectedIds.includes(curve.id)),
    [curves, selectedIds],
  );
  const matches = useMemo(
    () => filterMeasurementChannels(curves, query, filter),
    [curves, query, filter],
  );
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const shown = matches.slice(start, start + pageSize);
  const color = (curve: ScopeCurve) =>
    colors[curves.indexOf(curve) % colors.length];

  return (
    <section
      className="measurement-channels"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        // Préserver les contrôles natifs sans transmettre les raccourcis au schéma.
        event.stopPropagation();
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          openerRef.current?.focus();
        }
      }}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
    >
      <div className="measurement-channels-heading">
        <div>
          <h4 id={`${id}-title`}>Mesures affichées</h4>
          <p>
            {chosen.length} choisie{chosen.length > 1 ? "s" : ""} ·{" "}
            {curves.length} disponible{curves.length > 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          ref={openerRef}
          className="measurement-catalog-toggle"
          aria-expanded={open}
          aria-controls={`${id}-catalog`}
          disabled={!curves.length}
          onClick={() => {
            setOpen((current) => !current);
            if (open) openerRef.current?.focus();
          }}
        >
          {open ? <X size={14} /> : <Plus size={14} />}
          {open ? "Masquer le catalogue" : "Ajouter une mesure"}
        </button>
      </div>
      {chosen.length ? (
        <ul
          className="measurement-chosen"
          aria-label="Mesures choisies, indépendantes de la recherche"
        >
          {chosen.map((curve) => (
            <li
              key={curve.id}
              data-channel-id={curve.id}
              style={
                { "--measurement-color": color(curve) } as React.CSSProperties
              }
            >
              <i aria-hidden="true" />
              <div
                title={`${curve.label} · ${curve.id} · ${unitLabel(curve.unit)}`}
              >
                <strong>{curve.label}</strong>
                <small>
                  {unitLabel(curve.unit)} · {curve.id}
                </small>
              </div>
              <button
                type="button"
                aria-label={`Retirer ${curve.label} [${curve.unit}] (${curve.id}) du graphe`}
                onClick={(event) => {
                  if (document.activeElement === event.currentTarget) {
                    const row = event.currentTarget.closest("li");
                    const neighbor =
                      row?.nextElementSibling || row?.previousElementSibling;
                    const next =
                      neighbor?.querySelector<HTMLButtonElement>("button");
                    (next || openerRef.current)?.focus();
                  }
                  onToggle(curve.id);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="measurement-choice-empty">
          {curves.length
            ? "Aucune mesure choisie. Ajoute une tension ou un courant au graphe."
            : "Aucune courbe disponible pour cette analyse."}
        </p>
      )}
      {open && (
        <div id={`${id}-catalog`} className="measurement-catalog">
          <div className="measurement-search">
            <label htmlFor={`${id}-search`}>Rechercher une mesure</label>
            <div>
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                id={`${id}-search`}
                type="search"
                value={query}
                placeholder="Identifiant, libellé, composant ou unité…"
                autoComplete="off"
                aria-describedby={`${id}-search-help`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Effacer la recherche de mesures"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                    searchRef.current?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="measurement-search-help" id={`${id}-search-help`}>
            Exemples : R1, I:Q1.b, tension, ampère. Échap ferme le catalogue.
          </p>
          <div
            className="measurement-filters"
            role="group"
            aria-label="Types de mesures"
          >
            {(
              [
                ["all", "Tous"],
                ["voltage", "Tensions"],
                ["current", "Courants"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p
            className="measurement-match-count"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {matches.length} résultat{matches.length > 1 ? "s" : ""} sur{" "}
            {curves.length} mesures
            {matches.length > 0 && ` · ${start + 1}–${start + shown.length}`}
          </p>
          {shown.length ? (
            <ul
              className="measurement-results"
              aria-label="Catalogue des mesures"
            >
              {shown.map((curve) => (
                <li key={curve.id} data-channel-id={curve.id}>
                  <label
                    className="measurement-result"
                    style={
                      {
                        "--measurement-color": color(curve),
                      } as React.CSSProperties
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(curve.id)}
                      onChange={() => onToggle(curve.id)}
                      aria-label={`Afficher ${curve.label} [${curve.unit}] (${curve.id})`}
                    />
                    <i aria-hidden="true" />
                    <span title={`${curve.label} · ${curve.id}`}>
                      <strong>{curve.label}</strong>
                      <small>{curve.id}</small>
                    </span>
                    <em>{unitLabel(curve.unit)}</em>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="measurement-no-results">
              Aucune mesure ne correspond. Essaie un autre identifiant ou
              choisis « Tous ».
            </p>
          )}
          {matches.length > pageSize && (
            <nav
              className="measurement-pages"
              aria-label="Pages du catalogue de mesures"
            >
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={14} /> Précédents
              </button>
              <span>
                Page {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                type="button"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                Suivants <ChevronRight size={14} />
              </button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
