import { Pause, Play, RotateCcw, TimerReset } from "lucide-react";
import { format } from "../types";
import type { useSimulationPlayback } from "../useSimulationPlayback";
import "../playback.css";

export function SimulationPlayback({
  playback,
}: {
  playback: ReturnType<typeof useSimulationPlayback>;
}) {
  const {
    source,
    index,
    displayIndex,
    displayTime,
    requestedTime,
    loading,
    error,
    playing,
    duration,
  } = playback;
  if (!source) return null;
  return (
    <section
      className="simulation-playback"
      aria-label="Relecture des échantillons transitoires"
    >
      <div className="playback-heading">
        <div>
          <TimerReset size={16} />
          <strong>Le montage, instant par instant</strong>
        </div>
        <span>
          Calcul révision {source.sourceRevision} · {source.time.length}{" "}
          échantillons réels
        </span>
      </div>
      <div className="playback-controls">
        <button
          className="playback-toggle"
          onClick={playback.toggle}
          aria-label={
            playing
              ? "Mettre la relecture en pause"
              : "Lire les échantillons du montage"
          }
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause" : "Lire"}
        </button>
        <label className="playback-position">
          Temps visé : {format(requestedTime ?? undefined, "s")}
          <input
            type="range"
            min={0}
            max={source.time.length - 1}
            step={1}
            value={index}
            aria-label="Instant du montage"
            aria-valuetext={`Échantillon ${index + 1} sur ${source.time.length}, temps ${format(requestedTime ?? undefined, "s")}`}
            onChange={(event) =>
              playback.selectIndex(Number(event.target.value))
            }
          />
        </label>
        <label className="playback-duration">
          Durée de lecture
          <select
            aria-label="Durée de relecture"
            value={duration}
            onChange={(event) =>
              playback.changeDuration(Number(event.target.value))
            }
          >
            {[4, 8, 16].map((value) => (
              <option key={value} value={value}>
                {value} s
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={playback.final}
          disabled={index === source.time.length - 1 && !playing}
          title="Revenir au dernier point calculé"
          aria-label="Revenir au dernier point calculé"
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p
        className="playback-status"
        role="status"
        aria-live={playing ? "off" : "polite"}
      >
        Montage affiché : t = {format(displayTime ?? undefined, "s")} · point{" "}
        {displayIndex + 1}
        {loading ? " · lecture du point demandé…" : ""}
        {error ? ` · ${error}` : ""}
        {error && <button onClick={playback.retry}>Réessayer</button>}
      </p>
      <p className="playback-caption">
        Les valeurs du schéma et des plaques suivent les points calculés, sans
        modifier le circuit. Le temps de lecture est ralenti pour observer le
        montage.
      </p>
    </section>
  );
}
