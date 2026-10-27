import {
  CornerDownRight,
  Link2,
  Palette,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Wire } from "../types";
import "../wireInspector.css";

type Point = { x: number; y: number };
type WireStyle = { color?: string | null; waypoints?: Point[] };
const wireColors = [
  { value: "#9be3aa", label: "Vert" },
  { value: "#6da8eb", label: "Bleu" },
  { value: "#ef8179", label: "Rouge" },
  { value: "#eac06c", label: "Jaune" },
  { value: "#b59aeb", label: "Violet" },
  { value: "#f2a6cf", label: "Rose" },
  { value: "#e6e7db", label: "Blanc" },
  { value: "#66766f", label: "Gris" },
];

export function WireInspector({
  wire,
  onStyle,
  onRemove,
  voltageColors,
  onDisableVoltageColors,
}: {
  wire: Wire;
  onStyle: (style: WireStyle) => void;
  onRemove: () => void;
  voltageColors: boolean;
  onDisableVoltageColors: () => void;
}) {
  const styled = wire as Wire & WireStyle;
  const waypoints = styled.waypoints || [];
  return (
    <section
      className="wire-inspector"
      aria-label={`Propriétés du fil ${wire.id}`}
    >
      <div className="wire-inspector-heading">
        <span className="wire-inspector-icon">
          <Link2 size={22} />
        </span>
        <div>
          <h3>{wire.id}</h3>
          <p>Fil de connexion</p>
        </div>
      </div>
      <div className="wire-endpoints" aria-label="Extrémités du fil">
        <span>
          <i />
          {wire.a}
        </span>
        <CornerDownRight size={14} />
        <span>
          <i />
          {wire.b}
        </span>
      </div>
      <div className="wire-inspector-section">
        <h4>
          <Palette size={13} /> Couleur du fil
        </h4>
        <div
          className="wire-color-palette"
          role="group"
          aria-label="Choisir la couleur du fil"
        >
          {wireColors.map((color) => (
            <button
              key={color.value}
              aria-label={`Fil ${color.label.toLowerCase()}`}
              title={color.label}
              aria-pressed={styled.color?.toLowerCase() === color.value}
              style={{ "--wire-swatch": color.value } as CSSProperties}
              onClick={() => onStyle({ color: color.value })}
            >
              <span />
            </button>
          ))}
        </div>
        <button
          className="wire-reset-color"
          disabled={!styled.color}
          onClick={() => onStyle({ color: null })}
        >
          <RotateCcw size={12} /> Couleur automatique
        </button>
        {voltageColors && (
          <div className="wire-voltage-colors-note">
            <p>
              Les couleurs indiquent actuellement les tensions. Ta couleur de
              fil sera visible en désactivant ce mode.
            </p>
            <button onClick={onDisableVoltageColors}>
              Afficher les couleurs des fils
            </button>
          </div>
        )}
      </div>
      <div className="wire-inspector-section">
        <h4>
          <CornerDownRight size={13} /> Tracé du fil{" "}
          <span>
            {waypoints.length
              ? `${waypoints.length} point${waypoints.length > 1 ? "s" : ""}`
              : "Automatique"}
          </span>
        </h4>
        <p className="wire-routing-help">
          Double-clique le fil dans le schéma pour ajouter un point de passage.
          Glisse ensuite ses poignées pour ajuster le tracé.
        </p>
        {waypoints.length > 0 && (
          <>
            <ol className="wire-waypoints" aria-label="Points de passage">
              {waypoints.map((point, index) => (
                <li key={index}>
                  <span>Point {index + 1}</span>
                  <code>
                    {point.x} ; {point.y}
                  </code>
                  <button
                    aria-label={`Supprimer le point ${index + 1}`}
                    title={`Supprimer le point ${index + 1}`}
                    onClick={() =>
                      onStyle({
                        waypoints: waypoints.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ol>
            <button
              className="wire-reset-route"
              onClick={() => onStyle({ waypoints: [] })}
            >
              <RotateCcw size={13} /> Rétablir le tracé automatique
            </button>
          </>
        )}
      </div>
      <p className="wire-model-note">
        La couleur et le tracé changent le dessin. Les bornes et les connexions
        restent identiques.
      </p>
      <button className="wire-delete" onClick={onRemove}>
        <Trash2 size={14} /> Supprimer le fil
      </button>
    </section>
  );
}
