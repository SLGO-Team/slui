// Keeps the three descriptions of protocol v0 in step: the JSON Schemas (packages/protocol/v0/*.schema.json), the
// TypeScript parsers SLUI runs (src/contracts) and the examples next to them (mapped in protocol-examples.mjs).
// - Every schema is valid draft 2020-12 (Ajv strict about keywords and formats) and is used.
// - Every example has a schema and a parser, and both accept it.
// - The two agree on the example's mutations: each top-level field (of the payload, and of an event's envelope)
//   removed, and an unknown field added. A field the schema requires but the parser does not (or the reverse) shows
//   up here; the intended differences are listed in KNOWN_DIFFERENCES with the reason.
// Usage: node --experimental-strip-types scripts/protocol-schema-check.mjs
import { readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { PROTOCOL_V0_DIR, protocolExample, protocolExampleFiles, readProtocolFile } from "./protocol-examples.mjs";

const schemaFiles = readdirSync(PROTOCOL_V0_DIR).filter((name) => name.endsWith(".schema.json")).sort();
const exampleFiles = protocolExampleFiles();

// Strict about unknown keywords and formats (a misspelt keyword would silently check nothing). Not about style:
// an `if`/`then` branch may require a property its parent defines, and a subschema may use `required` without
// repeating `type: "object"`; both are valid draft 2020-12.
const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, allErrors: true });
addFormats(ajv);
const schemaIds = new Map();
for (const name of schemaFiles) {
  const schema = readProtocolFile(name);
  ajv.addSchema(schema);
  schemaIds.set(name.slice(0, -".schema.json".length), schema.$id);
}
const validate = (schema, value) => {
  const check = ajv.getSchema(schemaIds.get(schema));
  return { ok: check(value), errors: check.errors };
};
// Schemas only ever reached through $ref from others, and the envelope every event uses.
const usedSchemas = new Set(["career-common", "envelope"]);

/**
 * Intended differences between a schema and its parser, by `<schema> <mutation kind>`, with the reason. Anything not
 * listed is a bug in one of them; an entry nothing triggers any more fails the check.
 * - Unknown fields: the schemas say what publishers may send (`additionalProperties: false`); these parsers let
 *   unknown fields through, so additive optional fields reach older clients without breaking them (README
 *   "Match snapshot top-HUD fields", "Shop teammate requests", "Shop refunds").
 * - Vitals visibility is a cross-field rule the schema only describes: without `omniscient`, only the viewer's team
 *   may carry health and loadouts.
 */
const KNOWN_DIFFERENCES = new Map([
  ["match-snapshot unknown field", "additive optional fields (top-HUD, mode family, player limit) reach older clients"],
  ["shop-snapshot unknown field", "additive optional fields (requests, refunds) reach older clients"],
  ["command-result unknown field", "a result may gain fields older clients ignore"],
  ["command unknown field", "SLUI only builds commands; the sidecar enforces the schema"],
  ["control-route unknown field", "the control plane may add route fields older clients ignore"],
  ["route-rejected unknown field", "the control plane may add rejection fields older clients ignore"],
  ["match-snapshot without omniscient", "both teams' vitals need omniscient: a cross-field rule the schema only describes"],
]);

/** Schema verdict (envelope and payload for an event) and parser verdict for a value of the example's shape. */
function judge(how, value) {
  if (!how.event) return { schema: validate(how.schema, value), parser: how.parse(value) };
  const envelope = validate("envelope", value);
  const payload = validate(how.schema, value.payload);
  return { schema: { ok: envelope.ok && payload.ok, errors: [...(envelope.errors ?? []), ...(payload.errors ?? [])] }, parser: how.parse(value) };
}

/** `[label, kind, value]`: each top-level field removed, and an unknown one added (payload and envelope for events). */
function mutations(example, event) {
  const out = [];
  const target = event ? example.payload : example;
  const prefix = event ? "payload." : "";
  for (const key of Object.keys(target)) {
    const copy = structuredClone(example);
    delete (event ? copy.payload : copy)[key];
    out.push([`without ${prefix}${key}`, `without ${key}`, copy]);
  }
  const extra = structuredClone(example);
  (event ? extra.payload : extra).unexpected_field = 1;
  out.push([`with unknown ${prefix}unexpected_field`, "unknown field", extra]);
  if (event) {
    for (const key of Object.keys(example)) {
      if (key === "payload") continue;
      const copy = structuredClone(example);
      delete copy[key];
      out.push([`without envelope ${key}`, `without envelope ${key}`, copy]);
    }
    const extraEnvelope = structuredClone(example);
    extraEnvelope.unexpected_field = 1;
    out.push(["with unknown envelope unexpected_field", "unknown envelope field", extraEnvelope]);
  }
  return out;
}

const failures = [];
const usedDifferences = new Set();
const errorText = (errors) => (errors ?? []).slice(0, 3).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
let mutationCount = 0;

for (const name of exampleFiles) {
  const example = readProtocolFile(name);
  const how = protocolExample(name, example);
  if (!how) {
    failures.push(`${name}: no schema / parser mapping (add it to scripts/protocol-examples.mjs)`);
    continue;
  }
  if (!schemaIds.has(how.schema)) {
    failures.push(`${name}: mapped to ${how.schema}.schema.json, which does not exist`);
    continue;
  }
  usedSchemas.add(how.schema);
  const verdict = judge(how, example);
  if (!verdict.schema.ok) failures.push(`${name}: rejected by ${how.event ? "envelope + " : ""}${how.schema}.schema.json: ${errorText(verdict.schema.errors)}`);
  if (!verdict.parser.ok) failures.push(`${name}: rejected by the parser: ${verdict.parser.error?.message}`);
  if (!verdict.schema.ok || !verdict.parser.ok) continue;
  for (const [label, kind, value] of mutations(example, how.event)) {
    mutationCount += 1;
    const { schema, parser } = judge(how, value);
    if (schema.ok === parser.ok) continue;
    const known = `${how.schema} ${kind}`;
    if (KNOWN_DIFFERENCES.has(known)) {
      usedDifferences.add(known);
      continue;
    }
    failures.push(`${name} ${label}: schema ${schema.ok ? "accepts" : `rejects (${errorText(schema.errors)})`}, parser ${parser.ok ? "accepts" : `rejects (${parser.error?.message})`}`);
  }
}
for (const name of schemaFiles) {
  if (!usedSchemas.has(name.slice(0, -".schema.json".length))) failures.push(`${name}: no example uses it`);
}
for (const key of KNOWN_DIFFERENCES.keys()) {
  if (!usedDifferences.has(key)) failures.push(`KNOWN_DIFFERENCES "${key}" no longer differs: remove it`);
}

if (failures.length > 0) {
  console.error(`protocol schema check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`protocol schema check passed (${schemaFiles.length} schemas, ${exampleFiles.length} examples, ${mutationCount} mutations; ${KNOWN_DIFFERENCES.size} known differences)`);
