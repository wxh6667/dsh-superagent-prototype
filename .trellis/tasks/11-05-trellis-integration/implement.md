# Implementation Plan: Trellis integration and main-Session tools

1. **Adapter.**
   - Add `src/infra/trellis.ts` with `create`, `start`, `current`, `archive`, validation, and `execFile` calls.
   - Use the main Session id (`masterId`) for `DSH_SESSION_ID`.
2. **Tools.**
   - Extend `MainToolsHost` with the Trellis adapter and local repository settings.
   - Add `orchestrator_trellis_plan` and `orchestrator_local_dispatch` in `src/app/tools/main.ts`.
   - Register them in `mainTools`.
3. **Preset and prompt.**
   - Add `tool-ask-user` to the router preset in `cordis.patch.yml`.
   - Add the Grill/confirmation rules to the main Session prompt (`prompts/orchestrator.md` or a dedicated part).
4. **Tests.**
   - Fake `task.py` fixture and adapter tests.
   - Tool tests: plan/dispatch, idempotency, no-Ticket-before-plan.
   - Prompt/model-surface tests for the new tool and rules.
5. **Verify.**
   - `pnpm typecheck`, focused tests, `bash scripts/verify.sh`.
   - Report actual results.

## Rollback

- The adapter and tools are additive; removing them leaves the existing routing unchanged.
- The router preset addition is a single row; remove it to restore the previous tool surface.
