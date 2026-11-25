// Which schema and which SLUI parser each packages/protocol/v0 example belongs to. Shared by contract-smoke (every
// example parses) and protocol-schema-check (schemas, parsers and examples agree). An example this cannot place is a
// failure in both, so a new example needs its row here.
import { readdirSync, readFileSync } from "node:fs";
import {
  parseCareerError,
  parseCareerMatchDetail,
  parseCareerMatchList,
  parseCareerProfile,
  parseClientFeatures,
  parseCommand,
  parseEvent,
  parseRoute,
  parseRouteRejected,
  parseRouteRequest,
  parseSessionChallenge,
  parseSessionOpen,
  parseSessionProof,
  parseUpdateManifest,
} from "../src/contracts/index.ts";

export const PROTOCOL_V0_DIR = new URL("../packages/protocol/v0/", import.meta.url);
export const readProtocolFile = (name) => JSON.parse(readFileSync(new URL(name, PROTOCOL_V0_DIR), "utf8"));
export const protocolExampleFiles = () => readdirSync(PROTOCOL_V0_DIR).filter((name) => name.endsWith(".example.json")).sort();

// Sidecar event type -> payload schema (the envelope itself is envelope.schema.json).
export const EVENT_PAYLOAD_SCHEMAS = {
  "match.snapshot": "match-snapshot",
  "minimap.init": "minimap-init",
  "minimap.positions": "minimap-positions",
  "shop.snapshot": "shop-snapshot",
  "hud.messages": "hud-messages",
  "round.result": "round-result",
  "hud.status": "hud-status",
  "hud.spectating": "hud-spectating",
  "team.menu": "team-menu",
  "hud.killfeed": "hud-killfeed",
  "scoreboard.snapshot": "scoreboard-snapshot",
  "instance.ended": "instance-ended",
  "replay.state": "replay-state",
  "replay.catalog": "replay-catalog",
  "command.result": "command-result",
};
// The route example expires in 2026-08; parse it as of a moment before that.
const ROUTE_NOW = Date.parse("2026-08-18T00:00:00Z");
// Messages that are not sidecar events, by `type`.
const MESSAGES = {
  "session.open": ["session-open", parseSessionOpen],
  "session.challenge": ["session-challenge", parseSessionChallenge],
  "session.proof": ["session-proof", parseSessionProof],
  "client.features": ["client-features", parseClientFeatures],
  "control.route.request": ["route-request", parseRouteRequest],
  "control.route.resolved": ["control-route", (value) => parseRoute(value, ROUTE_NOW)],
  "control.route.rejected": ["route-rejected", parseRouteRejected],
};
// Examples without a type field, by file name.
const BY_FILE = {
  "career-error.example.json": ["career-error", parseCareerError],
  "career-match-detail.example.json": ["career-match-detail", parseCareerMatchDetail],
  "career-match-list.example.json": ["career-match-list", parseCareerMatchList],
  "career-profile.example.json": ["career-profile", parseCareerProfile],
  "update-manifest.example.json": ["update-manifest", parseUpdateManifest],
};

/**
 * `{ schema, parse, event }` for an example (by file name and content), or null when it fits no row. `schema` is the
 * file name stem of the payload's (or message's) schema; for a sidecar event (`event` true) the envelope is
 * envelope.schema.json and `parse` is `parseEvent` on the whole envelope.
 */
export function protocolExample(name, example) {
  if (BY_FILE[name]) {
    const [schema, parse] = BY_FILE[name];
    return { schema, parse, event: false };
  }
  const type = example.type ?? example.kind;
  if (typeof type === "string" && EVENT_PAYLOAD_SCHEMAS[type] && "payload" in example) {
    return { schema: EVENT_PAYLOAD_SCHEMAS[type], parse: parseEvent, event: true };
  }
  if (typeof type === "string" && MESSAGES[type]) {
    const [schema, parse] = MESSAGES[type];
    return { schema, parse, event: false };
  }
  if (typeof example.kind === "string" && example.kind.startsWith("command.")) return { schema: "command", parse: parseCommand, event: false };
  return null;
}
