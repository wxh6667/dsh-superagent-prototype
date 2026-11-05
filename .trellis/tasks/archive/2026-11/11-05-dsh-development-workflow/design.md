# Design: DSH Development Workflow and Held Automatic Inputs

## Goals and boundaries

This task has two independently verifiable outcomes: establish a repository-local development workflow for agents using DSH, and correct the confirmed loss of unread automatic inputs while a worker is waiting for a person.

The workflow is for developing this repository. It does not change GitHub/Feishu request protocols or runtime authorization. Existing `Engine`, `Ticket`, `Assignment`, `Attention`, and Source contracts remain the product-level task system. The project-level Trellis task is the development-time plan only.

## Development workflow layers

- `.trellis/tasks/<task>/` is the sole task plan/state record. PRD is requirements and acceptance; Design is responsibilities/data flow/risks; Implement is ordered work and verification. User confirmation precedes `task.py start` for non-trivial work.
- `.trellis/workflow.md` is the canonical project-specific phase/triage/confirmation rule. Adjust generated text minimally so an already authorized development request does not trigger a redundant question about task creation. Use concise planning for clear, low-risk edits and full artifacts for decisions, cross-module behavior, or elevated risk.
- `AGENTS.md` contains repository facts and stable boundaries. `.trellis/workflow.md` owns the phases, task transitions, and planning rules. Do not add or modify project-local Skills in this task; handle those during plugin local installation.
- `prompts/work.md` carries only worker-specific execution constraints that the current host tools can enforce: use existing `human_action` when a decision is required; pause on material plan drift; report actual checks/evidence. Keep router responsibilities and worker preset permissions unchanged.

## Held-input lifecycle correction

### Current behavior

`automatic` in `src/core/tickets.ts` classifies non-human Trigger Inputs and `note` Inputs. Before this change, `Tickets.addInput` omitted automatic Inputs from `ticket.undelivered` while `waitsForPerson(ticket)` was true, and `Assignments.report` removed queued automatic Inputs when reporting `blocked` or `failed`. The old regression test encoded that loss.

### Intended behavior

Use the existing `ticket.undelivered` list as the one source of delivery eligibility; do not add a second held queue or alter persisted schema.

- Queue automatic Inputs exactly once even while held, but do not schedule their delivery while `waitsForPerson(ticket)` is true.
- Do not filter automatic Inputs out of `undelivered` when reporting `blocked` or `failed`.
- The DSH delivery worker must re-check the hold immediately before sending and leave queued Inputs intact while held. This closes the race where a delivery effect was already queued before the blocked report.
- When the hold clears via a human Input or a later report that is neither `blocked` nor `failed`, schedule delivery of queued Inputs to the current running Assignment. A retry naturally takes the preserved queue into its new Assignment.
- Preserve order: the existing queue order remains authoritative. Automatic Inputs already queued before the hold stay ahead of later human and automatic Inputs. Do not duplicate Trigger Inputs already in the queue.
- Preserve prior delivery semantics: inputs delivered/read before the hold are not added back. Retry's existing `requeueUntaken` remains responsible only for inputs delivered to the replaced Assignment but not read.

The update is internal to `Tickets`/`Assignments` and the DSH executor's delivery gate. Domain tests use the existing Engine harness, and executor tests cover the adapter gate and release path.

## Other review findings

The independent product review also reported a report-vs-retry Assignment race, route `scope` defaulting to title, and duplicate `assignment.started` emission. These are not required for the confirmed held-input defect. Verify each against live code and existing contract during implementation; include a fix only if its reproduction and minimal correction are clear and fit this task. Otherwise keep them out of this change.

## Compatibility and rollback

No database migration or external API change is expected. Existing persisted Tickets already contain `inputs` and `undelivered`; the fix changes when unread automatic IDs are queued and flushed. If targeted tests show duplicate or premature sends, revert the queue/flush behavior as one unit while retaining project workflow documentation. Product and workflow changes can be reviewed separately in the diff.