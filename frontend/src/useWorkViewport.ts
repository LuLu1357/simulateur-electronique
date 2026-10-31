import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { State } from "./types";
import {
  captureWorkViewport,
  restoreWorkViewport,
  shouldPreserveWorkViewport,
} from "./workViewport";
import type { WorkViewportAnchor } from "./workViewport";

/** Garde la zone regardée pendant une édition, y compris ses effets de nettoyage. */
export function useWorkViewport() {
  const pending = useRef<WorkViewportAnchor | null>(null);
  const anchor = pending.current;
  // La disparition d'une sélection peut nettoyer le formulaire au rendu suivant.
  // Restaurer aussi ce second rendu, avant peinture, sans toucher aux sondages stables.
  useLayoutEffect(() => {
    if (pending.current) restoreWorkViewport(pending.current);
  });
  useEffect(() => {
    if (!anchor) return;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (pending.current === anchor) pending.current = null;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor]);
  useEffect(() => {
    // Une nouvelle action de l'utilisateur prime toujours sur la stabilisation.
    const release = () => {
      pending.current = null;
    };
    const events = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
    for (const name of events)
      document.addEventListener(name, release, {
        capture: true,
        passive: true,
      });
    return () => {
      for (const name of events)
        document.removeEventListener(name, release, true);
    };
  }, []);
  return useCallback((current: State | null, next: State) => {
    if (shouldPreserveWorkViewport(current, next))
      pending.current = captureWorkViewport(document);
    else if (
      !current ||
      current.project.id !== next.project.id ||
      current.project.ui.view !== next.project.ui.view
    )
      pending.current = null;
    // Une réponse de même révision n'efface pas une stabilisation déjà en cours.
  }, []);
}
