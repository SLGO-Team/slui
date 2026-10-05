import type { ChatSendCommand, MinimapInit, Role, ServerRoute, SlgoCommand, SlgoEvent, SteamIdentity } from "../contracts/index.ts";
import { MockSidecarConnection } from "../platform/connection.ts";
import { MAX_CHAT_LENGTH, chatLength } from "../features/chat/model.ts";
import { createMinimapFrame, createMockMinimapInit, defaultMinimapPreviewOptions, mockMinimapInit, type MinimapPreviewOptions } from "./minimapFixtures.ts";
import { createHudSceneFrame, hudSceneLoopMs, type HudScene } from "./hudScenes.ts";

export class RealtimeMockProvider extends MockSidecarConnection {
  private readonly initialEvents: SlgoEvent[];
  private readonly viewerTeam: "team-a" | "team-b";
  private previewOptions = { ...defaultMinimapPreviewOptions };
  private mapInit = { ...mockMinimapInit };
  private timer: ReturnType<typeof setInterval> | undefined;
  private streamRoute: ServerRoute | null = null;
  private sequence = 0;
  private frame = 0;
  private revision = 1;
  private generation = 1;
  private attempt = 0;
  private lastChatAtMs = -Infinity;
  private chatIds = 0;
  private hudScene: HudScene = "none";
  private hudSceneRun = 0;
  private hudSceneStartedAtMs = 0;
  /** Debug captures: the scene stays at this moment (ms after its start) instead of playing. */
  private hudSceneAtMs: number | null = null;
  private lastHudPayloads: Partial<Record<"hud.messages" | "round.result", string>> = {};

  constructor(events: SlgoEvent[], viewerTeam: "team-a" | "team-b") {
    super();
    this.initialEvents = events;
    this.viewerTeam = viewerTeam;
  }

  override async connect(route: ServerRoute, identity: SteamIdentity) {
    const attempt = ++this.attempt;
    this.stopStream();
    await super.connect(route, identity);
    if (attempt !== this.attempt) return;
    this.streamRoute = route;
    this.sequence = 0;
    this.frame = 0;
    this.revision = 1;
    for (const event of this.initialEvents) {
      if (event.type === "minimap.init") this.emit("minimap.init", this.mapInit);
      else if (event.type === "minimap.positions") this.publishFrame(false);
      // The scripted scene replaces the fixtures' empty board and panel.
      else if (event.type === "hud.messages") this.restartHudScene();
      else if (event.type !== "round.result") this.emit(event.type, event.payload);
    }
    this.timer = setInterval(() => {
      this.frame += 1;
      if (!this.previewOptions.paused) this.publishFrame();
      // Other traffic continues while positions pause, exercising independent freshness.
      if (this.frame % this.mapInit.position_update_hz === 0) {
        const hud = this.initialEvents.find((event) => event.type === "match.snapshot");
        if (hud) this.emit(hud.type, hud.payload);
        this.tickHudScene();
      }
    }, 1000 / this.mapInit.position_update_hz);
  }

  override async disconnect() {
    this.attempt += 1;
    this.stopStream();
    await super.disconnect();
  }

  configureMinimap(options: Partial<MinimapPreviewOptions>) {
    const next = { ...this.previewOptions, ...options };
    const frameChanged = (["zone", "life", "scoreboard", "paused", "motion", "enemies", "spectate", "dynamicTargets", "lastKnown", "deaths", "keycard"] as const)
      .some((key) => next[key] !== this.previewOptions[key]);
    if (next.life !== this.previewOptions.life || next.enemies !== this.previewOptions.enemies
      || next.lastKnown !== this.previewOptions.lastKnown || next.deaths !== this.previewOptions.deaths
      || next.keycard !== this.previewOptions.keycard) this.revision += 1;
    const bombsitesChanged = next.bombsites !== this.previewOptions.bombsites;
    this.previewOptions = next;
    // Bombsites are static init data: changing them is a new map generation, like the plugin's next round.
    if (bombsitesChanged) {
      if (this.streamRoute) this.rebuildMinimap(this.mapInit.seed);
      else this.mapInit = createMockMinimapInit(this.mapInit.seed, this.mapInit.map_id, next.bombsites);
    }
    if (frameChanged && !next.paused) this.publishFrame();
  }

  rebuildMinimap(seed = this.mapInit.seed === 1062329959 ? 142007 : 1062329959) {
    this.generation += 1;
    this.mapInit = createMockMinimapInit(seed, `map-demo-${this.generation}`, this.previewOptions.bombsites);
    this.revision = 1;
    this.emit("minimap.init", this.mapInit);
    this.publishFrame(false);
    if (this.previewOptions.scoreboard && !this.previewOptions.paused) this.publishFrame();
  }

  invalidateMinimap(kind: "invalid" | "incompatible") {
    this.previewOptions = { ...this.previewOptions, paused: true };
    if (kind === "incompatible") this.emit("minimap.init", { ...this.mapInit, minimap_schema_version: 999 });
    else {
      const payload = this.currentFrame();
      if (payload) this.emit("minimap.positions", { ...payload, all_players: [] });
    }
  }

  getMinimapInit(): MinimapInit { return this.mapInit; }

  /** Plays a scripted hud.messages / round.result scene from its start, or pins it at `atMs` (debug harness). */
  configureHudScene(scene: HudScene, atMs: number | null = null) {
    if (scene === this.hudScene && atMs === this.hudSceneAtMs) return;
    this.hudScene = scene;
    this.hudSceneAtMs = atMs;
    this.restartHudScene();
  }

  private viewerRole(): Role {
    const hud = this.initialEvents.find((event) => event.type === "match.snapshot");
    const team = hud?.type === "match.snapshot" ? hud.payload.teams.find((candidate) => candidate.team_id === this.viewerTeam) : undefined;
    return team?.role ?? "ntf";
  }

  private restartHudScene() {
    this.hudSceneRun += 1;
    this.hudSceneStartedAtMs = Date.now();
    this.lastHudPayloads = {};
    this.publishHudScene();
  }

  /** Once a second, like the plugin's time-only re-sync; a finished scene starts over. */
  private tickHudScene() {
    if (this.hudSceneAtMs !== null) {
      // A pinned moment is re-sent unchanged, so its remaining times never run out on the client.
      this.lastHudPayloads = {};
      this.publishHudScene();
      return;
    }
    const loopMs = hudSceneLoopMs(this.hudScene, this.viewerRole());
    if (loopMs !== null && Date.now() - this.hudSceneStartedAtMs >= loopMs) this.restartHudScene();
    else this.publishHudScene();
  }

  /** Publishes each snapshot whose content changed (the first publish of a run always goes out). */
  private publishHudScene() {
    if (!this.streamRoute) return;
    const elapsedMs = this.hudSceneAtMs ?? Date.now() - this.hudSceneStartedAtMs;
    const frame = createHudSceneFrame(this.hudScene, this.viewerRole(), elapsedMs, this.hudSceneRun);
    for (const [type, payload] of [["hud.messages", frame.messages], ["round.result", frame.result]] as const) {
      const json = JSON.stringify(payload);
      if (this.lastHudPayloads[type] === json) continue;
      this.lastHudPayloads[type] = json;
      this.emit(type, payload);
    }
  }

  /** Answers chat like the plugin's ChatManager: 120 text elements, one second between sends. */
  override async send(command: SlgoCommand) {
    await super.send(command);
    if (command.kind !== "command.chat.send") return;
    const nowMs = Date.now();
    const reason = command.scope === "spectator" ? "不支持的聊天范围"
      : chatLength(command.body.trim()) > MAX_CHAT_LENGTH ? `消息最多允许 ${MAX_CHAT_LENGTH} 个字符。`
        : nowMs - this.lastChatAtMs < 1_000 ? "发送过于频繁，请稍候。" : null;
    if (reason === null) this.lastChatAtMs = nowMs;
    const attempt = this.attempt;
    setTimeout(() => {
      if (attempt !== this.attempt) return;
      // Like the plugin: the delivered message is published before the command's result.
      if (reason === null) this.emitOwnChat(command);
      this.emit("command.result", { command_id: command.command_id, command_kind: command.kind,
        status: reason === null ? "accepted" : "rejected", ...(reason === null ? {} : { reason }) });
    }, 150);
  }

  private emitOwnChat(command: ChatSendCommand) {
    const steamId = this.streamRoute?.steamId;
    const hud = this.initialEvents.find((event) => event.type === "match.snapshot");
    const team = hud?.type === "match.snapshot" ? hud.payload.teams.find((candidate) => candidate.players.some((player) => player.player_id === steamId)) : undefined;
    const player = team?.players.find((candidate) => candidate.player_id === steamId);
    if (!steamId) return;
    this.chatIds += 1;
    this.emit("chat.message", {
      message_id: `mock-chat-${this.attempt}-${this.chatIds}`, scope: command.scope, sender_id: steamId,
      sender_name: player?.display_name ?? steamId, team_id: team?.team_id ?? null, role: team?.role ?? null,
      body: command.body.trim(), sent_at: new Date().toISOString(), command_id: command.command_id,
    });
  }

  private currentFrame() {
    return this.streamRoute ? createMinimapFrame(this.mapInit, this.streamRoute.steamId, this.viewerTeam, this.previewOptions, this.frame, this.revision) : null;
  }

  private publishFrame(scoreboard = this.previewOptions.scoreboard) {
    const payload = this.currentFrame();
    if (payload) this.emit("minimap.positions", { ...payload, scoreboard_visible: scoreboard });
  }

  private emit(type: SlgoEvent["type"], payload: unknown) {
    if (!this.streamRoute) return;
    this.sequence += 1;
    this.receive({
      protocol_version: 0, schema_version: 1,
      event_id: `mock-${this.attempt}-${type}-${this.sequence}`,
      server_id: this.streamRoute.serverId, instance_id: this.streamRoute.instanceId,
      round_id: "round-demo-7", sequence: this.sequence,
      sent_at: new Date().toISOString(), type, payload,
    });
  }

  private stopStream() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.streamRoute = null;
  }
}
