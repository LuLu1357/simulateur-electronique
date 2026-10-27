/** Raccourcis de l'éditeur : les formulaires et le guide restent prioritaires. */
type EditorKeyEvent = Pick<
  KeyboardEvent,
  "key" | "target" | "metaKey" | "ctrlKey" | "shiftKey" | "preventDefault"
>;

type EditableElement = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  parentElement?: EditableElement | null;
};

export function isEditingTarget(target: EventTarget | null): boolean {
  let element = target as EditableElement | null;
  while (element) {
    const tag = element.tagName?.toLowerCase();
    if (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      element.isContentEditable
    )
      return true;
    const editable = element.getAttribute?.("contenteditable");
    if (
      editable === "" ||
      editable?.toLowerCase() === "true" ||
      editable?.toLowerCase() === "plaintext-only"
    )
      return true;
    element = element.parentElement || null;
  }
  return false;
}

export type EditorKeyActions = {
  helpOpen: boolean;
  closeHelp: () => void;
  cancelWiring: () => void;
  removeSelection: () => void;
  history: (action: "undo" | "redo") => void;
  selectTool: (tool: "select" | "wire") => void;
  rotateSelection?: (direction: 1 | -1) => void;
  duplicateSelection?: () => void;
  selectAll?: () => void;
  nudgeSelection?: (dx: number, dy: number) => void;
};

/** Retourne true seulement si l'éditeur ou le guide consomme la touche. */
export function handleEditorKey(
  event: EditorKeyEvent,
  actions: EditorKeyActions,
): boolean {
  if (isEditingTarget(event.target)) return false;
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  const historyKey = command && key === "z";
  const duplicateKey = command && key === "d" && !!actions.duplicateSelection;
  const selectAllKey = command && key === "a" && !!actions.selectAll;
  const arrowDirections: Record<string, readonly [number, number]> = {
    arrowleft: [-1, 0],
    arrowright: [1, 0],
    arrowup: [0, -1],
    arrowdown: [0, 1],
  };
  const arrow = arrowDirections[key];
  const nudgeKey = !!arrow && !command && !!actions.nudgeSelection;
  if (actions.helpOpen) {
    if (key === "escape") {
      event.preventDefault();
      actions.closeHelp();
      return true;
    }
    if (
      key === "delete" ||
      key === "backspace" ||
      historyKey ||
      duplicateKey ||
      selectAllKey ||
      nudgeKey ||
      (!command && (key === "v" || key === "w" || key === "r"))
    ) {
      event.preventDefault();
      return true;
    }
    return false;
  }
  if (key === "escape") {
    event.preventDefault();
    actions.cancelWiring();
  } else if (key === "delete" || key === "backspace") {
    event.preventDefault();
    actions.removeSelection();
  } else if (historyKey) {
    event.preventDefault();
    actions.history(event.shiftKey ? "redo" : "undo");
  } else if (duplicateKey) {
    event.preventDefault();
    actions.duplicateSelection!();
  } else if (selectAllKey) {
    event.preventDefault();
    actions.selectAll!();
  } else if (nudgeKey) {
    event.preventDefault();
    const distance = event.shiftKey ? 1 : 10;
    actions.nudgeSelection!(arrow![0] * distance, arrow![1] * distance);
  } else if (
    key === "r" &&
    !event.metaKey &&
    !event.ctrlKey &&
    actions.rotateSelection
  ) {
    event.preventDefault();
    actions.rotateSelection(event.shiftKey ? -1 : 1);
  } else if (!command && (key === "v" || key === "w")) {
    event.preventDefault();
    actions.selectTool(key === "v" ? "select" : "wire");
  } else {
    return false;
  }
  return true;
}

/** Traite aussi le rejet de la requête pour éviter une promesse non gérée. */
export async function requestSimulationStop(
  stop: () => Promise<unknown>,
  setNotice: (message: string) => void,
  setError: (message: string) => void,
): Promise<void> {
  try {
    await stop();
    setNotice("Arrêt demandé.");
  } catch (error) {
    setError(String(error));
  }
}
