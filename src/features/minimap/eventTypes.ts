import type { SlgoEvent } from "../../contracts/index.ts";

/** The sidecar events the minimap reads; its reducer ignores every other type (event-routing-smoke checks coverage). */
export const MINIMAP_EVENT_TYPES: ReadonlySet<SlgoEvent["type"]> = new Set<SlgoEvent["type"]>(["sidecar.baseline", "minimap.init", "minimap.positions"]);
