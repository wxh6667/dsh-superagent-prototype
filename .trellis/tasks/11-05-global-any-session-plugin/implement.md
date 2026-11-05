# Implementation Plan: Global any-session Superagent plugin

## Phase A: Multi-repository local Source

1. Extend `LocalRepoSchema` with `root` and keep `repository` as default.
2. Update `resolveLocalRepository` to validate the root and default; add a repository resolver used by tools:
   - path under root (or exact default);
   - git repository;
   - `.trellis/scripts/task.py` and `.trellis/.developer`.
3. Update `localKind.fields`, `facts` and `environment.values` to use `trigger.meta.repository` when present.
4. Add tests for root/default/outside-root/missing `.trellis`.
5. Configure the local Source root to the user's workspace root and default to this project; disable GitHub for local-only.

## Phase B: Runtime bridge

1. Add `SuperagentBridge` interface on Runtime:
   - `submitLocalRequest({ repository, title, text, acknowledgement, worktreeName, note, originSession })`
   - `planTrellis({ repository, parent, children })`
   - `dispatchTickets({ repository, tasks })`
   - `archiveTrellis({ repository, taskDir })`
   - `commitGuard(execution)`
2. Reuse `Engine.receive` + `Engine.decide` for requests; do not write state directly.
3. Set Trigger meta `{ originSession, repository }`.
4. Reuse `Trellis` with an explicit repository; reuse `DshExecutor` for Tickets.
5. Add `localKind` health reporting in Runtime.

## Phase C: Global plugin and tools

1. Add a global plugin entry (`src/plugin/any-session.ts` or equivalent) inserted by `cordis.patch.yml`.
2. On `agent/created`, decorate non-worker Sessions with:
   - `superagent_local_request`
   - `superagent_trellis_plan`
   - `superagent_local_dispatch`
   - `superagent_trellis_archive`
3. Ensure `ask_user_question` is available in the Session preset; if not, add `tool-ask-user` to the relevant presets.
4. Exclude worker Sessions; add a guard/refusal if called from a worker.
5. Update the main Session prompt so it can use either the existing `orchestrator_*` tools or the bridge tools consistently.

## Phase D: Origin Session routing

1. Outbox local delivery resolves the Ticket's origin Trigger.
2. Deliver to `meta.originSession` when present, else the main Session.
3. Missing/disposed Session returns `waiting`; do not drop.
4. Add a durable fallback notice if the origin Session cannot be resolved after retries.
5. Test ack/result/attention from a normal Session.

## Phase E: Commit guard

1. Resolve repository from `git -C <path>` or an explicit repository.
2. Check `task.py current --json` for that repository and the main Session id.
3. Support `WXH_TRELLIS_BYPASS=1`.
4. Keep the guard best-effort; do not claim OS-level enforcement.

## Phase F: Verification

1. `scripts/verify.sh` full pass.
2. New Session in DSH sees the bridge tools.
3. Normal Session request → local Ticket → worker → result back to the same Session.
4. Multi-repo: two projects under the root; separate Tickets and worktrees.
5. Restart DSH and confirm the plugin loads; report actual outcomes.

## Rollback

- Disable the global plugin row in the profile patch; existing local workflow remains available from the main Session.
- Revert the local Source root/default to the previous single repository.
- The bridge is additive; removing it restores the current `orchestrator_*`-only surface.
- Do not change the Engine/Ticket schema; if a durable origin mapping cannot use Trigger meta, stop and return to design.
