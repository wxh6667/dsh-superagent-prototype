# Design: Local-only goal-scoped Swarm Superagent

## 1. Principles

- Local-only: no GitHub/Feishu Source, no PR/Issue/review/merge delivery, no remote identity.
- A swarm is a goal-scoped batch: one mission brief, one master Session, many tasks, archive on completion.
- The launcher is the entry: Superagent opens the swarm list; New creates a swarm; no blank master.
- The master routes, plans, reviews and commits. Each Task/Ticket has one worker Session with its own worktree.
- Trellis gates risk, not every line: non-trivial tasks keep PRD/design/implement, checks and commit review; lightweight tasks keep a concise record.
- Enforce isolation, ownership, budgets and completion in the Engine/tools/persistence, never only in prompt text.

## 2. Target architecture

```text
Superagent entry
  -> Swarm launcher (active | completed)
       -> New swarm (brief + current workspace)
            -> Swarm record
            -> Master Session (router)
                 -> Trellis parent + children
                 -> Ticket per task
                      -> Worker Session in its own worktree
                      -> scripts/verify.sh
                 -> master review + commit
       -> Open swarm -> its master
       -> Finish swarm -> archive record + master
```

## 3. Domain model

New `Swarm` aggregate (`src/core/swarm.ts`):

```ts
interface Swarm {
  id: string
  title: string
  mission: string                 // goal and acceptance
  workspace: string               // absolute local path, bound at creation
  verify: string                  // default scripts/verify.sh
  prepare: string                 // per-swarm worktree command
  budget: { maxTasks: number; maxWorkers: number; maxRounds: number }
  status: 'active' | 'completed'
  masterSessionId: string          // orchestrator-<swarm id>
  createdAt: string
  completedAt?: string
  legacy?: true                    // historical rows only
}
```

- `Ticket.swarmId?: string`: new local tickets must have one; legacy tickets keep the field absent and are read-only.
- Local Trigger `meta.swarmId` and thread key `local:<swarmId>:<taskDir>`: one local request belongs to exactly one swarm.
- `Decision`/`Ticket` creation stays in the Engine; local dispatch passes the calling swarm.
- No second orchestrator state machine: Swarm is an ownership/lifecycle aggregate around existing Tickets.

## 4. Persistence and migration

- Schema 12: add `swarm` table and optional `ticket.value.swarmId`; keep existing ticket JSON compatible.
- `Store` gains `swarms` repository methods (`get/list/save/active`).
- `migrateTo12`: create a `legacy` swarm with `status: 'completed'`, `legacy: true`, no master; assign existing tickets to it for read-only display. No remote data migration.
- Remove GitHub/Feishu Source entries from stored settings; keep settings history intact. Do not rewrite historical remote conversations.
- Backup `orchestrator.sqlite` before migration; schema migration is one-way, so rollback restores the backup and the previous build.
- The old single `KV.runtime.masterId` is kept only for legacy identification; new code never uses it as a routing target.

## 5. Runtime and session ownership

New `SwarmManager` (`src/app/swarms.ts`) owns swarm persistence and master Sessions:

- `create(brief, workspace)`: validate the workspace is a Trellis repo, save the Swarm, ensure its master, return the Swarm.
- `list()`, `get(id)`, `finish(id)`: finish requires no open tickets; marks completed and archives the master.
- `open(id)`: ensure the master exists, unarchive it if DSH archived it, return its Session id.
- `masterFor(swarmId)`: deterministic `orchestrator-<swarmId>`; title `[swarm] <title>`; cwd is the swarm workspace.
- `swarmOf(sessionId)`: master registry; `swarmOf(ticket)`: `ticket.swarmId`.
- On startup, ensure masters for active swarms only; completed/legacy swarms never wake.

`SessionsHost` replaces `masterId` with `masterFor(swarmId)` and `swarmOf(sessionId)`:

- relays and notices target the owning swarm's master;
- the router/worker preset decision uses the swarm registry, not one id;
- `decorate` binds tools to the calling swarm;
- subagent limits remain as today.

`Runtime` creates `SwarmManager` before `Sessions`; `masterId` is removed from tool hosts, resources, HTTP and client state.

## 6. Local-only execution

- Keep the local Source as the only Source kind; its actor/admission remains the local allow list.
- Move repository/verify/prepare from the old global local config to each Swarm. The local Source no longer chooses one repository.
- `orchestrator_local_dispatch` resolves the calling swarm, sets `trigger.meta.swarmId`, and creates one Ticket per child task. `orchestrator_trellis_plan` and `orchestrator_trellis_archive` use a `Trellis` bound to that swarm's workspace.
- Worker environment and prepare command come from the ticket's swarm; each worker runs in its own worktree and reports actual `scripts/verify.sh` results.
- The master commits after reviewing the worker diff; workers never commit/push.
- Remove GitHub/Feishu Sources, PR/Issue/review/merge delivery, remote channels, remote prompts and skills. Keep Engine Decision/Ticket/Assignment/Attention as the local execution state.
- Remove candidate/admission tools and their prompts because no remote candidate producer remains; local dispatch calls the Engine directly. Keep ticket status, retry, stop, note and reply tools that still serve local work.
- Rewrite `prompts/orchestrator.md`, `dispatch.md`, `work.md`, and the team sections for local swarm flow; remove remote delivery, PR, merge and remote identity text.

## 7. Launcher and panel

- Superagent entry opens the swarm launcher, not a session.
- New form: mission, acceptance, validation expectation, budget; workspace path is pre-filled from the active workspace and shown; if no workspace is active, ask.
- Launcher lists active swarms and completed history; actions: Open master, Finish/Archive, view tickets.
- Swarm detail reuses execution/trigger views filtered by `swarmId`; remove the Source page and the single-master header.
- New management routes: `GET/POST swarms`, `GET swarms/:id`, `POST swarms/:id/open`, `POST swarms/:id/finish`; ticket views accept a swarm filter.
- Open master unarchives the session first; an archived active master is a recoverable error, not a dead end.
- Settings remain global defaults (models, max workers, prompts, deployment); swarm-specific repository/verify/prepare live on the Swarm.

## 8. Remote removal map

Mandatory removals:

- `src/sources/github*.ts`, `src/sources/feishu*.ts`, their plugins, exports, `cordis.patch.yml` entries, tests and fixtures.
- GitHub/Feishu client pages, source settings, remote labels/search, PR/review/merge delivery, remote prompts and skills.
- Remote admission and candidate tools that have no local producer; keep local dispatch and ticket operations.
- Remote docs and module/test lists that describe GitHub/Feishu behavior.

Keep:

- Engine Decision/Ticket/Assignment/Attention, local Source, worker sessions, worktrees, Trellis, verification, local delivery to the master.
- Historical local tickets as legacy read-only data; no remote migration.

## 9. Lifecycle, limits and failure handling

- A new swarm requires a brief and a valid Trellis workspace; otherwise creation fails before a master exists.
- Active swarm masters are ensured and unarchived on open/startup; completion archives the master; no idle active masters.
- Caps: max active swarms, max tasks per swarm, global max workers plus a per-swarm cap, max model/tool rounds; reject creation or queue work at the cap.
- Finish requires zero open tickets; otherwise the launcher explains what remains.
- Startup repairs missing masters for active swarms; a completed/legacy swarm is read-only.
- After finish, capture verified lessons in `.trellis/spec`; never record unverified advice as guidance.
- Health is per swarm: master reachability, worker slots, pending tasks, verification failures.

## 10. Testing

- Store/migration: schema 11 -> 12, legacy swarm, ticket ownership, idempotent migration.
- SwarmManager: create/list/open/finish, invalid workspace, cap enforcement, master unarchive.
- Local dispatch: trigger swarmId, thread key, ticket swarmId, Trellis plan per swarm, worker worktree/verify.
- Isolation: two swarms do not share tickets, settings, master context or worker slots.
- Removal: no GitHub/Feishu routes, prompts, tools or panel entries; historical tickets read-only.
- Client: launcher list/new/open/finish; no single-master header; route parsing.
- End-to-end: two swarms with independent tasks; finish one, keep the other active.

## 11. Rollout and rollback

- Deliver behind a branch; back up `orchestrator.sqlite` and the state directory before migration.
- Run `scripts/verify.sh` (`pnpm check`) after each phase; manual two-swarm smoke before merge.
- Rollback: restore the database backup and the previous build. Schema 12 cannot be downgraded in place.
- Do not delete historical tickets or remote settings history; retire entries, keep read-only data.

## 12. Deferred

- Long-lived per-workspace hives.
- Multi-repository swarms.
- Optional scout/validator roles and cross-model verification beyond a read-only validation ticket.
- Remote Sources, PR delivery and remote identity.
