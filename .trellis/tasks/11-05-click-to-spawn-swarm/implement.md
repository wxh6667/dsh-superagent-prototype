# Implementation plan: local-only swarm Superagent

## Preconditions

- This plan and the planning summary are explicitly approved. Do not run `task.py start` before that approval.
- Work on a dedicated branch; keep the main workspace clean.
- Back up `~/.dsh/state/superagent/orchestrator.sqlite` and the state directory before any schema migration.
- Run `scripts/verify.sh` first and record the baseline result.
- Restoring the archived master is an operational prerequisite for using Superagent to execute this work; it is not product code.

## Phase 0 — Baseline and safety

1. Record the current schema version (11) and the working-tree state.
2. Back up the state database and confirm the backup opens.
3. Run `scripts/verify.sh`; stop if the baseline fails for a reason unrelated to this task.
4. If the legacy master is still archived, repair it once with the approved state repair (stop `dsh-web.service`, back up `workspace.json`, remove the master id from `archivedSessionIds`, restart) or the UI equivalent; verify “Open master” works. Record this as operational, not product behavior.
5. Keep a rollback note: schema 12 cannot be downgraded in place; restore the backup and the previous build.

## Phase 1 — Domain and persistence

Files:

- `src/core/swarm.ts` (new): `Swarm`, status, budget; pure data.
- `src/core/model.ts`: `Ticket.swarmId?`; keep legacy tickets compatible.
- `src/core/index.ts`: export the Swarm types.
- `src/app/store.ts`: `swarm` table, generated columns, `swarms` repository.
- `src/app/migration.ts`: schema 12, `migrateTo12`, legacy swarm creation, ticket ownership.
- `src/kv.ts`: keep the old master key only for legacy identification.

Steps:

1. Add the `swarm` table and repository methods: get/list/save/active.
2. Add `ticket.swarmId` without rewriting existing JSON; migration assigns existing tickets to a completed `legacy` swarm.
3. Keep the old single master id as legacy metadata; new code must not route through it.
4. Add migration tests for schema 11 -> 12, idempotent reopen, and legacy read-only behavior.

Exit criteria:

- A schema 11 database opens as schema 12 with a legacy swarm and owned historical tickets.
- New tickets can carry a swarm id; old tickets remain readable.
- `pnpm typecheck` and the store/migration tests pass.

## Phase 2 — SwarmManager and session ownership

Files:

- `src/app/swarms.ts` (new): create/list/get/open/finish; master ensure/unarchive; caps.
- `src/app/runtime.ts`: create the manager before Sessions; remove the single master route.
- `src/app/sessions.ts`: replace `SessionsHost.masterId` with `masterFor(swarmId)` and `swarmOf(sessionId)`; relays/notices target the owning master.
- `src/app/tools/main.ts`: resolve the calling swarm; remove global master assumptions.
- `src/app/resources.ts`, `src/app/cards.ts`, `src/app/http.ts`: expose swarm-scoped state; no single `masterId`.

Steps:

1. Make the master session id deterministic: `orchestrator-<swarmId>`, cwd = swarm workspace, title `[swarm] <title>`.
2. `ensure` active swarm masters and unarchive them; completed/legacy swarms never wake.
3. Route relays and notices through the owning swarm; keep worker preset selection and subagent limits.
4. Replace `host.masterId` references in tools/resources/HTTP with a swarm resolver; leave a legacy accessor only for migration.
5. Add tests for two masters, archived-master recovery, and worker/master identification.

Exit criteria:

- Two swarms can have two distinct masters; each relay/notice reaches its own master.
- An archived active master is unarchived on open/startup; a completed master stays asleep.
- No new code path depends on one global master id.

## Phase 3 — Local dispatch, Trellis and worker ownership

Files:

- `src/app/tools/main.ts`: `orchestrator_local_dispatch` sets `trigger.meta.swarmId` and the swarm-scoped thread key; Trellis tools use the calling swarm.
- `src/infra/trellis.ts`: bind to a swarm workspace (constructor or per-call repository).
- `src/executor/dsh.ts`: worker environment/prepare from the ticket's swarm; per-swarm verify.
- `src/app/runtime.ts`: commit guard uses the ticket's swarm repository.
- `src/app/passes.ts`, `src/app/effects.ts`: delivery targets the owning swarm.

Steps:

1. Create the local Trigger with `meta.swarmId` and `thread = local:<swarmId>:<taskDir>`.
2. Create Tickets through the existing Engine decision path; copy `swarmId` from the Trigger.
3. Run `orchestrator_trellis_plan`/`archive` against the swarm repository, not a global local repository.
4. Give each worker its swarm's repository, prepare command and verify entrypoint; keep its own worktree.
5. Make the main-session commit guard resolve the swarm repository and require an in-progress Trellis task.

Exit criteria:

- A swarm's local dispatch creates tickets only in that swarm.
- Two swarms can run independent tasks in separate worktrees; verify commands run and are reported.
- The master commits only its own swarm's work.

## Phase 4 — Local-only removal and prompts

Files:

- Remove GitHub/Feishu Sources and their exports/entries: `src/sources/github*`, `src/sources/feishu*`, `cordis.patch.yml`, `package.json`.
- Remove remote delivery/PR/review/merge paths, remote channel adapters, GitHub/Feishu client pages and settings, remote skills and prompts.
- Rewrite `prompts/orchestrator.md`, `dispatch.md`, `work.md`, `shared.md`, `team/*` for local swarm flow.
- Remove candidate/admission tools and prompts that have no local producer; keep local dispatch and ticket operations.
- Remove or rewrite GitHub/Feishu tests, docs, fixtures and locale strings.

Steps:

1. Delete remote Source registration and package exports; verify the server starts with local only.
2. Remove remote Outbox/Channel and PR/merge delivery; local results go to the owning master.
3. Remove remote-specific prompt sections and skills; add the swarm brief/launcher rules.
4. Keep Engine Decision/Ticket/Assignment/Attention, local Source, worker sessions, worktrees and Trellis.
5. Update docs 001/002/003/006/008 and the module/test tables in 007.

Exit criteria:

- No GitHub/Feishu route, tool, panel page, prompt or skill remains.
- `rg -i 'github|feishu|pull request|merge' src prompts skills cordis.patch.yml package.json` returns only intentional migration notes, if any.
- The local-only server passes typecheck and tests.

## Phase 5 — Launcher, API and client

Files:

- `src/app/http.ts`: `GET/POST swarms`, `GET swarms/:id`, `POST swarms/:id/open`, `POST swarms/:id/finish`; ticket filters by swarm.
- `src/client/route.ts`: add swarm routes; remove the Source tab and single-master header.
- `src/client/index.tsx`, `app.tsx`, new `swarms.tsx` page/components: launcher, New form, active/completed list, Open master, Finish.
- `src/client/locales.ts`: localized copy for brief, launcher, limits and errors.
- Remove `src/client/source.tsx` and remote source settings.

Steps:

1. Superagent opens the launcher; New posts a brief with the active workspace path; the server validates Trellis and creates the swarm.
2. Show active and completed swarms; Open master unarchives the session; Finish refuses while tickets are open.
3. Show the resolved workspace path in the brief; ask only when no workspace is active.
4. Filter execution/trigger views by swarm; keep global settings for models, prompts, deployment and caps.
5. Add client tests for launcher, New validation, open, finish and no-single-master behavior.

Exit criteria:

- A click opens the launcher; New creates a master; existing swarms reopen; Finish archives only completed batches.
- No blank master can be created; no Source page remains.

## Phase 6 — Lifecycle, caps, migration and legacy

Steps:

1. Enforce caps: active swarms, tasks per swarm, global/per-swarm workers, model/tool rounds.
2. Finish requires no open tickets; archive the swarm record and master; keep history read-only.
3. On startup, repair missing/unarchived masters for active swarms only; completed/legacy swarms do not wake.
4. Add health per swarm: master reachability, slots, pending work, verification failures.
5. Add migration/legacy tests and a manual restart test.

Exit criteria:

- No idle active master remains after finish.
- Restart restores active swarms and leaves completed ones asleep.
- Caps reject or queue work with a clear message.

## Phase 7 — Verification and delivery

1. Run `scripts/verify.sh` (typecheck, tests, build).
2. Manual two-swarm smoke: create A and B in the same workspace, dispatch independent tasks, observe two worktrees, run verify, commit, finish A, keep B active.
3. Restart DSH; confirm A is completed/read-only and B's master is restored.
4. Confirm no GitHub/Feishu configuration or remote PR paths remain; historical tickets are read-only.
5. Capture verified lessons in `.trellis/spec`; do not record unverified advice.
6. Update the task check log and archive the Trellis task after the user accepts the result.

## Validation commands

```sh
pnpm typecheck
pnpm test
pnpm build
scripts/verify.sh
```

Manual checks:

- New swarm with an invalid/non-Trellis workspace is refused.
- New swarm without a selected workspace prompts for one.
- Two swarms do not share tickets, master context or worker slots.
- Finish is refused while a ticket is open.

## Risky files and rollback

- `src/app/runtime.ts`, `src/app/sessions.ts`, `src/app/http.ts`, `src/app/store.ts`, `src/app/migration.ts`: shared seams; serialize writes.
- `src/client/route.ts`, `src/client/index.tsx`, `src/client/app.tsx`: route/navigation regressions.
- Schema 12 migration is one-way; restore the database backup and previous build to roll back.
- Removing remote Sources is broad; check imports, package exports and docs after each deletion.
- Master lifecycle changes can strand sessions; test unarchive and restart before completion.

## Parallelization

- Phase 1 must land first; it defines the data contract.
- Phase 2 (runtime/sessions) and Phase 4 (remote removal/prompts) touch different areas but both cross `runtime.ts`; serialize those writes.
- Phase 5 (client/API) can start once the swarm API contract is fixed.
- Phase 3 depends on Phase 2; Phase 6 depends on 2, 3 and 5.
- Do not run parallel writers on `runtime.ts`, `sessions.ts`, `http.ts`, `store.ts`, `migration.ts` or the client route files.

## Definition of done

- All acceptance criteria in `prd.md` pass.
- `scripts/verify.sh` passes; manual two-swarm smoke is recorded.
- A launcher click cannot create a blank master; New requires a brief and workspace.
- Active swarms have recoverable masters; completed swarms are archived and read-only.
- No GitHub/Feishu Source, PR/merge delivery or remote prompt remains.
- Historical tickets are readable but cannot start new work.
