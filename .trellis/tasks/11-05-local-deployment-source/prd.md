# Local deployment and local Source

## Goal

Support a local-only deployment and a local Source that turns a confirmed local request into a real Trigger and Ticket.

## Requirements

- Add local repository configuration: absolute path, base branch, verification command, local actor.
- Allow setup to resolve a deployment without GitHub: no `gh` account, no remote repository, no push check. GitHub and Feishu remain optional.
- Validate that the local path exists, is a git repository, and has a `.trellis` directory; report a structured setup problem otherwise.
- Add a `local` Source kind with configuration fields, a minimal allowed-sender policy, health, and execution-environment variables.
- Local requests must enter through `Engine.receive` and an explicit Decision, preserving audit and idempotency.
- Local acknowledgements, results and attention messages must reach the main Session instead of being dropped or sent to an external channel.
- Existing GitHub/Feishu deployments must keep working.

## Acceptance criteria

- [ ] A deployment with only the local repository configured starts and reports ready.
- [ ] A local request creates a local Trigger, a Decision and a Ticket.
- [ ] Local acknowledgement/result/attention messages are delivered to the main Session.
- [ ] Invalid local repository or missing `.trellis` produces a clear setup problem.
- [ ] GitHub-only and Feishu configurations still pass their existing setup and runtime tests.
- [ ] No new external dependency is added.

## Out of scope

- Trellis task creation and main-Session tools (child C).
- Worker worktree execution and commit gate (child D).
- Multi-user local identities.
