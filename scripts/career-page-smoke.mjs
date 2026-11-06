// Career page (src/app/home/career): formats, the scoreboard grouping, the HTTP source against the career API's
// answers, and the browser-preview fixtures passing the same strict parsers as live data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCareerMatchDetail, parseCareerMatchList, parseCareerProfile } from "../src/contracts/index.ts";
import { CareerRequestError, HttpCareerSource } from "../src/platform/career.ts";
import {
  careerFailureText, detailStats, formatDecimal, formatDuration, formatPercent, formatShare, formatSwing, headlineStats, matchScore,
  modeLabel, playerName, roundCells, scoreboardTeams, scpRoleLabel, swingTone,
} from "../src/app/home/career/careerModel.ts";
import { CAREER_PREVIEW_PLAYER_ID, readCareerPreview, SampleCareerSource } from "../src/mocks/careerPreview.ts";

const example = (name) => JSON.parse(readFileSync(new URL(`../packages/protocol/v0/${name}.example.json`, import.meta.url), "utf8"));

// Round Swing: signed, one decimal, typographic minus; zero unsigned and untinted; null a dash.
assert.equal(formatSwing(4.2), "+4.2%");
assert.equal(formatSwing(-6.5), "−6.5%");
assert.equal(formatSwing(4.249), "+4.2%");
assert.equal(formatSwing(-0.06), "−0.1%");
assert.equal(formatSwing(11.25), "+11.3%");
assert.equal(formatSwing(0), "0.0%");
assert.equal(formatSwing(0.04), "0.0%");
assert.equal(formatSwing(-0.04), "0.0%", "no negative zero");
assert.equal(formatSwing(null), "—");
assert.equal(swingTone(4.2), "up");
assert.equal(swingTone(-6.5), "down");
assert.equal(swingTone(-0.04), "flat");
assert.equal(swingTone(null), "flat");

assert.equal(formatPercent(0.6667), "67%");
assert.equal(formatPercent(null), "—");
assert.equal(formatDecimal(1.256, 2), "1.26");
assert.equal(formatDecimal(null, 1), "—");
assert.equal(formatShare(1, 3), "33%");
assert.equal(formatShare(0, 0), "—");
assert.equal(formatDuration(190_000), "3:10");
assert.equal(formatDuration(3_725_000), "1:02:05");
assert.equal(modeLabel("competitive"), "竞技");
assert.equal(modeLabel("all"), "全部模式");
assert.equal(modeLabel("ranked_v2"), "ranked_v2", "unknown modes show as sent");
assert.equal(modeLabel(null), "未知模式");
assert.equal(scpRoleLabel("Scp0492"), "SCP-049-2");
assert.equal(scpRoleLabel("Scp173"), "SCP-173");
assert.equal(scpRoleLabel("Crossvec"), "Crossvec");
assert.equal(playerName({ nickname: null, player_id: null }), "匿名玩家");
assert.equal(playerName({ nickname: null, player_id: "76561198000000001" }), "76561198000000001");
assert.equal(matchScore({ score_own: 13, score_enemy: 9 }), "13 : 9");
assert.equal(matchScore({ score_own: null, score_enemy: null }), "—");
assert.equal(careerFailureText("not-found", true).retry, true);
assert.equal(careerFailureText("invalid", true).retry, false, "an incompatible answer does not get better by asking again");

// The protocol examples drive the overview and the scoreboard.
{
  const profile = example("career-profile");
  assert.equal(parseCareerProfile(profile).ok, true);
  const headline = headlineStats(profile.overall);
  assert.equal(headline[0].key, "swing", "Round Swing leads the overview");
  assert.equal(headline[0].value, formatSwing(profile.overall.swing_per_round));
  for (const bucket of ["overall", "ntf", "scp"]) {
    assert.ok(headlineStats(profile[bucket]).every((stat) => typeof stat.value === "string" && stat.value.length > 0), bucket);
    assert.ok(detailStats(profile[bucket]).every((stat) => typeof stat.value === "string" && stat.value.length > 0), bucket);
  }
  const zero = { ...profile.ntf, rounds_played: 0, swing: 0, swing_per_round: null };
  assert.equal(headlineStats(zero)[0].value, "—");

  const detail = example("career-match-detail");
  const teams = scoreboardTeams(detail);
  assert.deepEqual(teams.map((team) => team.side), ["team-a", "team-b"]);
  assert.equal(teams.reduce((sum, team) => sum + team.players.length, 0), detail.players.length);
  assert.ok(teams.every((team) => team.players.every((player) => player.side === team.side)));
  assert.deepEqual(teams.map((team) => team.score), [detail.score_a, detail.score_b]);
  assert.deepEqual(teams.map((team) => team.won), [detail.winner_side === "team-a", detail.winner_side === "team-b"]);
  const ntfSide = detail.rounds.find((round) => round.ntf_side !== null)?.ntf_side;
  if (ntfSide) assert.equal(teams.find((team) => team.side === ntfSide).firstTeam, "ntf", "the first round's NTF side names the starting sides");
  assert.equal(roundCells(detail).length, detail.rounds.length);
  // Without rounds the players' own first_team is used.
  assert.equal(scoreboardTeams({ ...detail, rounds: [] })[0].firstTeam, detail.players.find((player) => player.side === "team-a").first_team);
}

// HTTP source: paths, encoding, parsing and the API's error answers.
{
  const calls = [];
  const respond = (status, body) => async (url) => {
    calls.push(String(url));
    return new Response(body === undefined ? "<html>proxy</html>" : JSON.stringify(body), { status });
  };
  const source = (fetch) => new HttpCareerSource("https://cp.example.com/", { fetch });
  const failureOf = async (promise) => {
    try {
      await promise;
    } catch (error) {
      assert.ok(error instanceof CareerRequestError, String(error));
      return error.failure;
    }
    assert.fail("expected a CareerRequestError");
  };

  const profile = example("career-profile");
  assert.deepEqual(await source(respond(200, profile)).profile(profile.player_id, "all"), profile);
  assert.equal(calls.at(-1), `https://cp.example.com/v0/players/${profile.player_id}?mode=all`);
  await source(respond(200, { ...profile, player_id: "12345@northwood" })).profile("12345@northwood", "casual");
  assert.equal(calls.at(-1), "https://cp.example.com/v0/players/12345%40northwood?mode=casual", "player ids are percent-encoded");

  const list = example("career-match-list");
  await source(respond(200, list)).matches(list.player_id, "competitive", list.next_cursor);
  assert.equal(calls.at(-1), `https://cp.example.com/v0/players/${list.player_id}/matches?mode=competitive&cursor=${list.next_cursor}`);
  await source(respond(200, list)).matches(list.player_id, "all", null);
  assert.equal(calls.at(-1), `https://cp.example.com/v0/players/${list.player_id}/matches?mode=all`);

  const detail = example("career-match-detail");
  assert.deepEqual(await source(respond(200, detail)).match(detail.match_id), detail);
  assert.equal(calls.at(-1), `https://cp.example.com/v0/matches/${detail.match_id}`);

  const count = calls.length;
  assert.equal(await failureOf(source(respond(200, profile)).profile("not an id", "all")), "not-found");
  assert.equal(await failureOf(source(respond(200, detail)).match("../players")), "not-found");
  assert.equal(calls.length, count, "malformed ids never reach the network");

  // A response missing the swing fields is an older or broken server: rejected, not shown with blanks.
  const { swing_per_round: _dropped, ...stale } = list.items[0];
  assert.equal(await failureOf(source(respond(200, { ...list, items: [stale] })).matches(list.player_id, "all", null)), "invalid");
  assert.equal(await failureOf(source(respond(404, { error: "not-found" })).profile(profile.player_id, "all")), "not-found");
  assert.equal(await failureOf(source(respond(429, { error: "rate-limited" })).profile(profile.player_id, "all")), "rate-limited");
  assert.equal(await failureOf(source(respond(503, { error: "unavailable" })).profile(profile.player_id, "all")), "unavailable");
  assert.equal(await failureOf(source(respond(400, { error: "invalid-request" })).profile(profile.player_id, "all")), "invalid");
  assert.equal(await failureOf(source(respond(429)).profile(profile.player_id, "all")), "rate-limited", "a proxy's 429 page still backs off");
  assert.equal(await failureOf(source(respond(502)).profile(profile.player_id, "all")), "unavailable");
  assert.equal(await failureOf(source(async () => { throw new TypeError("Failed to fetch"); }).profile(profile.player_id, "all")), "offline");
  const hanging = new HttpCareerSource("https://cp.example.com", {
    timeoutMs: 20,
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  });
  assert.equal(await failureOf(hanging.profile(profile.player_id, "all")), "offline");
}

// Browser-preview fixtures: everything the sample source serves passes the strict parsers (swing fields included).
{
  const sample = new SampleCareerSource(0);
  for (const mode of ["all", "competitive", "casual", "unknown_mode"]) {
    const profile = await sample.profile(CAREER_PREVIEW_PLAYER_ID, mode);
    assert.equal(parseCareerProfile(profile).ok, true, `profile ${mode}`);
  }
  const first = await sample.matches(CAREER_PREVIEW_PLAYER_ID, "all", null);
  assert.equal(parseCareerMatchList(first).ok, true);
  assert.ok(first.next_cursor, "the sample has a second page");
  const second = await sample.matches(CAREER_PREVIEW_PLAYER_ID, "all", first.next_cursor);
  assert.equal(parseCareerMatchList(second).ok, true);
  const items = [...first.items, ...second.items];
  assert.equal(new Set(items.map((item) => item.match_id)).size, items.length);
  assert.ok(items.some((item) => item.swing_per_round === null), "a match without rounds has no swing");
  assert.ok(items.some((item) => item.swing_per_round > 0) && items.some((item) => item.swing_per_round < 0));
  let details = 0;
  for (const item of items) {
    if (item.status !== "finished") {
      await assert.rejects(sample.match(item.match_id), (error) => error instanceof CareerRequestError && error.failure === "not-found");
      continue;
    }
    const detail = await sample.match(item.match_id);
    const parsed = parseCareerMatchDetail(detail);
    assert.equal(parsed.ok, true, `${item.match_id}: ${parsed.ok ? "" : parsed.error.message}`);
    assert.deepEqual([detail.score_a, detail.score_b], item.side === "team-a" ? [item.score_own, item.score_enemy] : [item.score_enemy, item.score_own],
      "the scoreboard agrees with the match list");
    details += 1;
  }
  assert.ok(details > 10);
  assert.equal(readCareerPreview("?career=sample", false)?.playerId, CAREER_PREVIEW_PLAYER_ID);
  assert.ok(readCareerPreview("", true), "the mock mode shows the sample");
  assert.equal(readCareerPreview("", false), null);
  assert.equal(readCareerPreview("?career=nope", false), null);
}

console.log("career page smoke: ok");
