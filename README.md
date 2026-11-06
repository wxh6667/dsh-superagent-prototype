# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.

dsh-superagent is a local-only coding swarm bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). Clicking **Superagent** opens a launcher. From there you create a goal-scoped swarm with a short brief; the swarm owns one master Session and opens one worker Session per task.

Workers run in isolated git worktrees, use the repository's own `scripts/verify.sh`, and coordinate through Tickets, typed reports and Trellis task artifacts. The master plans with Trellis, dispatches independent local tasks, reviews the diffs and verification evidence, and commits. Only the Local Source is mounted; earlier GitHub and Feishu records are purged by the schema 13 migration, and pull-request delivery is retired.

The launcher and the local Source are the product surface. The Source tab shows only the Local Source: its repository, base branch, verification command and local actor. The launcher pre-fills the workspace from that Source; a missing workspace is the only reason to type one.

## Setup

Use [docs/006 Deployment](docs/006-deployment.md), **Local repository** section: point the Local Source at a git repository initialized with Trellis, set its verification command, add the local actor to the Policy's local allowed list, and configure the worktree `prepare` command.

The profile needs a model provider. It does not need a GitHub account or a Feishu bot.

## Documentation

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md)
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md)

## Development

`pnpm check` runs the typecheck, the tests and the build. `scripts/verify.sh` is the repository's full verification entrypoint.

## License

[MIT](LICENSE)
