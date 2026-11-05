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
