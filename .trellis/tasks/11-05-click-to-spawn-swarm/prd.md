# Local-only swarm launcher Superagent

## Goal

Make Superagent local-only: clicking the Superagent entry opens a swarm launcher, and starting a new swarm creates and opens a goal-scoped batch with one master Session; each task gets its own worker Session. A swarm ends with its mission. Remove the remote GitHub/Feishu Sources and PR/Issue delivery, while keeping local git worktrees and Trellis. Plan the change through Trellis before implementation.

## Reference

The zcode-swarm implementation was reviewed as a design reference only; see `research.md`. It is a prompt-only coordinator/worker/validator system: mission brief, write-domain pre-check, ledger, independent-looking validator, budgets and reflection, with no executable orchestration. We borrow those coordination ideas, but keep this project's Engine, per-ticket worktrees, typed reports and verification instead of Markdown-only enforcement.

## Confirmed facts (repository evidence)

- A deployment currently has one fixed master Session: its id is derived from the state directory and persisted (`src/app/runtime.ts:107`), and startup ensures only that one master (`src/app/runtime.ts:239`).
- Router behavior is hard-wired to that single master: relays and notices target `host.masterId` (`src/app/sessions.ts:147`), preset selection compares against it (`src/app/sessions.ts:170`), the management API returns one `masterId` (`src/app/http.ts:115`), and the panel has one “Open master” action (`src/client/app.tsx:134`).
- Local Trigger threads embed `host.masterId` (`src/app/tools/main.ts:363`); resources also default to it (`src/app/resources.ts:304`).
- A Ticket has no swarm or owner field (`src/core/model.ts:277`); tickets are deployment-global.
- Settings, Sources, Policy and Executor configuration are deployment-global (`src/policy.ts:99`); Source instances are keyed by kind id.
- Each Ticket already gets its own Executor Session and directory (`docs/003-execution.md:25`), with a default concurrency of 3 (`src/policy.ts:93`).
- The local Source is enabled for this repository and uses `scripts/verify.sh`; the GitHub Source is off. The current master Session is still in DSH's archived set, so “Open master” still fails with `not-listed` (`src/navigation.ts:18`).

## User decisions

- D1 (resolved, revised): Clicking Superagent opens the swarm launcher, not a new master. The launcher lists active and completed swarms, and its New action creates a swarm. The earlier “every click creates a master” decision is superseded.
- D2: Each swarm has one master Session; each task gets its own worker Session.
- D3 (resolved): Local-only. Remove the remote GitHub/Feishu Sources and PR/Issue delivery; keep local git worktrees and Trellis.
- D4 (resolved): A New-created swarm is a goal-scoped batch: one mission, one master, multiple tasks, archive when the mission is complete. Long-lived per-workspace hives are out of scope for this version.
- D5 (resolved): A new swarm binds to the current workspace automatically. The brief shows the target path; only when no workspace is selected does the flow ask for one.
- D6 (resolved): Trellis is mandatory for non-trivial tasks (PRD/design/implement, verification and commit review); lightweight local edits keep a concise record. Every swarm still requires a brief.
- D7 (resolved): Remove the remote Source configuration and entry points. Keep historical tickets and references read-only; do not migrate remote data.

## Requirements

- R1: Clicking the Superagent entry opens the swarm launcher; its New action creates a new goal-scoped swarm with a new master Session and opens that master.
- R2: The launcher lists active and completed swarms; an active swarm can be reopened, and a completed one archives. Clicking must not create an unbound or unreachable orphan.
- R3: The master is routing-only; task execution happens in per-task worker Sessions with isolated context and worktrees.
- R4: Remove the remote GitHub and Feishu Sources, PR/Issue/review/merge delivery, and their panel, prompt, tool and test entry points.
- R5: Execution is local-only. A new swarm binds to the current workspace automatically; the brief shows the target path, and only a missing workspace triggers a prompt. Each worker runs in its own git worktree and uses `scripts/verify.sh`.
- R6: Trellis gates risk, not every line: non-trivial tasks use Trellis artifacts, independent verification and master review; lightweight tasks keep a concise record. Every swarm still requires a brief.
- R7: Multiple swarms may coexist. Each swarm owns its own tickets and master; local requests in one swarm do not create work in another.
- R8: Lifecycle safeguards: a master cannot silently disappear through archiving; swarm creation is bounded and reversible; worker concurrency and model cost are capped.
- R9: Remove remote Source configuration and entry points; retain historical tickets and references read-only; do not migrate remote data; leave no dead panel or prompt paths.
- R10: Swarm creation collects a brief: goal, acceptance, local workspace, write scope, validation expectation and budget.
- R11: Coordination state uses Ticket/Report and Trellis artifacts; optional scout/validator roles use enforced tool restrictions and independent context, not prompt-only discipline.
- R12: Budgets and gates: do not open a swarm when one session can finish it; cap swarms, tasks, concurrent workers and rounds; capture verified lessons into `.trellis/spec`.

## Acceptance criteria

- [ ] Clicking Superagent opens the launcher; New creates a distinct master Session with a visible swarm identity and opens it.
- [ ] Existing active swarms can be reopened from the launcher; completed swarms appear in the archive and do not remain as idle masters.
- [ ] Creating a swarm from a workspace binds that path; the brief shows it, and no separate workspace picker appears in the normal flow.
- [ ] With no selected workspace, creation asks for one instead of creating an unbound master.
- [ ] A second New creates a second swarm; both can be listed and reopened; neither is an orphan.
- [ ] Each task in a swarm creates one worker Session; master context does not include worker transcripts.
- [ ] Two swarms can process independent local tasks without sharing tickets, settings, or master context.
- [ ] There is no GitHub or Feishu Source entry in the panel, no PR/Issue delivery path, and no remote identity requirement.
- [ ] Non-trivial tasks have Trellis artifacts and verification; lightweight tasks have a concise record; the full PRD/design/implement set is not forced on trivial edits.
- [ ] Each worker runs in its own worktree, executes `scripts/verify.sh`, and reports actual results; the master commits after review.
- [ ] The old fixed-master path and GitHub/Feishu configuration are retired with no dead entry points; historical tickets remain read-only and no remote data is migrated.
- [ ] A swarm cannot be created without a mission brief; an empty New-created master is refused.
- [ ] A swarm supports multiple tasks within one mission and archives when its completion condition holds; it does not remain an idle master indefinitely.
- [ ] Risky work gets an independent validator/check path; a model-only verdict is not accepted as completion.
- [ ] Swarm/task/worker/round budgets are enforced, and the “single session is enough” gate is observable.
- [ ] Tests cover click-to-create, reopen, isolation, worker launch, local request routing, cleanup, and the absence of remote delivery.

## Out of scope

- GitHub and Feishu Sources; PR publication, review, merge and remote Issue/comment delivery.
- Remote identity mapping, multi-machine execution, and remote conversation delivery.
- Cross-user or multi-tenant isolation beyond the local operator.
- Long-lived per-workspace hives and a persistent swarm that outlives its mission; these can be a later mode.
- Migrating historical remote conversations or remote data; historical local tickets remain read-only.

## Open questions

None. All blocking product decisions are resolved; implementation details belong in `design.md` and `implement.md`.

## Risks

- Unbounded swarm creation increases model calls, context memory and operational cost.
- Without a binding and a launcher, New-created masters become unreachable orphans.
- Removing remote delivery drops the GitHub authorization and review/merge semantics; local review and commit must replace them.
- Local git worktrees preserve isolation but require prepare/cleanup and can conflict if a swarm uses the same branch.
- The single-master assumptions are spread across Runtime, Sessions, HTTP, Resources and the panel; this is a substantial refactor, not a UI-only change.
- The current master is archived, and the existing unarchive attempt did not take effect; master lifecycle needs an explicit repair/guard.
- Automatic workspace binding can target the wrong project if the user switched context; the brief must show the resolved path before any worker starts.
- A prompt-only swarm protocol would repeat the reference's weakness: write domains, validation and completion would be unenforced. The design must keep those checks in the Engine, tools, worktrees and typed reports.
