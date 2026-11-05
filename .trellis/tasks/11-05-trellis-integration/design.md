# Design: Trellis integration and main-Session tools

## Boundaries

- `src/infra/trellis.ts` (or `src/app/trellis.ts`): thin adapter around `.trellis/scripts/task.py`.
- `src/app/tools/main.ts`: add `orchestrator_trellis_plan` and `orchestrator_local_dispatch`.
- `src/app/sessions.ts` / `cordis.patch.yml`: add `ask_user_question` to the router preset.
- `prompts/orchestrator.md` (or a new local section): Grill and confirmation rules.
- No Engine changes; dispatch uses `Engine.receive` + `Engine.decide`.

## Trellis adapter

- Constructor takes the local repository path and the main Session id.
- `create({ title, description, prd, design, implement, parent })`:
  - Run `python3 .trellis/scripts/task.py create <title> --slug ... --description ... --no-start [--parent ...]` with cwd = repository.
  - Write `prd.md`, `design.md`, `implement.md` into the returned task dir.
  - Return the task dir and title.
- `start(taskDir)`: run `task.py start --allow-empty-context <taskDir>` with `DSH_SESSION_ID=<masterId>` in the environment, so the main Session owns the active task.
- `current()`: run `task.py current --json` with the same env; return the active task or undefined.
- `archive(taskDir)`: run `task.py archive --skip-branch-validation <taskDir>`; do not intercept its internal auto-commit.
- Validation: repository must exist, contain `.trellis/scripts/task.py` and `.trellis/.developer`; task dir must be under `.trellis/tasks`.
- Errors: return structured `UserError`/tool errors, never fake success.

## Tools

### `orchestrator_trellis_plan`

Input: repository (must match the configured local repo), parent title/description/PRD/Design/Implement, children array (title, description, PRD/Design/Implement, depends_on text).
Behavior:
1. Validate confirmation is explicit (the tool is only called after the main Session has confirmation).
2. Create parent, then children with `--parent`.
3. Write artifacts.
4. Do **not** start tasks or create Tickets.
Output: parent and child task dirs/titles.

### `orchestrator_local_dispatch`

Input: thread id (or derive `local:<masterId>:<slug>`), tasks array (task_dir, title, scope, acknowledgement, worktree_name, note).
Behavior per task:
1. Build a local Trigger with a unique deterministic id (task_dir + thread + timestamp).
2. `engine.receive(trigger)`.
3. `engine.decide(trigger.id, { kind: 'accept', title, scope, reason: { code: 'explicitRouted' }, acknowledgement, name, note })`.
4. Return the Ticket card.
Constraints:
- One Thread per Ticket so fan-out does not leak across Tickets.
- Idempotent: same task_dir + thread + acknowledgement should not create a second Ticket; use the existing Decision/Ticket lookup.
- No Ticket before confirmation: the tool is not called until the plan is confirmed.

## Prompt and preset

- Add `ask_user_question` to the router preset.
- Main Session prompt:
  - For local development requests, clarify material ambiguity with one focused question at a time.
  - Summarize the plan (goal, scope, subtasks, verification, commit) and wait for explicit confirmation.
  - On confirmation, create the Trellis plan, then dispatch one Ticket per child.
  - Do not implement code, do not dispatch before confirmation, and do not create Tickets for dependent children until their prerequisites are ready.
- Keep the existing GitHub/Feishu routing rules.

## Tests

- Adapter: create parent/children, artifacts, start/current/archive with a fake `task.py`; reject missing `.trellis`, missing developer, path escape.
- Tools: plan creates no Tickets; dispatch creates one Ticket per child; duplicate dispatch is idempotent.
- Prompt/model surface: `ask_user_question` present, local rules present.
- Runtime: parent + two children -> two Tickets.
