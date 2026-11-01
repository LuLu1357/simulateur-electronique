import { useCallback } from "react";
import { colors } from "../types";
import type { ScopeCurve } from "../scope";
import "../measurementChannels.css";

/** La couleur vient toujours de l’ordre du catalogue source, jamais du filtre. */
export function MeasurementLegend({
  curves,
  catalog,
  unit,
}: {
  curves: readonly ScopeCurve[];
  catalog: readonly ScopeCurve[];
  unit: string;
}) {
  const preserveFocus = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    return () => {
      if (document.activeElement !== element) return;
      const scope = element.closest(".lab-scope");
      const fallback =
        scope?.querySelector<HTMLElement>(
          ".measurement-catalog-toggle:not(:disabled)",
        ) || scope?.querySelector<HTMLElement>(".measurement-channels");
      if (fallback?.isConnected) fallback.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="measurement-legend"
      role="region"
      aria-label={`Légende des ${unit === "V" ? "tensions" : unit === "A" ? "courants" : unit}`}
      tabIndex={0}
      ref={preserveFocus}
      onKeyDown={(event) => event.stopPropagation()}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
    >
      <ul>
        {curves.map((curve) => (
          <li key={curve.id} data-channel-id={curve.id}>
            <i
              aria-hidden="true"
              style={{
                background: colors[catalog.indexOf(curve) % colors.length],
              }}
            />
            <span title={`${curve.label} · ${curve.id} [${curve.unit}]`}>
              {curve.label}{" "}
              <small>
                [{curve.unit}] · {curve.id}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
