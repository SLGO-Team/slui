# SL voice -> radar speaking (2026-11-17)

CS2 evidence: `archive/2026-11/11-17-minimap-cs2-slui/research/cs2-radar-client-re.md`, section "Speaking icons".
In short, CS2 draws the speaker on a player's icon when all of these hold:

1. this client is playing that player's voice now (last voice data <= 0.2 s ago, level > 0);
2. the server's voice mask lets this client hear that player;
3. the local player is on T or CT (alive or dead) and the player is on the same team (`mp_teammates_are_enemies` 0);
4. the player's icon is a living one (no speaker on a death X or ghost); the local player never gets one.

No game-mode or player-limit check. Spectator team / GOTV / demo: never.

## SL / SLGO voice path (plugin repo, game 14.x decompilation `artifacts/asc-decomp`)

- `VoiceTransceiver.ServerReceiveMessage`: the speaker's module `ValidateSend` picks the send channel
  (`VoiceModule.CurrentChannel`); then for every hub: `ValidateReceive` -> `ReceivingVoiceMessage` (EXILED / LabAPI,
  where SLGO `TeamVoiceManager` blocks or bridges) -> if allowed and the final channel is not `None`,
  `VoiceTransceiver.OnVoiceMessageReceiving(msg, receiver)` fires and the packet is sent to that receiver.
  That static event is the exact counterpart of CS2 conditions 1 + 2: it fires only for packets a receiver really gets,
  after every plugin decision (team routing, observer mutes, warmup bridging). The game's own achievement
  `OnSpeakingTerms` already listens to it.
- Channels (`VoiceChatChannel`): None, Proximity, Radio, ScpChat, Spectator, RoundSummary (SLGO's bridge channel),
  Intercom, Mimicry, Scp1576, PreGameLobby, Scp1507.
- SLGO routing today (`Features/Voice`): team mode = same team only, alive NTF proximity bridged team-wide, SCP keep
  native ScpChat, cross alive/dead bridged inside the team; casual = alive teams separated, alive -> all observers.
  Intercom, Mimicry and Scp1576 are left to the game (Intercom reaches everyone).
- Senders that can be alive and on the radar: humans (Proximity, Radio, Intercom), SCPs (ScpChat, Proximity),
  SCP-079 (ScpChat; speaker ability = Proximity at its camera; the radar draws 079 at its current camera),
  SCP-939 (Mimicry plays back a recorded human voice through the 939).
- Dead senders (Spectator, Scp1576) have no living marker, so they never get a speaker (CS2 rule 4).

## Mapping (confirmed)

- speaking(viewer, player) = `OnVoiceMessageReceiving` delivered a packet from `player` to `viewer` within the last
  0.2 s, the speaker's send channel is a counted one, `player` is alive and on the viewer's match team, viewer is an
  assigned team member (alive or dead), viewer != player.
- Team-less observers, Overwatch and demo replay viewers: no speakers (CS2 Spectator / GOTV).
- Same rule in every profile (CS2 has no casual switch; SLGO has no free-for-all mode).
- Decided 2026-11-17 (user): per-viewer delivery, CS2 visibility, Intercom counts, Mimicry does not (see prd.md).

Minimap frames are already built per viewer at 15 Hz (`SidecarMinimapPublisher`), so a per-marker flag fits; it must
stay out of the `MinimapRevisionTracker` signature.
