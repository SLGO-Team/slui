<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Git workflow

`main` is protected (see `CONTRIBUTING.md`): no direct or force pushes; every change lands as a
squash-merged PR whose required checks (`build-and-test`, `pr-title`) passed.

- Before the first edit of a task, create a branch `<type>/<slug>` from an up-to-date `main`.
- Phase 3.4 work commits and `/trellis:finish-work` (archive + journal auto-commits) happen on that
  branch, before the PR is merged, so the bookkeeping is squashed into the same PR.
- Then push the branch and open a PR whose title follows Conventional Commits
  (`type(scope): description`); release-please derives versions and the changelog from it.
- Do not ask the user before merging; the required checks are the gate. Right after opening the PR,
  enable auto-merge (`gh pr merge --squash --auto --delete-branch`) so GitHub merges it once CI passes;
  if CI fails, fix it on the branch. After the merge: `git switch main && git pull --ff-only`.
- Exception: release-please's release PR (`chore(main): release X.Y.Z`) batches changes. Leave it
  open (release-please keeps updating it as PRs merge) and merge it only when the user asks for a
  release; publishing the draft GitHub Release stays with the user.
- Never edit version numbers by hand; release-please owns them.
