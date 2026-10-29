import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  frameMatchesSource,
  nearestPlaybackIndex,
  playbackSource,
  withPlaybackFrame,
} from "./playback";
import type { SimulationFrame } from "./playback";
import type { Simulation, State } from "./types";

export function useSimulationPlayback(
  state: State | null,
  base: Simulation | null,
  busy: boolean,
  refresh: () => Promise<void>,
) {
  const source = useMemo(() => playbackSource(state, busy), [state, busy]);
  const key = source?.key || "";
  const last = (source?.time.length || 1) - 1;
  const [selection, setSelection] = useState<{
    key: string;
    index: number;
  } | null>(null);
  const [frameState, setFrameState] = useState<{
    key: string;
    frame: SimulationFrame;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(8);
  const [retry, setRetry] = useState(0);
  const index =
    selection?.key === key
      ? Math.max(0, Math.min(last, selection.index))
      : last;
  const latest = useRef({ source, index });
  latest.current = { source, index };
  const activeRequest = useRef<{
    controller: AbortController;
    key: string;
    index: number;
  } | null>(null);
  const cache = useRef<{ key: string; frames: Map<number, SimulationFrame> }>({
    key: "",
    frames: new Map(),
  });

  useEffect(() => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    cache.current = { key, frames: new Map() };
    setFrameState(null);
    setPlaying(false);
    setError("");
    return () => {
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    };
  }, [key]);
  useEffect(() => {
    const active = latest.current.source;
    setError("");
    if (!active || index === active.time.length - 1) {
      setFrameState(null);
      setLoading(false);
      return;
    }
    const cached =
      cache.current.key === key ? cache.current.frames.get(index) : undefined;
    if (cached && frameMatchesSource(cached, active, index)) {
      setFrameState({ key, frame: cached });
      setLoading(false);
      return;
    }
    setLoading(true);
    // Regrouper les changements rapides du curseur ; une lecture n'est pas un calcul SPICE.
    const timer = window.setTimeout(async () => {
      // Une seule requête à la fois : les nouveaux points attendent la fin de
      // celle déjà lancée, même si le client ne souhaite plus l'afficher.
      if (activeRequest.current) return;
      const cachedNow =
        cache.current.key === key ? cache.current.frames.get(index) : undefined;
      if (cachedNow && frameMatchesSource(cachedNow, active, index)) {
        setFrameState({ key, frame: cachedNow });
        setLoading(false);
        return;
      }
      const currentRequest = { controller: new AbortController(), key, index };
      activeRequest.current = currentRequest;
      try {
        const frame = await api<SimulationFrame>(
          `results/frame?simulation_id=${encodeURIComponent(active.simulationId)}&index=${index}`,
          undefined,
          { signal: currentRequest.controller.signal },
        );
        const current = latest.current;
        if (
          activeRequest.current !== currentRequest ||
          !current.source ||
          current.source.key !== key
        )
          return;
        if (!frameMatchesSource(frame, current.source, index))
          throw new Error(
            "L’échantillon reçu ne correspond plus au calcul affiché.",
          );
        if (cache.current.key === key) {
          cache.current.frames.set(index, frame);
          if (cache.current.frames.size > 64)
            cache.current.frames.delete(
              cache.current.frames.keys().next().value!,
            );
        }
        if (current.index === index) setFrameState({ key, frame });
      } catch (cause) {
        if (
          currentRequest.controller.signal.aborted ||
          activeRequest.current !== currentRequest
        )
          return;
        setPlaying(false);
        if (latest.current.index === index) {
          setFrameState(null);
          setError(String(cause).replace(/^Error: /, ""));
        }
        void refresh().catch(() => {});
      } finally {
        if (activeRequest.current === currentRequest) {
          activeRequest.current = null;
          if (latest.current.source?.key === key) {
            if (latest.current.index === index) setLoading(false);
            else setRetry((value) => value + 1);
          }
        }
      }
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, index, retry, refresh]);

  useEffect(() => {
    if (!playing || !source) return;
    const from = source.time[index],
      end = source.time.at(-1)!;
    const fullSpan = end - source.time[0];
    const started = performance.now();
    const timer = window.setInterval(() => {
      const active = latest.current.source;
      if (!active || active.key !== key) {
        setPlaying(false);
        return;
      }
      if (activeRequest.current) return;
      const target = Math.min(
        end,
        from + fullSpan * ((performance.now() - started) / (duration * 1000)),
      );
      const next = nearestPlaybackIndex(active.time, target);
      if (next >= 0) setSelection({ key, index: next });
      if (target >= end) setPlaying(false);
    }, 80);
    return () => window.clearInterval(timer);
    // Le curseur change à chaque image ; l'ancrage de lecture reste celui du départ.
  }, [playing, key, duration]);

  const selectIndex = useCallback((value: number) => {
    const active = latest.current.source;
    if (
      !active ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= active.time.length
    )
      return;
    setPlaying(false);
    setSelection({ key: active.key, index: value });
  }, []);
  const toggle = () => {
    if (!source) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index === last) setSelection({ key, index: 0 });
    if (error) {
      setError("");
      setRetry((value) => value + 1);
    }
    setPlaying(true);
  };
  const currentFrame =
    source &&
    frameState?.key === key &&
    frameMatchesSource(frameState.frame, source, frameState.frame.index)
      ? frameState.frame
      : null;
  const simulation = useMemo(
    () =>
      source && base ? withPlaybackFrame(base, source, currentFrame) : base,
    [source, base, currentFrame],
  );
  return {
    source,
    index,
    displayIndex: currentFrame?.index ?? last,
    displayTime: source ? (currentFrame?.time ?? source.time.at(-1)!) : null,
    requestedTime: source?.time[index] ?? null,
    loading,
    error,
    playing,
    duration,
    simulation,
    selectIndex,
    toggle,
    final: () => selectIndex(last),
    changeDuration: (seconds: number) => {
      if ([4, 8, 16].includes(seconds)) setDuration(seconds);
    },
    retry: () => {
      setError("");
      setRetry((value) => value + 1);
    },
  };
}
