import type { State } from "./types";

export type WorkViewportAnchor = {
  element: HTMLElement;
  reference: Element;
  view: Window;
  top: number;
  left: number;
  innerLeft: number;
};

/** Une édition du même montage ne constitue pas une demande de navigation. */
export function shouldPreserveWorkViewport(
  current: State | null,
  next: State,
): boolean {
  return (
    !!current &&
    current.project.id === next.project.id &&
    next.project.revision > current.project.revision &&
    current.project.ui.view === next.project.ui.view
  );
}

/** À appeler à réception du résultat, jamais au départ d'une requête lente. */
export function captureWorkViewport(doc: Document): WorkViewportAnchor | null {
  const view = doc.defaultView;
  if (!view) return null;
  const height = doc.documentElement.clientHeight;
  const width = doc.documentElement.clientWidth;
  let best: {
    anchor: WorkViewportAnchor;
    focused: boolean;
    area: number;
  } | null = null;
  for (const element of doc.querySelectorAll<HTMLElement>(
    ".schematic-scroll, .bb-board-scroll, #simulation-results",
  )) {
    const rect = element.getBoundingClientRect();
    const visibleHeight = Math.min(height, rect.bottom) - Math.max(0, rect.top);
    const visibleWidth = Math.min(width, rect.right) - Math.max(0, rect.left);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      visibleHeight <= 0 ||
      visibleWidth <= 0
    )
      continue;
    const surface = element.querySelector?.(".bb-flat-surface");
    const surfaceRect = surface?.getBoundingClientRect();
    const reference =
      surfaceRect && surfaceRect.width > 0 && surfaceRect.height > 0 && surfaceRect.bottom > 0 && surfaceRect.top < height
        ? surface!
        : element;
    const position = reference.getBoundingClientRect();
    const focused = !!doc.activeElement && element.contains(doc.activeElement);
    const area = visibleHeight * visibleWidth;
    if (
      !best ||
      (focused && !best.focused) ||
      (focused === best.focused && area > best.area)
    )
      best = {
        focused,
        area,
        anchor: {
          element,
          reference,
          view,
          top: position.top,
          left: position.left,
          innerLeft: element.scrollLeft,
        },
      };
  }
  return best?.anchor ?? null;
}

/** Restaurer avant peinture ; le navigateur borne naturellement la fin de page. */
export function restoreWorkViewport(anchor: WorkViewportAnchor): void {
  const { element, reference, view } = anchor;
  if (!element.isConnected || !reference.isConnected) return;
  let rect = reference.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  if (element.scrollLeft !== anchor.innerLeft) {
    element.scrollLeft = anchor.innerLeft;
    rect = reference.getBoundingClientRect();
  }
  const top = rect.top - anchor.top;
  const left = rect.left - anchor.left;
  if (Math.abs(top) > 0.5 || Math.abs(left) > 0.5)
    view.scrollBy({ top, left, behavior: "instant" });
}
