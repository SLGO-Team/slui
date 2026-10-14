# Implement

1. slui `packages/protocol`: `INSTANCE_END_REASONS`, `InstanceEnded`, `parseInstanceEnded`, `instance.ended`
   in `parseEvent` / `SlgoEvent`; v0 schema + example + README; contract-smoke.
2. slui app: connection endReason, session reducer, snapshot, home status, HUD label; smoke tests; spec.
   `npm run lint`, `npm test`.
3. slgo-backend: IPC schema + fixtures, messages.ts parse, plugin-session -> hub detach reason, hub
   `instance.ended`, tests, ipc README. `bun run lint`, `bun test`.
4. SLGO: constants, exit intent patch, manager wiring, console command, IPC fixture tests, spec.
   `dotnet build`, `dotnet test`.
5. slgo-deploy: slgoctl intent before stop/restart/update, tests, operations.md.
6. Commit each sibling repo on main; slui PR `feat(session): ...`, auto-merge.
