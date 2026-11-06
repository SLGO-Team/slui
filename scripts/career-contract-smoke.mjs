// Career API contract (packages/protocol/v0/README.md "Career API"): the examples parse, the
// parsers reject what the schemas forbid, and player refs must resolve.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAREER_MATCHES_MAX_LIMIT,
  isCareerMatchId,
  isCareerMode,
  isCareerPlayerId,
  parseCareerError,
  parseCareerMatchDetail,
  parseCareerMatchList,
  parseCareerProfile,
} from "../src/contracts/index.ts";

const example = (name) => JSON.parse(readFileSync(new URL(`../packages/protocol/v0/${name}.example.json`, import.meta.url), "utf8"));
const rejects = (parse, value, label) => {
  const result = parse(value);
  assert.equal(result.ok, false, label);
  assert.equal(result.error.code, "invalid-career", label);
};

// Ids.
for (const id of ["76561198000000001", "12345@northwood", "user.name@discord"]) assert.equal(isCareerPlayerId(id), true, id);
for (const id of ["", "7656119800000000", "76561198000000001@steam", "a@b@c", "x/y@discord", "a%40b@discord", "name@", "@discord", "a b@discord"]) {
  assert.equal(isCareerPlayerId(id), false, id);
}
assert.equal(isCareerMatchId("01a19c8f-4f00-7000-8000-00000000bef1"), true);
assert.equal(isCareerMatchId("01A19C8F-4F00-7000-8000-00000000BEF1"), false, "match ids are lowercase");
assert.equal(isCareerMode("competitive"), true);
assert.equal(isCareerMode("../etc"), false);

// Profile.
const profile = example("career-profile");
assert.equal(parseCareerProfile(profile).ok, true, "profile example parses");
assert.equal(parseCareerProfile({ ...profile, nickname: null, first_match_at: null, last_match_at: null }).ok, true, "nullable profile fields");
rejects(parseCareerProfile, { ...profile, rating: 1.2 }, "profile rejects unknown fields");
rejects(parseCareerProfile, { ...profile, overall: { ...profile.overall, kast: 1.5 } }, "kast is a share");
rejects(parseCareerProfile, { ...profile, overall: { ...profile.overall, kills: -1 } }, "counts are non-negative");
rejects(parseCareerProfile, { ...profile, overall: { ...profile.overall, kd: Number.NaN } }, "rates are finite");
assert.equal(parseCareerProfile({ ...profile, overall: { ...profile.overall, swing: -1.25, swing_per_round: -13.89 } }).ok, true, "swing may be negative");
assert.equal(parseCareerProfile({ ...profile, scp: { ...profile.scp, swing_per_round: null } }).ok, true, "swing per round is null without rounds");
rejects(parseCareerProfile, { ...profile, overall: { ...profile.overall, swing: null } }, "swing total is a number");
rejects(parseCareerProfile, { ...profile, overall: { ...profile.overall, swing_per_round: Number.POSITIVE_INFINITY } }, "swing per round is finite");
const { swing_per_round: _omitted, ...withoutSwing } = profile.overall;
rejects(parseCareerProfile, { ...profile, overall: withoutSwing }, "stats need swing per round");
rejects(parseCareerProfile, { ...profile, weapons: Array.from({ length: 11 }, () => profile.weapons[0] ?? { weapon: "Com15", kills: 1, headshot_kills: 0 }) }, "at most ten weapons");
rejects(parseCareerProfile, { ...profile, scp_roles: [{ role: "Scp 173", rounds: 1, rounds_won: 0, kills: 0, deaths: 0, damage: 0, adr: 0 }] }, "role is an identifier");

// Match list.
const list = example("career-match-list");
assert.equal(parseCareerMatchList(list).ok, true, "match list example parses");
assert.ok(list.items.length >= 1);
assert.equal(parseCareerMatchList({ ...list, items: [], next_cursor: null }).ok, true, "an empty last page");
rejects(parseCareerMatchList, { ...list, items: [list.items[0], list.items[0]] }, "a match is listed once");
rejects(parseCareerMatchList, { ...list, items: Array.from({ length: CAREER_MATCHES_MAX_LIMIT + 1 }, (_, index) => ({ ...list.items[0], match_id: `01a19c8f-4f00-7000-8000-${index.toString(16).padStart(12, "0")}` })) }, "at most fifty items");
rejects(parseCareerMatchList, { ...list, items: [{ ...list.items[0], result: "victory" }] }, "known results only");
rejects(parseCareerMatchList, { ...list, items: [{ ...list.items[0], side: "TeamA" }] }, "sides use team ids");
rejects(parseCareerMatchList, { ...list, next_cursor: "" }, "an empty cursor");
assert.equal(parseCareerMatchList({ ...list, items: [{ ...list.items[0], swing_per_round: null }] }).ok, true, "summary swing per round may be null");
rejects(parseCareerMatchList, { ...list, items: [{ ...list.items[0], swing_per_round: "4.2" }] }, "summary swing per round is a number");

// Match detail.
const detail = example("career-match-detail");
assert.equal(parseCareerMatchDetail(detail).ok, true, "match detail example parses");
assert.ok(detail.players.some((player) => player.player_id === null), "the example has an anonymous player");
assert.ok(detail.rounds.some((round) => round.kills.some((kill) => kill.assister !== null)), "the example has an assist");
const withKill = (patch) => ({ ...detail, rounds: detail.rounds.map((round, index) => (index === 0 ? { ...round, kills: [{ ...round.kills[0], ...patch }, ...round.kills.slice(1)] } : round)) });
assert.equal(parseCareerMatchDetail(withKill({ kind: "NewerDeathKind", weapon: "NewerWeapon" })).ok, true, "pass-through enums accept new values");
rejects(parseCareerMatchDetail, withKill({ killer: detail.players.length }), "kill refs resolve");
rejects(parseCareerMatchDetail, withKill({ assister: null, assist_source: "damage" }), "assist source needs an assister");
rejects(parseCareerMatchDetail, { ...detail, players: detail.players.map((player, index) => (index === 0 ? { ...player, ref: 5 } : player)) }, "refs equal their index");
rejects(parseCareerMatchDetail, { ...detail, rounds: [...detail.rounds].reverse() }, "rounds increase");
rejects(parseCareerMatchDetail, { ...detail, rounds: detail.rounds.map((round) => ({ ...round, mvp: 99 })) }, "MVP is a player");
assert.ok(detail.players.some((player) => player.swing_per_round < 0), "the example has a negative swing");
rejects(parseCareerMatchDetail, { ...detail, players: detail.players.map((player, index) => (index === 0 ? { ...player, swing_per_round: Number.NaN } : player)) }, "player swing per round is finite");

// Errors.
assert.equal(parseCareerError(example("career-error")).ok, true);
for (const error of ["invalid-request", "not-found", "rate-limited", "unavailable"]) assert.equal(parseCareerError({ error }).ok, true, error);
rejects(parseCareerError, { error: "teapot" }, "known error codes only");

console.log("career contract smoke: ok");
