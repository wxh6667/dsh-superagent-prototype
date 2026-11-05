# Implementation Plan: Baseline stabilization and verification

## Ordered work

1. **Fix the deployment expectation.** Update `tests/deployment.spec.ts` so the expected `Machine` object includes `managementOrigins: []`. Do not change the product config.
2. **Remove the locale dependency from the environment test.** In `tests/environment.spec.ts`, set `LANG=C` and `LC_ALL=C` for the `git` helper used by the failing case (and the `check` subprocess env), so git's error text is deterministic. Do not change product behavior.
3. **Make the Feishu consumer test deterministic.** Inspect `runFeishu`/`consume` ordering. The fixture writes `[event] ready` to stderr and event lines to stdout; the test asserts health `error` after `om_3` appears, but a later ready report can overwrite the malformed-line error. Choose the smallest correct fix:
   - Prefer making the test wait for the health error after the malformed line has been processed, with a bounded `waitFor`, rather than assuming a fixed stream order.
   - If the product's last-writer-wins health behavior is the actual defect, fix `consume` so a malformed event reports an error that a startup ready line cannot overwrite; add a focused assertion.
   - Do not weaken the assertion to accept either state.
4. **Add `scripts/verify.sh`.**
   - `set -euo pipefail`, resolve the repo root from the script path.
   - Run `pnpm typecheck`, `pnpm test`, `pnpm build` (or `pnpm check`) with a deterministic environment: `LANG=C`, `LC_ALL=C`, and unset `GIT_CONFIG_GLOBAL` if it points outside the project (the DSH host sets it for worker shells).
   - Print a clear summary and exit non-zero on any failure.
   - Make it executable.
5. **Verify.**
   - `bash scripts/verify.sh` from the repo root.
   - `pnpm typecheck`.
   - `pnpm vitest run tests/deployment.spec.ts tests/environment.spec.ts tests/sources.spec.ts`.
   - `pnpm build`.
6. **Review.**
   - `git diff` only test stabilization + `scripts/verify.sh`.
   - Confirm no product behavior change beyond the test fixture/health fix, if needed.

## Validation commands

```bash
pnpm typecheck
pnpm vitest run tests/deployment.spec.ts tests/environment.spec.ts tests/sources.spec.ts
bash scripts/verify.sh
pnpm build
```

## Rollback points

- The deployment test expectation is independent and can be reverted alone.
- The environment test env fix is test-only.
- The Feishu fix is test-only unless the product's health ordering is changed; if product code changes, keep it as a separate commit-sized unit and rerun `tests/sources.spec.ts`.
- `scripts/verify.sh` is additive and can be removed without affecting runtime.

## Notes

- The current worktree contains the previous task's uncommitted changes. Do not revert them. Treat them as baseline; only fix the failures listed above.
- Do not commit in this task; the main Session owns commits. Report the actual commands and results.

## Actual results (2026-11-05)

- `tests/deployment.spec.ts`: added `managementOrigins: []` to the expected `Machine` object.
- `tests/fixtures/git.ts`: sets `LANG=C` and `LC_ALL=C` for test git processes; this removes the localized-error dependency without changing product behavior.
- `src/sources/feishu-loops.ts`: tracks `reportedError`; a `[event] ready` line no longer overwrites a malformed-event error, and an event-chain failure also marks the error state. This fixes the stream-order race rather than weakening the assertion.
- `scripts/verify.sh`: added, executable; runs `pnpm check` with `LANG=C`, `LC_ALL=C`, and without DSH's git environment variables.
- `bash scripts/verify.sh`: passed; 59 test files, 1202 tests passed; build completed.
- `pnpm vitest run tests/deployment.spec.ts tests/environment.spec.ts tests/sources.spec.ts`: 89 tests passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed as part of `scripts/verify.sh`.
