import { useEffect, useId, useRef, useState } from "react";
import { Check, Radio, Waves } from "lucide-react";
import { format } from "../types";
import type { Component, VoltageWaveform } from "../types";
import "../source.css";

type Field = "low" | "high" | "delay" | "rise" | "fall" | "width" | "period";
type Draft = Record<Field, string>;
type Validation = {
  waveform: VoltageWaveform | null;
  error: string;
  field?: Field;
};
const fields: {
  name: Field;
  label: string;
  unit: string;
  factor: number;
  positive?: boolean;
}[] = [
  { name: "low", label: "Niveau bas", unit: "V", factor: 1 },
  { name: "high", label: "Niveau haut", unit: "V", factor: 1 },
  {
    name: "period",
    label: "Période",
    unit: "ms",
    factor: 1e-3,
    positive: true,
  },
  {
    name: "width",
    label: "Plateau haut",
    unit: "ms",
    factor: 1e-3,
    positive: true,
  },
  { name: "rise", label: "Montée", unit: "µs", factor: 1e-6, positive: true },
  { name: "fall", label: "Descente", unit: "µs", factor: 1e-6, positive: true },
  { name: "delay", label: "Retard initial", unit: "ms", factor: 1e-3 },
];

function initialDraft(waveform?: VoltageWaveform | null): Draft {
  return waveform
    ? {
        low: String(waveform.low),
        high: String(waveform.high),
        delay: String(waveform.delay * 1e3),
        period: String(waveform.period * 1e3),
        width: String(waveform.width * 1e3),
        rise: String(waveform.rise * 1e6),
        fall: String(waveform.fall * 1e6),
      }
    : {
        low: "0",
        high: "5",
        delay: "0",
        period: "6",
        width: "3",
        rise: "10",
        fall: "10",
      };
}

function validate(draft: Draft): Validation {
  const values: Partial<Record<Field, number>> = {};
  for (const field of fields) {
    const value = Number(draft[field.name]) * field.factor;
    if (!draft[field.name].trim() || !Number.isFinite(value))
      return {
        waveform: null,
        error: `${field.label} : saisis un nombre fini.`,
        field: field.name,
      };
    if ((field.positive && value <= 0) || (field.name === "delay" && value < 0))
      return {
        waveform: null,
        error: `${field.label} : ${field.name === "delay" ? "le retard doit être positif ou nul" : "la durée doit être strictement positive"}.`,
        field: field.name,
      };
    if (
      (field.name === "low" || field.name === "high") &&
      Math.abs(value) > 1e6
    )
      return {
        waveform: null,
        error: "La source est limitée à ±1 MV.",
        field: field.name,
      };
    values[field.name] = value;
  }
  const waveform = { kind: "pulse", ...values } as VoltageWaveform;
  const active = waveform.rise + waveform.width + waveform.fall;
  if (
    !Number.isFinite(active) ||
    active > waveform.period + 1e-12 * waveform.period
  )
    return {
      waveform: null,
      error:
        "La montée, le plateau haut et la descente doivent tenir dans une période.",
      field: "period",
    };
  if (!Number.isFinite(waveform.delay + 2 * waveform.period))
    return {
      waveform: null,
      error: "Ces durées dépassent les limites numériques.",
      field: "period",
    };
  return { waveform, error: "" };
}

function WaveformPreview({
  waveform,
  dc,
}: {
  waveform: VoltageWaveform | null;
  dc: number;
}) {
  const w = 240,
    h = 96,
    x0 = 32,
    x1 = 226,
    y0 = 18,
    y1 = 73;
  const low = waveform?.low ?? dc,
    high = waveform?.high ?? dc;
  const scale = Math.max(Math.abs(low), Math.abs(high), 1);
  const min = Math.min(low, high) / scale,
    max = Math.max(low, high) / scale;
  const span = max - min;
  const y = (v: number) =>
    span ? y1 - ((v / scale - min) / span) * (y1 - y0) : (y0 + y1) / 2;
  let path = `M${x0},${y(low)}H${x1}`;
  if (waveform) {
    const { delay, period, rise, width, fall } = waveform;
    const end = delay + 2 * period;
    const x = (t: number) => x0 + (t / end) * (x1 - x0);
    const points: [number, number][] = [
      [0, low],
      [delay, low],
    ];
    for (let cycle = 0; cycle < 2; cycle++) {
      const start = delay + cycle * period;
      points.push(
        [start, low],
        [start + rise, high],
        [start + rise + width, high],
        [start + rise + width + fall, low],
        [start + period, low],
      );
    }
    path = points
      .map(
        ([time, voltage], index) =>
          `${index ? "L" : "M"}${x(time).toFixed(3)},${y(voltage).toFixed(3)}`,
      )
      .join("");
  }
  return (
    <svg
      className="source-preview"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={
        waveform
          ? `Aperçu du créneau : de ${format(low)} à ${format(high)}, période ${format(waveform.period, "s")}, retard ${format(waveform.delay, "s")}`
          : `Source continue de ${format(dc)}`
      }
    >
      <path
        d={`M${x0} 9V80H${x1}M${x0} 45H${x1}`}
        className="source-preview-grid"
      />
      <path d={path} className="source-preview-wave" />
      <text x="5" y={y(high) + 3}>
        {format(high)}
      </text>
      {low !== high && (
        <text x="5" y={y(low) + 3}>
          {format(low)}
        </text>
      )}
      <text x={x1} y="93" textAnchor="end">
        {waveform
          ? `${format(waveform.delay + 2 * waveform.period, "s")} →`
          : "temps →"}
      </text>
    </svg>
  );
}

export function SourceWaveform({
  component,
  onApply,
  busy,
}: {
  component: Component;
  onApply: (waveform: VoltageWaveform | null) => Promise<boolean>;
  busy: boolean;
}) {
  const prefix = useId();
  const [mode, setMode] = useState<"dc" | "pulse">(
    component.waveform ? "pulse" : "dc",
  );
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(component.waveform),
  );
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<Field | undefined>();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const loading = useRef(false);
  const currentId = useRef(component.id);
  currentId.current = component.id;
  const configured = component.waveform
    ? JSON.stringify(fields.map((field) => component.waveform?.[field.name]))
    : "null";
  useEffect(() => {
    setMode(component.waveform ? "pulse" : "dc");
    setDraft(initialDraft(component.waveform));
    setError("");
    setInvalidField(undefined);
    setFeedback("");
  }, [component.id, configured]);
  const validation = validate(draft);
  const candidate = mode === "pulse" ? validation.waveform : null;
  const dirty =
    mode === "pulse"
      ? !candidate ||
        !component.waveform ||
        fields.some((field) => {
          const before = component.waveform![field.name];
          const after = candidate[field.name];
          return (
            Math.abs(before - after) >
            1e-12 * Math.max(Math.abs(before), Math.abs(after), 1e-12)
          );
        })
      : !!component.waveform;
  const locked = busy || submitting;
  const update = (field: Field, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setError("");
    setInvalidField(undefined);
    setFeedback("");
  };
  const apply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked || loading.current || !dirty) return;
    if (mode === "pulse" && validation.error) {
      setError(validation.error);
      setInvalidField(validation.field);
      if (validation.field)
        event.currentTarget
          .querySelector<HTMLInputElement>(`[name="${validation.field}"]`)
          ?.focus();
      return;
    }
    const submittedId = component.id;
    loading.current = true;
    setSubmitting(true);
    setError("");
    setInvalidField(undefined);
    try {
      const applied = await onApply(candidate);
      if (currentId.current !== submittedId) return;
      if (applied)
        setFeedback(
          mode === "pulse"
            ? "Créneau appliqué. Lance un calcul TRAN pour voir son évolution."
            : "Source continue rétablie. Recalcule pour actualiser les mesures.",
        );
      else
        setError(
          "La source n’a pas été modifiée. Vérifie le circuit puis réessaie.",
        );
    } catch (cause) {
      if (currentId.current === submittedId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading.current = false;
      setSubmitting(false);
    }
  };
  if (component.kind !== "voltage_source") return null;
  return (
    <form className="source-waveform" onSubmit={apply} noValidate>
      <div className="source-heading">
        <Radio size={15} />
        <h4>Signal de la source</h4>
      </div>
      <div className="source-modes" role="group" aria-label="Forme du signal">
        <button
          type="button"
          aria-pressed={mode === "dc"}
          disabled={locked}
          onClick={() => {
            setMode("dc");
            setError("");
            setFeedback("");
          }}
        >
          Continue
        </button>
        <button
          type="button"
          aria-pressed={mode === "pulse"}
          disabled={locked}
          onClick={() => {
            setMode("pulse");
            setError("");
            setFeedback("");
          }}
        >
          <Waves size={13} /> Créneau
        </button>
      </div>
      {mode === "dc" ? (
        <p className="source-explanation">
          Tension constante : <strong>{format(component.value)}</strong>.
          Modifie sa valeur dans le champ de tension du composant.
        </p>
      ) : (
        <>
          <p className="source-explanation">
            En OP, la source reste au niveau bas. En TRAN, elle suit le créneau
            ci-dessous.
          </p>
          <div className="source-fields">
            {fields.map((field) => (
              <label key={field.name} htmlFor={`${prefix}-${field.name}`}>
                <span>{field.label}</span>
                <div>
                  <input
                    id={`${prefix}-${field.name}`}
                    name={field.name}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={draft[field.name]}
                    disabled={locked}
                    onChange={(event) => update(field.name, event.target.value)}
                    aria-invalid={invalidField === field.name || undefined}
                    aria-describedby={
                      invalidField === field.name && error
                        ? `${prefix}-error`
                        : undefined
                    }
                  />
                  <span>{field.unit}</span>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
      {mode === "dc" || candidate ? (
        <WaveformPreview waveform={candidate} dc={component.value} />
      ) : (
        <div className="source-invalid-preview">
          Saisis des durées compatibles pour afficher l’aperçu.
        </div>
      )}
      {mode === "pulse" && candidate && (
        <div className="source-timing">
          <span>{format(1 / candidate.period, "Hz")}</span>
          <span>
            Plateau haut :{" "}
            {Number(
              ((candidate.width / candidate.period) * 100).toPrecision(3),
            )}{" "}
            %
          </span>
        </div>
      )}
      <p className={`source-draft ${dirty ? "pending" : ""}`}>
        {dirty
          ? "Aperçu du réglage · modifications non appliquées"
          : "Réglage actif du circuit"}
      </p>
      {error && (
        <p className="source-error" id={`${prefix}-error`} role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="source-apply"
        disabled={locked || !dirty}
      >
        <Check size={14} />
        {submitting ? "Application…" : "Appliquer le signal"}
      </button>
      {feedback && (
        <p className="source-feedback" role="status">
          {feedback}
        </p>
      )}
    </form>
  );
}
