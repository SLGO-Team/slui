import { findGameLogProof } from "../contracts/index.ts";
import type { CommandInvoker } from "./desktop.ts";

// The sidecar's game-log proof (protocol v0 "Game-log proof"): when SLUI's address
// does not match the game connection, the plugin prints a one-time challenge to the
// player's game console, the game writes it to Player.log, and SLUI answers with what
// it finds there. Only the challenge line is used; nothing else is kept or sent.

export type GameLogProofReader = {
  /** Where the game log ends now; a challenge is searched in what is written after it. */
  mark(): Promise<number>;
  /** The nonce of `challengeId` written after `mark`, or null when it does not appear within `timeoutMs`. */
  find(mark: number, challengeId: string, timeoutMs: number): Promise<string | null>;
};

/** Complete lines from `offset` on (src-tauri/src/game_log.rs); a rewritten log restarts at 0. */
export type GameLogSource = {
  size(): Promise<number>;
  read(offset: number): Promise<{ offset: number; text: string }>;
};

export const GAME_LOG_POLL_MS = 100;

export function createGameLogProofReader(
  source: GameLogSource,
  options: { pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): GameLogProofReader {
  const pollMs = options.pollMs ?? GAME_LOG_POLL_MS;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    mark: () => source.size(),
    async find(mark, challengeId, timeoutMs) {
      const deadline = now() + timeoutMs;
      let offset = mark;
      for (;;) {
        const chunk = await source.read(offset);
        const nonce = chunk.text ? findGameLogProof(chunk.text, challengeId) : null;
        if (nonce !== null) return nonce;
        offset = chunk.offset;
        if (now() >= deadline) return null;
        await sleep(pollMs);
      }
    },
  };
}

export function tauriGameLogSource(invoke: CommandInvoker): GameLogSource {
  return {
    size: () => invoke<number>("game_log_size"),
    read: (offset) => invoke<{ offset: number; text: string }>("game_log_read", { offset }),
  };
}
