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
