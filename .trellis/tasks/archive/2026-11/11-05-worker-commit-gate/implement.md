# Implementation Plan: Worker local execution, verification and commit gate

1. **Worktree prepare.**
   - Add a default/example prepare command that creates a git worktree from `DSH_SUPERAGENT_LOCAL_REPO` at `DSH_SUPERAGENT_DIR` on a branch named `DSH_SUPERAGENT_NAME`.
   - Ensure the worker environment includes the local Source variables.
2. **Worker prompt and guard.**
   - Add the local section to `prompts/work.md`.
   - Add a worker bash guard for `git commit`/`git push` (best effort, with a clear refusal message).
3. **Main commit gate.**
   - Add a main-Session bash guard for `git commit`; resolve the target and check `task.py current --json`.
   - Support `WXH_TRELLIS_BYPASS=1`.
   - Do not intercept `task.py archive`.
4. **End-to-end test.**
   - Parent + two independent child tasks; two Tickets; two workers; both run verification; both report ready.
   - Main Session commits one child, archives it, then the other; parent archived last.
5. **Verify.**
   - `pnpm typecheck`, focused tests, `bash scripts/verify.sh`.
   - Report actual results.

## Rollback

- The worktree prepare command is configuration; revert to the previous prepare command to restore non-local behavior.
- The guards are additive; disable them to restore the previous tool surface.
- The prompt section is additive; remove it to restore the GitHub-only worker instructions.

## Actual results (2026-11-05)

- `scripts/prepare-worktree.sh`: added and executable; creates a git worktree from the local Source's environment variables.
- `prompts/work.md`: added the local-ticket rules: read the Trellis task, modify only the worktree, run the verification entrypoint, do not commit/push/PR, report evidence.
- `src/app/sessions.ts`: added `workerCommitGuard` and `commandOf`; a local ticket's worker is refused `git commit`/`git push`; the main Session gets a commit guard.
- `src/infra/trellis.ts`: added `currentSync`, `runSync`, and the pure `trellisCommitGuard`; the main-Session guard requires an in-progress Trellis task and supports `WXH_TRELLIS_BYPASS=1`.
- `src/app/runtime.ts`: wires the main-Session commit guard to the Trellis adapter and the local repository.
- `docs/006-deployment.md`: documented local repository setup, worktree prepare, verification, worker/main-Session commit ownership, and the bypass.
- Tests: `tests/trellis.spec.ts` covers the adapter, main tools, two-task dispatch with separate threads, both commit guards, and `currentSync`.
- `bash scripts/verify.sh`: passed, 60 files / 1215 tests, build completed.
- Limitation: the end-to-end proof covers two Tickets dispatched with separate threads and the existing worker-slot concurrency tests; a live local worker run with real DSH Sessions was not executed in this environment. The wiring and guards are typechecked and unit-tested, but the live local-only runtime path remains to be exercised after a DSH restart.
