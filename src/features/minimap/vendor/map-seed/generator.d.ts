import type { GeneratedMap } from "./index";

export function generateFromTemplate(
  template: object,
  seed: number,
  options?: { holiday?: "None" | "Christmas" | "Halloween" | "AprilFools" },
): GeneratedMap;
