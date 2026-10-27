/**
 * Codes visuels pédagogiques, indépendants du solveur électrique.
 *
 * Tension par rapport à la masse : bleu négatif, gris zéro, vert positif.
 * Une tension inconnue garde la couleur neutre ; l'interface peut y ajouter
 * un trait pointillé. La couleur seule ne doit jamais représenter la mesure.
 */
const NEUTRAL = [100, 116, 139] as const;
const POSITIVE = [71, 225, 154] as const;
const NEGATIVE = [85, 161, 255] as const;

export function voltageKnown(volts: number | undefined): volts is number {
  return typeof volts === "number" && Number.isFinite(volts);
}

function usableRange(range: number): number {
  return Number.isFinite(range) && range > 0 ? range : 5;
}

/** Intensité visuelle de 0 à 1, avec raccord doux et saturation à l'échelle. */
export function magnitudeIntensity(
  value: number | undefined,
  range = 5,
): number {
  if (!voltageKnown(value)) return 0;
  const t = Math.min(1, Math.abs(value) / usableRange(range));
  return t * t * (3 - 2 * t);
}

/** Couleur de potentiel : jamais rouge, réservé aux diagnostics d'erreur. */
export function voltageColor(volts: number | undefined, range = 5): string {
  const intensity = magnitudeIntensity(volts, range);
  const target = voltageKnown(volts) && volts < 0 ? NEGATIVE : POSITIVE;
  return (
    "#" +
    NEUTRAL.map((channel, index) =>
      Math.round(channel + (target[index] - channel) * intensity)
        .toString(16)
        .padStart(2, "0"),
    ).join("")
  );
}

/**
 * Durée d'animation en secondes : représentation qualitative du courant.
 * Le signe du courant choisit séparément le sens dans l'interface. La durée
 * utilise sa valeur absolue et une échelle logarithmique pour rester lisible.
 * Elle ne représente ni la vitesse de dérive des électrons ni une durée de
 * propagation électrique. Le paramètre speed est seulement un réglage visuel.
 */
export function particleDuration(current: number, speed = 1): number {
  if (!Number.isFinite(current)) return 8;
  const visualSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const magnitude = Math.abs(current);
  const referenceCurrent = 1e-6;
  // log10(I) évite un débordement pour les valeurs finies proches de MAX_VALUE.
  const activity =
    magnitude > referenceCurrent
      ? Math.log10(magnitude) -
        Math.log10(referenceCurrent) +
        Math.log10(1 + referenceCurrent / magnitude)
      : Math.log10(1 + magnitude / referenceCurrent);
  const duration = 6 / (1 + activity) / visualSpeed;
  return Math.max(0.4, Math.min(8, duration));
}

/**
 * Sens le long du trajet orienté de la première borne vers la seconde.
 * Le déplacement des électrons est opposé au courant conventionnel.
 * À courant nul ou inconnu, aucune particule ne doit être animée ; la valeur
 * forward sert uniquement de valeur de repli stable pour le rendu.
 */
export function flowDirection(
  current: number,
  mode: "electrons" | "conventional",
): "forward" | "reverse" {
  if (!Number.isFinite(current) || current === 0) return "forward";
  const conventionalForward = current > 0;
  const forward =
    mode === "electrons" ? !conventionalForward : conventionalForward;
  return forward ? "forward" : "reverse";
}

/** Cadre les symboles, leurs bornes et leurs libellés, sans modifier le circuit. */
export function fitCircuitView(
  positions: readonly { x: number; y: number }[],
  width = 900,
  height = 360,
): { zoom: number; pan: { x: number; y: number } } {
  const fallback = () => ({ zoom: 1, pan: { x: 0, y: 0 } });
  if (
    !Array.isArray(positions) ||
    positions.length === 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  )
    return fallback();

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of positions) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      return fallback();
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  // Les demi-étendues évitent le débordement de max - min aux grandes valeurs.
  const halfWidth = maxX / 2 - minX / 2 + 100;
  const halfHeight = maxY / 2 - minY / 2 + 80;
  const centerX = minX / 2 + maxX / 2;
  const centerY = minY / 2 + maxY / 2;
  const limitPanX =
    centerX === 0
      ? Infinity
      : (Number.MAX_VALUE - width / 2) / Math.abs(centerX);
  const limitPanY =
    centerY === 0
      ? Infinity
      : (Number.MAX_VALUE - height / 2) / Math.abs(centerY);
  // Aucun minimum de zoom visuel : même un grand circuit doit rester cadrable.
  // MIN_VALUE protège seulement contre un sous-dépassement IEEE-754 extrême.
  const zoom = Math.max(
    Number.MIN_VALUE,
    Math.min(
      1.5,
      width / 2 / halfWidth,
      height / 2 / halfHeight,
      limitPanX,
      limitPanY,
    ),
  );
  const pan = { x: width / 2 - centerX * zoom, y: height / 2 - centerY * zoom };
  return Number.isFinite(zoom) &&
    Number.isFinite(pan.x) &&
    Number.isFinite(pan.y)
    ? { zoom, pan }
    : fallback();
}
