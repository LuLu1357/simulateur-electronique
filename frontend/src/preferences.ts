/** Réglages visuels locaux uniquement : aucun circuit, mesure ou jeton. */
export type DisplayPreferences = {
  showVolts: boolean;
  showCurrent: boolean;
  voltageColors: boolean;
  voltageRange: number;
  flowMode: "electrons" | "conventional" | "off";
  flowSpeed: number;
};

export type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export const preferencesStorageKey = "atelier.display-preferences.v1";
const preferencesVersion = 1;

export const defaultPreferences: Readonly<DisplayPreferences> = Object.freeze({
  showVolts: true,
  showCurrent: false,
  voltageColors: true,
  voltageRange: 5,
  flowMode: "electrons",
  flowSpeed: 1,
});

/** Ignore prototypes et accesseurs ; seuls les champs de données sont lus. */
function ownValue(source: unknown, key: string): unknown {
  if (source === null || typeof source !== "object" || Array.isArray(source))
    return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function validNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

/** Liste blanche explicite : les champs inconnus ne sont jamais recopiés. */
function sanitizePreferences(source: unknown): DisplayPreferences {
  const showVolts = ownValue(source, "showVolts");
  const showCurrent = ownValue(source, "showCurrent");
  const voltageColors = ownValue(source, "voltageColors");
  const voltageRange = ownValue(source, "voltageRange");
  const flowMode = ownValue(source, "flowMode");
  const flowSpeed = ownValue(source, "flowSpeed");
  return {
    showVolts:
      typeof showVolts === "boolean" ? showVolts : defaultPreferences.showVolts,
    showCurrent:
      typeof showCurrent === "boolean"
        ? showCurrent
        : defaultPreferences.showCurrent,
    voltageColors:
      typeof voltageColors === "boolean"
        ? voltageColors
        : defaultPreferences.voltageColors,
    voltageRange: validNumber(voltageRange, 0.1, 1e6)
      ? voltageRange
      : defaultPreferences.voltageRange,
    flowMode:
      flowMode === "electrons" ||
      flowMode === "conventional" ||
      flowMode === "off"
        ? flowMode
        : defaultPreferences.flowMode,
    flowSpeed: validNumber(flowSpeed, 0.25, 3)
      ? flowSpeed
      : defaultPreferences.flowSpeed,
  };
}

/**
 * À appeler une fois lors de l'initialisation de l'affichage. La préférence
 * système de mouvement réduit force alors l'arrêt, même si une animation
 * active était enregistrée. L'utilisateur peut ensuite l'activer explicitement
 * pendant sa session sans qu'une nouvelle lecture soit nécessaire.
 */
export function readPreferences(
  storage: PreferencesStorage | null | undefined,
  reducedMotion = false,
): DisplayPreferences {
  let preferences = { ...defaultPreferences };
  try {
    const raw = storage?.getItem(preferencesStorageKey);
    if (raw) {
      const saved: unknown = JSON.parse(raw);
      if (ownValue(saved, "version") === preferencesVersion) {
        preferences = sanitizePreferences(saved);
      }
    }
  } catch {
    // Stockage désactivé, refusé ou illisible : l'atelier reste utilisable.
  }
  if (reducedMotion) preferences.flowMode = "off";
  return preferences;
}

/** Échec de persistance sans exception ; conserve seulement les six réglages. */
export function writePreferences(
  storage: PreferencesStorage | null | undefined,
  preferences: unknown,
): boolean {
  if (!storage) return false;
  try {
    const sanitized = sanitizePreferences(preferences);
    const saved = {
      version: preferencesVersion,
      showVolts: sanitized.showVolts,
      showCurrent: sanitized.showCurrent,
      voltageColors: sanitized.voltageColors,
      voltageRange: sanitized.voltageRange,
      flowMode: sanitized.flowMode,
      flowSpeed: sanitized.flowSpeed,
    };
    storage.setItem(preferencesStorageKey, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
