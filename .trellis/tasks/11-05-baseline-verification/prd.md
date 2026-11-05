# Baseline stabilization and verification entry

## Goal

Make the current working tree a trustworthy baseline before the local-first work starts, and add the single verification entrypoint the rest of the workflow will use.

## Confirmed facts

- `pnpm typecheck` passes.
- The full suite currently reports 1199 passed and 3 failed out of 1202.
- `tests/deployment.spec.ts` fails because `managementOrigins` was added to `Machine` but the expected object was not updated.
- `tests/environment.spec.ts` fails because the local git prints a localized error; it passes with `LANG=C LC_ALL=C`.
- `tests/sources.spec.ts` Feishu consumer test fails consistently in this environment and is unrelated to the current diff; the fixture writes `[event] ready` to stderr and event lines to stdout, so the final health report depends on stream interleaving.
- The project has no `scripts/verify.sh`; the verification entrypoint is `pnpm check`.

## Requirements

- Fix the `managementOrigins` expectation in `tests/deployment.spec.ts`.
- Make the environment test independent of the host's git locale, without changing product behavior.
- Make the Feishu consumer test assert the malformed-line error deterministically, or explain and fix the ordering assumption in the fixture.
- Add `scripts/verify.sh` that runs the project's actual verification: `pnpm typecheck`, `pnpm test`, and `pnpm build` (or `pnpm check`), in a clean environment where practical.
- Keep the existing GitHub/Feishu behavior unchanged.

## Acceptance criteria

- [ ] `scripts/verify.sh` exists, is executable, and runs the full project verification.
- [ ] `pnpm typecheck` passes.
- [ ] The full test suite passes in this environment, or every remaining failure is proven to be environmental and documented with the command that reproduces it.
- [ ] `pnpm build` passes.
- [ ] The diff contains no product behavior change beyond test stabilization and the verification script.

## Out of scope

- The local-first feature work.
- Broad test refactors or unrelated dependency updates.
- Changing the product's git locale handling.
