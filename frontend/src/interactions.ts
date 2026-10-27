/** Raccourcis de l'éditeur : les formulaires et le guide restent prioritaires. */
type EditorKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'target' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'preventDefault'
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
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable) return true;
    const editable = element.getAttribute?.('contenteditable');
    if (editable === '' || editable?.toLowerCase() === 'true' || editable?.toLowerCase() === 'plaintext-only') return true;
    element = element.parentElement || null;
  }
  return false;
}

export type EditorKeyActions = {
  helpOpen: boolean;
  closeHelp: () => void;
  cancelWiring: () => void;
  removeSelection: () => void;
  history: (action: 'undo' | 'redo') => void;
  selectTool: (tool: 'select' | 'wire') => void;
  rotateSelection?: (direction:1|-1)=>void;
};

/** Retourne true seulement si l'éditeur ou le guide consomme la touche. */
export function handleEditorKey(event: EditorKeyEvent, actions: EditorKeyActions): boolean {
  if (isEditingTarget(event.target)) return false;
  const key = event.key.toLowerCase();
  const historyKey = (event.metaKey || event.ctrlKey) && key === 'z';
  if (actions.helpOpen) {
    if (key === 'escape') {
      event.preventDefault();
      actions.closeHelp();
      return true;
    }
    if (key === 'delete' || key === 'backspace' || historyKey || key === 'v' || key === 'w' || key === 'r') {
      event.preventDefault();
      return true;
    }
    return false;
  }
  if (key === 'escape') {
    event.preventDefault();
    actions.cancelWiring();
  } else if (key === 'delete' || key === 'backspace') {
    event.preventDefault();
    actions.removeSelection();
  } else if (historyKey) {
    event.preventDefault();
    actions.history(event.shiftKey ? 'redo' : 'undo');
  } else if(key==='r'&&!event.metaKey&&!event.ctrlKey&&actions.rotateSelection){
    event.preventDefault();actions.rotateSelection(event.shiftKey?-1:1);
  } else if (key === 'v' || key === 'w') {
    actions.selectTool(key === 'v' ? 'select' : 'wire');
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
    setNotice('Arrêt demandé.');
  } catch (error) {
    setError(String(error));
  }
}
