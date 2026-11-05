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

## Actual results (2026-11-05)

- `src/infra/trellis.ts`: added the Trellis adapter with `plan`, `start`, `archive`, `current`, injected runner support, path validation, and a safe slug helper.
- `src/app/tools/main.ts`: added `orchestrator_trellis_plan`, `orchestrator_local_dispatch`, and `orchestrator_trellis_archive`; plan creates tasks and starts the parent, dispatch creates one local Trigger/Ticket per child, archive closes a task.
- `src/app/runtime.ts`: constructed the Trellis adapter with the local repository getter and main Session id; exposed `local`, `trellis`, `masterId`, and `receive` to main tools.
- `src/app/sessions.ts` and `cordis.patch.yml`: added `ask_user_question` to the router preset and the main Session's tool allowlist.
- `prompts/dispatch.md`: added the local development rules: Grill, plan confirmation, Trellis creation, independent child dispatch, review/commit, archive.
- `tests/trellis.spec.ts`: adapter and tool tests; `tests/runtime.spec.ts`, `tests/bundle-patch.spec.ts`, `tests/model-surface.spec.ts`, `tests/cards.spec.ts`, `tests/docs.spec.ts` updated for the new tool surface and prompt placement.
- `bash scripts/verify.sh`: passed, 60 files / 1212 tests, build completed.
- Note: `@deepseek-ai/dsh-tool-ask-user` is referenced by the router preset; it is supplied by the DSH profile (the same plugin the reference workflow uses), not added as a package dependency.
