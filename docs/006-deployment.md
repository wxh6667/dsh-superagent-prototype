# 006 Deployment

Use this guide to install, configure and operate the local-only dsh-superagent swarm. It covers the launcher, the Local Source, startup checks, upgrades and troubleshooting, building on [001 Domain model](001-domain.md) through [005 Panel](005-panel.md).

## What it needs

- DeepSeek Harness 0.2.1-alpha.2 or later, and a model provider configured there.
- A local git repository that has already been initialized with Trellis (`trellis init --dsh`). The Local Source requires its absolute path, and its `.trellis` directory.
- `git` 2.32 or later, and `git-lfs` when the repository uses Git LFS.
- No external account, CLI or network service: the bundle mounts only the Local Source. Node.js 22.19 or 24 and pnpm 11.7 are needed only to build from source.

## Install the bundle

Add `dsh-superagent` to a DeepSeek Harness profile as a bundle. [examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) is a starting point; replace every `<placeholder>`:

```yaml
- id: dsh-superagent
  name: dsh-superagent
  config:
    stateDir: /home/me/.dsh/state/superagent
```

`stateDir` is the only required setting. While dsh-superagent runs, the directory holds:

| Path | Holds |
| --- | --- |
| `orchestrator.sqlite` | Domain records, settings history and prompt versions |
| `backups/` | A timestamped copy of the database made before each schema migration |
| `worker-bin/` | Shims for commands the Executor may not run |
| `worker-gitconfig` | The isolated git configuration workers use |
| `work/` | Ticket directories and worktrees, unless the Executor sets another directory |

Only a change of `stateDir` remounts the plugin; the limits in the plugin configuration apply without a restart.

After upgrading a profile that still mounts the previous remote-source bundle, restart the profile once. Startup copies the database to `backups/`, migrates it to schema 13, removes records of the removed Sources, creates a legacy Swarm for historical Tickets, and mounts only the Local Source. Historical Tickets remain read-only.

## Configure the Local Source

Open **Superagent → Settings → Sources** and fill the **Local** card:

| Field | Meaning |
| --- | --- |
| `repository` | Absolute path of the git repository that contains `.trellis` |
| `baseBranch` | Branch a Ticket worktree is created from; `main` by default |
| `verify` | Verification entrypoint a worker runs in its worktree; `scripts/verify.sh` by default |
| `actor` | Identity of the local requester; it must also be in the Policy allow list below |
| `actorName` | Display name of the local requester |

The Local Source is off until this card is saved and the Source switched on. Saving the Source restarts setup, which validates the path: it must be an absolute directory, a git repository, and contain `.trellis`. A local request only becomes a Ticket when its `actor` is listed under **Policy → Local**.

The launcher reads the local repository as its default workspace. A swarm may name another registered workspace, and each Ticket runs in a worktree created from that workspace.

### Execution environment

A Ticket's prepare command and worker Session read these variables:

| Variable | Owner | Meaning |
| --- | --- | --- |
| `DSH_SUPERAGENT_DIR`, `DSH_SUPERAGENT_NAME`, `DSH_SUPERAGENT_TICKET` | Executor | The Ticket's directory, short name and id |
| `DSH_SUPERAGENT_BLOCKED_COMMANDS` | Executor | Commands the worker must not run, separated by spaces |
| `DSH_SUPERAGENT_LOCAL_REPO` | Local Source, or the swarm | Absolute path of the repository the Ticket works on |
| `DSH_SUPERAGENT_BASE_BRANCH` | Local Source, or the swarm | Base branch of the Ticket's worktree |
| `DSH_SUPERAGENT_VERIFY` | Local Source, or the swarm | Verification entrypoint the worker runs |

See [003 Execution](003-execution.md) for the worker environment and handoff rules.

## Run it

Start the service with the bundled script:

```bash
scripts/dsh-superagent start     # starts the profile in tmux and waits for it to answer
scripts/dsh-superagent status    # one line per part, and each setup problem
scripts/dsh-superagent stop
scripts/dsh-superagent restart
```

`start` prints the profile URL. Open it, then **Superagent** in the sidebar or the Plugin Manager. The launcher is the first page. A new swarm takes a mission and a workspace; its master Session plans the work with Trellis, dispatches one local Ticket per confirmed task, and reviews the workers' reports.

## Worker environment

The Executor writes `worker-bin/` and `worker-gitconfig` before it runs a worker:

- `worker-bin/` holds one failing shim per blocked command. `git` is a worker command and cannot be blocked. The shims are removed when the setting no longer lists them.
- `worker-gitconfig` replaces the operator's global and system git configuration. It sets `user.useConfigOnly`, clears credential helpers, and defines the Git LFS filters. A worker's git never prompts for credentials and does not read the operator's identity; the prompt tells the worker which identity to commit with. Personal settings such as an HTTP proxy do not apply.
- Workers have no `gh` or `lark-cli` shim. They use the shell, file tools and the local repository only.

## Panel and management API

The panel reads `/orchestrator/api/…` on the same loopback server. `GET state` returns:

- `setup`: the machine limits, and `problem` (`null`, or a setup problem with `place`, `code`, `values` and `detail`).
- `health`: one entry per part, with `state` (`starting`, `ready`, `paused` or `error`), `detail` and `at`.
- `load`: the Executor Sessions `running`, Tickets `queued` and `maxWorkers`.
- `paused` and `masterId`.

Settings are saved by block: `policy`, `eval`, `executor`, `pause`, or `source:local`. A save names the revision it edits; a stale revision is refused with 409. Only the panel may change the Executor's shell paths, prepare command, blocked commands, or a Source's account and repository fields.

```bash
api=http://127.0.0.1:3082/orchestrator/api
rev=$(curl -s -H 'x-orchestrator-request: 1' "$api/settings" | jq '.sources[] | select(.id == "local") | .revision')
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  "$api/settings/source:local" -d "{\"revision\": $rev, \"value\": {\"enabled\": true, \"config\": {\"repository\": \"/home/me/src/widgets\"}}}"
```

### Settings keys

- `sources.local`: `{"enabled": true, "config": {"repository": "/abs/path", "baseBranch": "main", "verify": "scripts/verify.sh", "actor": "local-user", "actorName": "Local user"}}`.
- `policy`: `{"rules": […], "sources": {"local": {"allowed": [{"id": "local-user", "name": "Local user"}]}}}`. Work only starts for a listed actor. The admission table remains in the schema for other Source kinds but the Local Source uses only the allowed list.
- `eval`: accept mode, timeout and model for proactive assessments. The local product has no proactive producer; explicit local requests are routed by the main Session.
- `executor`: worker model, `maxWorkers`, ticket directory, prepare command and blocked commands.

## Startup checks and health

Setup resolves the Local Source and records a `SetupError` problem; while a problem exists the launcher and workers wait, but the panel remains usable so the operator can fix it.

| Health entry | Reports |
| --- | --- |
| `runtime` | The Runtime and its passes |
| `evals` | Evals that could not complete in the last hour |
| `models` | Model budget retries |
| `worker` | The Executor's worker launches |
| `launch`, `delivery`, `relay`, `notice`, `reply` | Effect kinds that failed three times in a row |
| `local` | The Local Source |

A part that reports `error` is shown on the Overview and by `scripts/dsh-superagent status`, which exits non-zero for it. A setup problem is reported with the place that fixes it and exits `3` while the service waits.

## Backups and upgrades

Before migrating a database from schema 12 or earlier, `Store` copies it to `<stateDir>/backups/<name>-<timestamp>.sqlite`; a failed copy refuses the migration and leaves the database unchanged. Migration runs in one transaction, so a failure leaves the schema and data as they were.

To restore, stop the service, copy the chosen backup over `orchestrator.sqlite` (and remove `-wal`/`-shm` files if present), then start again. Backups are not deleted automatically.

Databases older than schema 10 are refused; start with a new state directory. A database of a newer schema is refused too.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `The local Source names no repository.` | Set the repository on the Local card and save |
| `The local repository must be an absolute directory` | Use an absolute path |
| `The local repository does not exist` | Create the directory or correct the path |
| `The local repository is not a git repository` | Run `git init` there |
| `The local repository has no .trellis directory` | Run `trellis init --dsh` there |
| `The local actor … is not in the local Source's allowed list` | Add the actor under Policy → Local |
| `… was not written by dsh-superagent` | Move the foreign file out of `worker-bin/` or `worker-gitconfig`, or choose another state directory |
| `Preparing the agent environment failed` | Check the state directory's permissions and free space |
| A prepare command fails | Run it in the worktree as the worker does; check `DSH_SUPERAGENT_*` values |
| No model answers | Configure a model provider in DeepSeek Harness and select the Eval and Executor models |

Logs are written by the DeepSeek Harness profile; `scripts/dsh-superagent` writes its own log beside the profile's state and keeps the newest files.
