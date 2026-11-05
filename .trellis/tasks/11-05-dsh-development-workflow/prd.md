# Optimize DSH development workflow

## Goal

Make the dsh-superagent repository's DSH development workflow planning-first and grounded in the maintainer's established practices, while fixing a confirmed product bug where automatic inputs are lost while a worker waits for a person.

## Confirmed facts

- The repository is a TypeScript DSH bundle. `pnpm check` runs typecheck, tests, and build.
- Trellis 0.6.16 supports DSH as a pull-based host. This repository now has the generated DSH entry skills and Trellis task/spec scripts.
- Product code already routes worker questions through `human_action` and `Attention`, pauses delivery while blocked/failed, and resumes when a human message or retry releases the hold.
- `Assignments.report` removes automatic Inputs from `ticket.undelivered` on blocked/failed reports. `Tickets.addInput` does not enqueue automatic Inputs while a hold is active. No path re-enqueues these unread Inputs when the hold clears.
- `tests/core-engine.spec.ts` currently expects pre-hold and during-hold automatic Triggers not to be delivered after a human reply. This conflicts with the execution contract that a human reply releases the hold and leaves the worker with the ticket's relevant inputs.

## Requirements

- Provide a project-local development workflow in `AGENTS.md` and Trellis guidance that makes task planning, Grill-style clarification of meaningful ambiguity, explicit plan confirmation, bounded execution, and evidence-based verification clear. Do not add or modify project-local Skills in this task; handle Skills during plugin local installation.
- Use concise plans for clear, small changes; require fuller PRD/Design for work with unresolved product decisions, material architecture or data boundaries, cross-module behavior, or elevated risk. Do not ask for routine details that repository evidence or sensible defaults settle.
- Pause implementation when a material unanswered question or plan-expanding issue arises; resume only within the newly confirmed plan.
- Preserve the existing DSH product boundary: no new user interaction APIs or changes to GitHub/Feishu request protocols. Runtime human decisions continue through the existing `human_action`/Attention/reply lifecycle.
- Preserve automatic Trigger and Note inputs that have not been read by the worker while the ticket is blocked or failed. Do not deliver them while the hold remains. Once the hold is released by a human input, a non-blocked/non-failed report, or retry, make eligible held inputs available to the current assignment exactly once in the existing order.
- Do not replay automatic inputs that the worker already read. Do not alter human input ownership, ended-ticket behavior, or unrelated input types.
- Keep the current `src/core/assignments.ts` and `src/core/tickets.ts` domain ownership; avoid adding a second persisted held-input queue unless the existing Ticket input/assignment facts cannot represent the lifecycle.
- Review other product-logic findings independently. Include additional runtime changes only when the defect and smallest safe correction are confirmed; otherwise record them as deferred, not silently bundled.

## Acceptance Criteria

- [ ] `AGENTS.md` and `.trellis/workflow.md` describe the planning/clarification/confirmation/execute/verify lifecycle, Trellis task use, risk-based artifact depth, pause-and-replan behavior, and actual evidence requirements.
- [ ] This task adds or modifies no project-local Skills; DSH Skill installation remains part of the later plugin local-installation workflow.
- [ ] A regression test proves unread automatic inputs arriving before and during a blocked/failed hold are not delivered during the hold and are delivered once after release, preserving order.
- [ ] Tests prove already-read inputs are not replayed and retry/non-blocked report release paths do not lose or duplicate held inputs.
- [ ] Existing human follow-up and Assignment lifecycle tests continue to pass; no new runtime interaction tool or Source protocol is introduced.
- [ ] Applicable typecheck/tests/build pass; the final report distinguishes checks actually run from static inspection.

## Out of scope

- Changing GitHub or Feishu business request/response protocols.
- Replacing Admission, Ticket, Assignment, Attention, or Source state models.
- Copying global `wxh-dev-standard` configuration, Claude-only hooks, or global Skills into this repository.
- Adding third-party dependencies or speculative product refactors.

## Risks / deferred findings

- Held Inputs must be scoped to unread automatic inputs and released once; broad replay could duplicate work already taken into the worker's history.
- Independent review also raised a stale worker report vs pending retry Assignment race, a narrow route `scope` contract issue, and duplicate `assignment.started` emission. They are not included unless direct verification demonstrates a clear, in-scope fix that does not compromise the current delivery flow.
