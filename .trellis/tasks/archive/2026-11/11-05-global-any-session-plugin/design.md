# Design: Global any-session Superagent plugin

## Boundaries

- New global plugin: `src/plugin/any-session.ts` (or `src/app/bridge-plugin.ts`), mounted by the bundle patch once.
- Runtime bridge: a narrow interface on `Runtime` exposing `submitLocalRequest`, `planTrellis`, `dispatchTickets`, `archiveTrellis`, `commitGuard`.
- Existing owners stay unchanged: Engine writes Triggers/Tickets/Assignments; Trellis adapter writes task files; DshExecutor runs workers; Outbox writes receipts.
- Local Source: extend `LocalRepoSchema` with `root` (allowed workspace root) and keep `repository` as an optional default.
- Worker environment: `localKind.environment.values` chooses `trigger.meta.repository` when present, else the configured default.
- Message routing: local Trigger meta carries `originSession`; Outbox's local delivery resolves the Ticket's origin Trigger and sends to that Session.

## Global plugin lifecycle

- The plugin is inserted by `cordis.patch.yml` once, like the GitHub/Feishu Source plugins.
- On `agent/created`, it decorates every agent whose Session is not a worker Session (no Ticket id) with bridge tools.
- It registers a disposer per agent; re-decoration replaces the previous registration.
- Worker Sessions are excluded: their `ticketOfSession` is defined, and exposing bridge tools would allow recursive work.
- The main Session is included; it keeps its existing `orchestrator_*` tools and gains the bridge tools (or the bridge tools are the same implementations with different names).

## Bridge tools

| Tool | Purpose |
| --- | --- |
| `superagent_local_request` | Validate repository, create a local Trigger (`source=local`, `human=true`, `addressed=direct`, `meta.originSession`, `meta.repository`), call `Engine.receive`, then `Engine.decide` explicit accept; return the Ticket card. |
| `superagent_trellis_plan` | Create parent/child Trellis tasks in the selected repository, write artifacts, start the parent. |
| `superagent_local_dispatch` | Create one local Trigger/Ticket per child task; repository from the plan; separate Thread per child. |
| `superagent_trellis_archive` | Archive a completed task in its repository. |
| `ask_user_question` | Reuse DSH's built-in tool for Grill; ensure the Session's preset includes `tool-ask-user`. |

Tool inputs include `repository` (absolute path). The bridge validates:
- repository is under the configured `root` (or in the explicit allow list);
- repository is a git repository with `.trellis/scripts/task.py` and `.trellis/.developer`;
- the caller is a human-originated Session, not a worker;
- the local actor is in the Policy allow list.

## Multi-repository support

- `LocalRepoSchema`:
  - `root`: absolute workspace root, optional; if set, any git repository below it with `.trellis` is allowed.
  - `repository`: optional default repository for callers that omit `repository`.
  - `baseBranch`, `verify`, `actor`, `actorName` as today.
- The Source's `environment.values`:
  ```
  repository = trigger?.meta.repository ?? config.repository
  DSH_SUPERAGENT_LOCAL_REPO = repository
  ```
- `Trellis` adapter methods take a repository argument or derive it from the task directory by walking to `.trellis/tasks`.
- The commit guard resolves `git -C <repo>` or an explicit repository; if absent, use the configured default. It checks `task.py current --json` with the main Session id.

## Message return

- Local Trigger meta: `{ originSession: <session id>, repository: <abs path> }`.
- Outbox local delivery:
  - find the Ticket (message.ticketId);
  - read its origin Trigger;
  - if `meta.originSession` exists, deliver there;
  - else fall back to the main Session.
- Delivery uses the existing `Sessions.prompt`/`notify` idempotency keys; a missing Session returns `waiting` so the reply effect retries.
- The originating Session must be a normal Session; worker Sessions are never targets.

## Security

- The bridge never accepts an arbitrary actor. It uses the configured local actor; the local Source Policy allow list must contain it.
- Repository root/allow-list checks happen before Trigger creation and before Trellis operations.
- Worker Sessions do not get bridge tools.
- The bridge does not bypass `Engine.receive`/`decide`; every request is a real Trigger/Decision.
- The commit guard is best-effort, not an OS sandbox; document that wrappers can bypass it.

## Health

- The local Source currently claims a `local` health entry but never reports it. Runtime should set it to `ready` when `setup.deployment.local` exists and `paused`/`starting` when disabled or waiting for setup.
- This fixes the panel's stuck `starting` state.

## Tests

- Plugin registration: normal/main Session gets tools; worker does not.
- Request: repository under root creates Trigger/Ticket; outside root / no `.trellis` refused.
- Origin: worker ack/result/attention lands in the originating Session; disposed Session retries.
- Multi-repo: plan/dispatch for two repositories; per-Ticket `DSH_SUPERAGENT_LOCAL_REPO`.
- Commit guard: `git -C repo commit` checks that repo; bypass works.
- Local health: ready after setup, paused when off.
- Existing runtime/engine tests unchanged.
