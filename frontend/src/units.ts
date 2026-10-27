/** Parse une valeur SI sans exécuter d’expression. La casse des préfixes est
 * significative : m = milli, M = méga. Un nombre nu est exprimé en unité SI. */
export function parseEngineeringValue(
  input: string,
  expectedUnit: string,
): number | null {
  if (typeof input !== "string" || typeof expectedUnit !== "string")
    return null;
  if (!["Ω", "F", "V", "A", "s", ""].includes(expectedUnit)) return null;
  const normalized = input.trim().replace(/\u00a0|\u202f/g, " ");
  if (!normalized || normalized.length > 120) return null;
  const match =
    /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?)\s*([pnuµμmkKMGT]?)\s*([^\s]*)$/.exec(
      normalized,
    );
  if (!match) return null;
  const [, raw, prefix, rawUnit] = match;
  const aliases: Record<string, string> = {
    ohm: "Ω",
    Ohm: "Ω",
    ohms: "Ω",
    Ohms: "Ω",
    Ω: "Ω",
    Ω: "Ω",
    F: "F",
    V: "V",
    A: "A",
    s: "s",
    "": "",
  };
  const unit = aliases[rawUnit];
  if (unit === undefined || (unit && unit !== expectedUnit)) return null;
  if (!expectedUnit && (prefix || unit)) return null;
  const multipliers: Record<string, number> = {
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    μ: 1e-6,
    m: 1e-3,
    "": 1,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  };
  const numeric = Number(raw.replace(",", "."));
  const value = numeric * multipliers[prefix];
  if (!Number.isFinite(numeric) || !Number.isFinite(value)) return null;
  // Underflow must not turn a requested nonzero value into a silent zero.
  if (value === 0 && /[1-9]/.test(raw.replace(/[eE].*$/, ""))) return null;
  return value;
}
