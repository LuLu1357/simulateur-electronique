import type { Op, Project } from "./types";

/** La rotation change le dessin et conserve les identifiants des bornes et fils. */
export function rotationOperations(
  project: Project,
  selected: readonly string[],
  direction: 1 | -1 = 1,
): Op[] {
  return project.components
    .filter((c) => selected.includes(c.id))
    .map((c) => {
      const position = project.schematic[c.id];
      return {
        type: "move_component",
        id: c.id,
        x: position.x,
        y: position.y,
        rotation:
          ((((position.rotation || 0) + 90 * direction) % 360) + 360) % 360,
      };
    });
}
