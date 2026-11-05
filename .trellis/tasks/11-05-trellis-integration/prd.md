# Trellis integration and main-Session tools

## Goal

Let the main Session run the Grill → plan confirmation → Trellis task creation → Ticket dispatch workflow, using a thin Trellis adapter.

## Requirements

- Add a thin Trellis adapter that can create a task, write `prd.md`/`design.md`/`implement.md`, start a task with the main Session's `DSH_SESSION_ID`, read the current task, and archive a task.
- The adapter must not initialize Trellis, must not read credentials, and must reject paths outside `.trellis/tasks`.
- Add `orchestrator_trellis_plan`: create a parent task and child tasks from confirmed plan artifacts; no Tickets yet.
- Add `orchestrator_local_dispatch`: create one local Trigger and Ticket per child task, with the Trellis task directory in the assignment.
- Add `ask_user_question` to the router preset and update the main Session prompt with the Grill and confirmation rules.
- The main Session must not create a Ticket or start a worker before the user confirms the plan.
- Independent child tasks may be dispatched together; dependent children are dispatched later by the main Session.

## Acceptance criteria

- [ ] The adapter creates a parent and children with the expected artifacts and task metadata.
- [ ] The adapter refuses a target without `.trellis`, a missing developer identity, and a task path outside `.trellis/tasks`.
- [ ] `orchestrator_trellis_plan` creates tasks but no Tickets.
- [ ] `orchestrator_local_dispatch` creates one Trigger/Ticket per child and returns their cards.
- [ ] The router preset exposes `ask_user_question`; the main Session prompt states the confirmation gate.
- [ ] The main Session can create a parent plus two child tasks and dispatch two Tickets.
- [ ] Tests cover the adapter, both tools, and the prompt/model surface.

## Out of scope

- Worker execution details and commit gate (child D).
- Local Source and deployment changes (child B).
- General-purpose plan adapters other than Trellis.
