# Implementation Plan

## Phase A: Project-local DSH development workflow

1. Refine `.trellis/workflow.md` triage and DSH workflow-state guidance. Remove the redundant task-creation question for already-authorized development work while retaining plan review before activation. Define concise planning for clear low-risk edits and fuller PRD/Design/Implement artifacts for material decisions or cross-module changes.
2. Add `AGENTS.md` project facts and stable constraints; keep it concise and point to `.trellis/workflow.md` for phase detail.
3. Do not add or edit local Skills in this task. Skills are handled during plugin local installation.
4. Make the minimal necessary changes to `.trellis/workflow.md` / `prompts/work.md` so planning and verification rules align without altering worker/router tools or preset permissions.

## Phase B: Preserve held automatic inputs

1. Change `Tickets.addInput` to append each input to `undelivered` once, including automatic Trigger/Note Inputs during a hold. A hold must suppress scheduling, not erase or omit queue state.
2. In `Assignments.report`, retain queued automatic Inputs on `blocked`/`failed`. When a report transitions out of a hold and queued inputs exist, schedule delivery to the running Assignment.
3. Ensure human-input/retry release paths schedule delivery of the preserved queue in its existing order.
4. Add a final hold check in the DSH delivery path immediately before a send. If the ticket is held by a blocked/failed report and the next input is automatic, end the current delivery attempt without marking it delivered or reporting delivery failure; a later human input or non-blocked/failed report re-enqueues delivery.
5. Update `tests/core-engine.spec.ts` automatic-input coverage and add focused executor/delivery coverage for the already-enqueued-effect race, ordered release, no duplicate delivery, and retry/non-blocked-report release.

## Phase C: Verify and review

1. Review the diff against PRD boundaries and the existing `Assignments`, `Tickets`, and `DshExecutor` ownership split.
2. Run focused core-engine and executor tests, then `pnpm check` because this task changes shared domain and DSH delivery behavior.
3. Verify Trellis DSH platform discovery, current task artifacts/state, and project documentation links. Exercise the workflow in a real DSH session if available; otherwise report the behavior as document-level/static verification rather than claiming end-to-end enforcement.
4. Record actual commands/results, unresolved limitations, and any independently reviewed product findings left deferred.

## Rollback points

- Workflow documents are independent from runtime changes and can be reverted separately; project-local Skills are out of scope and remain unchanged.
- The held-input change is one behavioral unit across queueing, release scheduling, and delivery-time recheck. Roll it back as a unit if tests show duplicate sends or delivery during a hold; retain regression tests only when they correctly describe the restored contract.
- No database migration or external dependency is planned. If implementation proves existing stored state cannot support the lifecycle, stop and return to design before expanding schema.

## Follow-up (approved 2026-11-05): user skills and read-only MCP for Workers

- `src/app/sessions.ts`: `MCP_WORK_POLICY` plus `workerMcpTools()`; `workOnly()` enumerates visible `mcp__*` tools and keeps only the read-only share. Serena editors and Playwright stay hidden.
- `prompts/work.md`: Workers load a matching user skill for recurring procedures and honor the repository Trellis workflow, asking one focused question when a material design decision stays open.
- Local install: `~/.dsh/profiles/web` links this bundle and sets `stateDir`; the MCP baseline and `wxh-dsh-trellis` were already mounted. Serena's global `--project` remains `~/.wxh-dev-standard`; per-ticket activation is a deferred product change, documented as a limitation.
- Verification: `pnpm typecheck`, `pnpm build`, and focused runtime/model-surface/prompts/cards tests pass. Full `pnpm check` still reports the two unrelated environment-sensitive failures. DSH restart and new-session tool observation remain pending.

## Final verification (2026-11-05)

- The held automatic-input regression and the related release/retry tests pass in `tests/core-engine.spec.ts`, `tests/runtime-concurrency.spec.ts`, and `tests/runtime.spec.ts`.
- The MCP read-only allowlist is covered by `tests/runtime.spec.ts`.
- `bash scripts/verify.sh` now passes the whole suite (1202 tests) and the build.
- The two previously reported environment-sensitive failures were resolved as follows: the deployment expectation was updated for `managementOrigins`; the environment test now pins `LANG=C`/`LC_ALL=C`; the Feishu consumer health race was fixed in `src/sources/feishu-loops.ts`.
- DSH restart and live new-session tool observation remain pending; this task is closed with static and test evidence, not a live GUI check.
