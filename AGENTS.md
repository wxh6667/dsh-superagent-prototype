<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Project facts

- This repository is a TypeScript DeepSeek Harness bundle. `pnpm check` runs typecheck, tests, and build.
- Domain behavior lives under `src/core/`; DSH runtime adapters live under `src/app/` and `src/executor/`; bundled agent guidance is under `prompts/`; behavior is covered by `tests/`.
- `Engine` owns Admission, Ticket, Assignment, and Attention state. Preserve those runtime contracts unless the confirmed task explicitly requires a product behavior change.
- DSH Trellis is pull-based and Skills are handled during plugin local installation. `.trellis/workflow.md` is the canonical phase and task-state guide; read its current state and task artifacts before development.
- Use project evidence before asking for details. When a material product, scope, compatibility, data, or acceptance decision remains ambiguous, ask a focused Grill-style question and wait before changing code. Keep ordinary choices with clear, reversible defaults moving.
- Do not start implementation on a non-trivial change until the user has confirmed its PRD/design plan. If implementation discovers a material decision or scope expansion, pause and return to planning.
- Final verification must report actual outcomes and the commands or observable evidence used. Do not describe planned or unrun checks as passed.
