# Global any-session Superagent plugin

> **Status: deferred/cancelled on 2026-11-05.** The user chose to keep only the Superagent main Session entry. This document is retained as a future design reference; nothing in this task was implemented.

## Goal

Add one globally installed DSH plugin that lets any conversation create local Superagent work, routes it through the existing Engine, and returns results to the originating Session. Support multiple repositories without installing anything per project.

## Confirmed decisions

- One global plugin in the `web` profile; no per-project installation.
- Any DSH Session gets the bridge tools; worker Sessions do not, to avoid recursive orchestration.
- The plugin calls a narrow Runtime bridge; it never writes Trigger/Ticket/Assignment state directly and never duplicates the Engine.
- The existing Engine, Trellis adapter, DshExecutor, Policy and Attention lifecycle remain the product state machine.
- A local Trigger records its originating Session and target repository; local replies return to that Session.
- Multiple projects are supported through an allowed workspace root or repository list, with the repository selected per request.
- Projects only need `.trellis` (`trellis init --dsh`) and `scripts/verify.sh`; they do not install the plugin.

## Requirements

- Register a global DSH plugin that decorates every non-worker Session with the bridge tools.
- Bridge tools: submit a local request, create a Trellis parent/child plan, dispatch Tickets, archive tasks, and reuse DSH `ask_user_question` for Grill.
- `superagent_local_request` creates a real `source=local` Trigger with `meta.originSession` and `meta.repository`; it goes through `Engine.receive` and the normal Policy gate.
- The local Source must accept multiple repositories under a configured root (or an explicit allow list), and reject paths outside it or without `.trellis`.
- The worker environment must use the Ticket's repository, not a single global repository; `scripts/prepare-worktree.sh` stays the worktree entrypoint.
- Local acknowledgements, results and attention must be delivered to the originating Session; a missing Session must retry, not silently drop.
- The commit guard must resolve the target repository from `git -C <repo>` (or an explicit repository argument) and require an in-progress Trellis task there.
- The bridge must not expose write tools to worker Sessions, must not bypass the local actor allow list, and must not let a request choose an arbitrary repository outside the configured root.
- A new Session must see the bridge tools; existing Sessions may need a restart or re-decoration.
- The local Source health entry must report `ready` when configured, instead of staying `starting`.

## Acceptance criteria

- [ ] From a normal DSH Session, a user can call `superagent_local_request` with a request and a repository under the configured root, and a local Ticket is created.
- [ ] The local Trigger records the originating Session and repository; the Ticket's worker starts in a worktree of that repository.
- [ ] Worker acknowledgements/results/attention appear in the originating Session.
- [ ] A request for a repository outside the root, or without `.trellis`, is refused with a clear error.
- [ ] The bridge tools are registered on normal Sessions and the main Session, but not on worker Sessions.
- [ ] The existing Engine/Ticket/Assignment/Attention tests continue to pass.
- [ ] A parent Trellis task plus two child tasks can be planned and dispatched from a normal Session; independent children get separate Tickets.
- [ ] The commit guard checks the target repository and supports `WXH_TRELLIS_BYPASS=1`.
- [ ] No per-project plugin installation is required; project prerequisites are documented.
- [ ] `scripts/verify.sh` passes and the DSH restart/new-Session behavior is verified.

## Out of scope

- Replacing the Engine, Ticket, Assignment, Attention or Source contracts.
- A second orchestration state machine or a second Ticket store.
- Cross-user identity mapping beyond the configured local actor.
- Auto-merge or PR creation for local work.
- Removing GitHub/Feishu Sources.

## Risks

- Global tool registration broadens the attack surface; every bridge call must pass the same Policy gate and repository-root check.
- Returning messages to an originating Session needs durable mapping; a disposed Session must retry or surface the failure.
- Multiple repositories make commit-guard path resolution best-effort; a shell wrapper can bypass a text guard.
- Existing Sessions may keep old tool bindings until restarted or re-decorated.
- The current local Source health has no reporter; a stuck `starting` state must be fixed as part of this task.
