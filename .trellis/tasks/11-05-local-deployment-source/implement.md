# Implementation Plan: Local deployment and local Source

1. **Deployment types and setup.**
   - Add local Source config schema and `SETUP_FIELDS` entry.
   - Add local setup problems (`localRepositoryUnset`, `localRepositoryMissing`, `localRepositoryNotGit`, `localRepositoryNoTrellis`).
   - Change `resolveDeployment`/`Setup.resolve` so GitHub is optional and local-only resolves without `gh`.
   - Keep the existing GitHub resolution untouched when GitHub is enabled.
2. **Local Source kind.**
   - Add `src/sources/local.ts` with schema, fields, policy, scope, health, and environment.
   - Register it in the plugin/bundle without changing GitHub/Feishu entries.
3. **Local Outbox delivery.**
   - Add the local delivery callback to `Outbox` and wire it from `Runtime` to `Sessions`.
   - Ensure `waiting` on unavailable session, `sent` on delivery, and no duplicate delivery.
4. **Local Trigger dispatch support.**
   - Expose the local actor/thread helpers needed by the main-Session tool (child C), without adding the tool here.
   - Keep the domain path `Engine.receive` + `Engine.decide`.
5. **Tests.**
   - Deployment local-only / missing `.trellis` / GitHub-only.
   - Local Source scope/policy.
   - Outbox local delivery and retry.
   - Runtime local Ticket creation (may be completed in child C/D if the tool is not ready).
6. **Verify.**
   - `pnpm typecheck`, focused tests, `bash scripts/verify.sh`.
   - Report actual results.

## Rollback

- The local Source registration and config are additive; disabling the Source restores the GitHub-only behavior.
- The setup branch must not alter the GitHub-only path; if it does, revert that branch separately.

## Actual results (2026-11-05)

- `src/deployment.ts`: added `LocalRepoSchema`/`LocalRepo`, `resolveLocalRepository`, and a local branch in `resolveDeployment`; `github` is optional and `repository` is empty for local-only. GitHub-only resolution is unchanged when a remote repository is configured.
- `src/setup.ts` and `src/app/setup.ts`: added local setup problems (`localRepositoryInvalid/Missing/NotGit/NoTrellis`, `localActorNotAllowed`), local Source setup fields, local-only resolution, and the policy check that the configured local actor is allowed.
- `src/infra/environment.ts`: local-only deployments write a failing `gh` shim and omit GitHub credential/url entries from the worker git config; `verifyEnvironment` skips the GitHub credential check when there is no GitHub account.
- `src/infra/commands.ts`, `src/sources/github.ts`, `src/sources/github-channel.ts`, `src/sources/github-pull.ts`, `src/app/runtime.ts`, `src/app/http.ts`, `src/app/tools/executor.ts`: guarded GitHub-only dereferences so local-only deployments do not crash.
- `src/sources/local.ts`: new local Source kind with configuration, fields, policy, health, scope, environment variables and facts; `enabledByDefault: false`.
- `src/sources/kind.ts`/`src/sources/registry.ts`: added `enabledByDefault` and used it when resolving an implicit instance.
- `src/app/runtime.ts`: registers the local kind and delivers local Outbox messages to the main Session (`Sessions.notify` for acknowledgements/results, `Sessions.prompt` steer for attention).
- `src/app/outbox.ts`: local messages bypass `SourceRegistry.send` and use the local callback; unavailable session retries with `Later`.
- Tests: local-only setup and policy check (`tests/deployment.spec.ts`), local Source configuration/environment (`tests/sources.spec.ts`), local Outbox delivery (`tests/outbox.spec.ts`), and local Trigger → explicit Decision → Ticket (`tests/core-engine.spec.ts`).
- `bash scripts/verify.sh`: passed, 59 files / 1207 tests, build completed.
