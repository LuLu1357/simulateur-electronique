import type { Simulation } from "./types";

/** Provenance du point réellement dessiné, indépendante du curseur demandé. */
export function svgMeasurementProvenance(
  simulation: Simulation | null,
  stale = false,
): string {
  if (!simulation) return "Aucune mesure calculée.";
  if (simulation.status !== "success")
    return "Aucune mesure courante : le calcul n’a pas réussi.";
  const parts = [
    `Mesures ngspice de la révision ${simulation.project_revision}${stale || simulation.stale ? ", obsolètes" : ""}`,
  ];
  const identifier = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
  if (identifier(simulation.simulation_id))
    parts.push(`calcul ${simulation.simulation_id}`);
  if (identifier(simulation.circuit_fingerprint))
    parts.push(`empreinte ${simulation.circuit_fingerprint}`);
  const temporal =
    (simulation.analysis as { kind?: string } | undefined)?.kind === "tran";
  if (temporal) {
    const times = simulation.time;
    const override = [
      simulation.sample_index,
      simulation.sample_time,
      simulation.sample_count,
    ].some((value) => value !== undefined);
    const index = override ? simulation.sample_index : times.length - 1;
    const count = override ? simulation.sample_count : times.length;
    const time = override ? simulation.sample_time : times.at(-1);
    const valid =
      Number.isInteger(index) &&
      index! >= 0 &&
      Number.isInteger(count) &&
      count! > 0 &&
      count! <= 6000 &&
      index! < count! &&
      count === times.length &&
      typeof time === "number" &&
      Number.isFinite(time) &&
      time >= 0 &&
      times[index!] === time;
    parts.push(
      valid
        ? `échantillon ${index! + 1}/${count} à t=${time} s`
        : "provenance temporelle indisponible",
    );
  }
  return `${parts.join(", ")}.`;
}

/** Export autonome de la vue actuelle, avec ses styles calculés et sa provenance. */
const properties = [
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "marker-start",
  "marker-end",
  "filter",
  "vector-effect",
  "visibility",
  "display",
];

function localReferences(value: string): string {
  return value.replace(/url\(["']?[^)]*#([^)'"\s]+)["']?\)/g, "url(#$1)");
}

export function serializeSvgView(
  source: SVGSVGElement,
  title: string,
  description: string,
  background = "#101b13",
): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const document = source.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new Error("La vue n’est pas disponible pour l’export.");
  const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  originals.forEach((element, index) => {
    const target = copies[index];
    const computed = view.getComputedStyle(element);
    for (const property of properties) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, localReferences(value));
    }
    target.style.removeProperty("animation");
    target.style.removeProperty("transition");
    target.removeAttribute("tabindex");
    target.removeAttribute("role");
    for (const name of target.getAttributeNames())
      if (/^on/i.test(name) || /^aria-/i.test(name))
        target.removeAttribute(name);
  });
  clone
    .querySelectorAll(
      ".flow-particles,.pending-wire,.marquee-selection,.palette-ghost,.selection-box,.wire-bend-handle,.bb-ghost,.bb-palette-target,animate,animateMotion,animateTransform,script,foreignObject",
    )
    .forEach((element) => element.remove());
  const box = (source.getAttribute("viewBox") || "0 0 900 360")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    box[2] <= 0 ||
    box[3] <= 0
  )
    throw new Error("Dimensions du dessin invalides.");
  const namespace = "http://www.w3.org/2000/svg";
  clone.removeAttribute("xmlns");
  clone.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", namespace);
  clone.setAttribute("width", String(box[2]));
  clone.setAttribute("height", String(box[3]));
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", title);
  clone.style.removeProperty("min-width");
  clone.style.removeProperty("min-height");
  const backdrop = document.createElementNS(namespace, "rect");
  for (const [key, value] of Object.entries({
    x: box[0],
    y: box[1],
    width: box[2],
    height: box[3],
  }))
    backdrop.setAttribute(key, String(value));
  backdrop.setAttribute("fill", background);
  clone.insertBefore(backdrop, clone.firstChild);
  const heading = document.createElementNS(namespace, "title");
  heading.textContent = title;
  const provenance = document.createElementNS(namespace, "desc");
  provenance.textContent = description;
  clone.insertBefore(provenance, clone.firstChild);
  clone.insertBefore(heading, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export function downloadSvgView(
  source: SVGSVGElement,
  title: string,
  description: string,
): void {
  const svg = serializeSvgView(source, title, description);
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  const anchor = source.ownerDocument.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[^\p{L}\d-]/gu, "_").slice(0, 100) || "circuit"}.svg`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
