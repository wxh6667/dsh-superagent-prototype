# Design: Local deployment and local Source

## Boundaries

- `src/deployment.ts`: add a local deployment branch. Keep `Machine` unchanged except for local repository fields if they must be volatile. Prefer putting local repository settings in the local Source config, not `Machine`, unless the setup probe needs them.
- `src/app/setup.ts`: resolve local-only deployments without GitHub. GitHub remains the default when its Source is enabled.
- `src/sources/local.ts`: new Source kind. It has no polling loop; triggers arrive from the main-Session dispatch tool.
- `src/app/outbox.ts`: route `channel.source === 'local'` messages to the main Session.
- `src/core` stays unchanged: local requests use `Engine.receive` and `Engine.decide`.

## Deployment shape

- Add a local Source instance with config: `repository` (absolute path), `baseBranch`, `verify` (default `scripts/verify.sh`), `actor` (id/name).
- `Setup.resolve` should:
  - If the local Source is enabled and configured, validate the path (exists, directory, git repo, `.trellis` present). Record a `localRepository*` setup problem on failure.
  - If GitHub is enabled, run the existing GitHub resolution. If GitHub is disabled, do not require `repositoryUnset`, `gh`, or push access.
  - Resolve the local deployment even when GitHub is absent; `Deployment.repository`/`github` become optional or a local variant.
- Keep `SetupError` codes in `src/setup.ts` and add local ones with the `local` place.
- `SETUP_FIELDS` includes the local Source's setup-relevant fields so a change restarts setup.

## Local Source

- `kind: 'local'`, title/description, `health: ['local']`.
- `schema`: repository, baseBranch, verify, actor. Defaults: baseBranch `main`, verify `scripts/verify.sh`, actor `local-user`.
- `fields`: repository (text, absolute path), baseBranch, verify, actor id/name.
- `policy`: minimal `{ allowed: [{ id, name }] }`; default allowed contains the configured actor. `explicit` text explains that a local user's request is explicit.
- `scope`: listened for the configured actor; unlisted actors are not admissible.
- `environment`: `DSH_SUPERAGENT_LOCAL_REPO`, `DSH_SUPERAGENT_BASE_BRANCH`, `DSH_SUPERAGENT_VERIFY`.
- No `channel`: `Outbox` intercepts local messages. `SourceRegistry.send` would return `gone` for a kind without a channel, so the interception must happen before it.

## Local messages

- `Outbox` gains an optional local delivery callback, supplied by `Runtime` from `Sessions`.
- When `message.channel.source === 'local'`, call the callback with the message and return its result; do not call `SourceRegistry.send`.
- The callback formats acknowledgement/result/attention as a notice or steer into the main Session, using the existing `Sessions.prompt`/`notify` and stable request ids for idempotency.
- If the main Session is not available, return `waiting` so the effect retries; do not silently drop.

## Local Trigger

- The dispatch tool creates a Trigger:
  - `source: 'local'`, `threads: [{ source: 'local', id: thread }]`, `actor: { source: 'local', id: actor }`, `human: true`, `addressed: 'direct'`, `text`, `channel: { source: 'local', thread, address: { thread } }`, `meta: { task_dir, repository }`.
- `Engine.receive` stores it and queues it for Eval. The tool then calls `Engine.decide` with an explicit accept, which creates a direct Eval/Ticket. This preserves the Decision audit and idempotency.
- Use one local Thread per Ticket (e.g., `local:<masterId>:<taskSlug>`) so a new Trigger does not fan out to other Tickets.

## Tests

- Deployment: local-only resolves; missing path/`.trellis` fails; GitHub-only still resolves.
- Local Source: scope/policy admits the local actor and refuses others.
- Local Trigger: receive + decide creates a Ticket; duplicate dispatch is idempotent.
- Outbox: local ack/result/attention reaches the main Session; unavailable session retries.
- Runtime: a local request produces a Ticket and a worker launch.
