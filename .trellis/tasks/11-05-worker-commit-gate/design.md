# Design: Worker local execution, verification and commit gate

## Worktree execution

- The Ticket directory is a git worktree of the local repository. The prepare command is configured in `executor.prepare` and uses the local Source's environment:
  - `DSH_SUPERAGENT_LOCAL_REPO`, `DSH_SUPERAGENT_BASE_BRANCH`, `DSH_SUPERAGENT_NAME`, `DSH_SUPERAGENT_DIR`.
- The worker's `cwd` is the worktree. It reads the Trellis task by absolute path from `DSH_SUPERAGENT_LOCAL_REPO/.trellis/tasks/...`.
- The worker must not commit, push, or create a PR. Add a best-effort bash guard that refuses `git commit`/`git push` in worker Sessions; the main-Session commit gate is the authoritative check.

## Worker prompt

- Add a local section to `prompts/work.md` (or a role-specific local section):
  - Read the `Trellis task` path from the assignment.
  - Work only in the worktree.
  - Run `scripts/verify.sh`; report the exact command, exit status, and key output.
  - Report ready with a diff summary and worktree path; do not commit.
  - If the task is missing or verification is unavailable, report blocked with the concrete limitation.

## Main-Session commit

- The main Session receives `ready`; it reads the worktree diff, reruns `scripts/verify.sh`, and commits in the target repository.
- Commit message references the Trellis task.
- Then archive the child task; when all children are done, archive the parent.
- The main Session may use `bash` with `git -C <repo>`; the guard resolves the target.

## Commit gate

- Add a main-Session bash guard that detects `git commit` (including `git -C <path> commit` and `git commit -C`).
- Resolve the Trellis root from the target path; run `task.py current --json` with the main Session's `DSH_SESSION_ID`.
- Deny if there is no `in_progress` task, unless the command carries `WXH_TRELLIS_BYPASS=1`.
- Do not intercept `task.py archive`'s internal auto-commit.
- Keep the guard conservative: unknown parsing must not block unrelated commands; only a recognized `git commit` is checked.

## Verification

- `scripts/verify.sh` is the single entrypoint. The worker runs it in the worktree; the main Session reruns it before commit.
- The main Session reports actual outcomes, not planned checks.

## Tests

- Worktree prepare: local env variables, worktree path.
- Worker guard: commit/push refused.
- Main guard: no active task denied; active task allowed; bypass works; archive commit not intercepted.
- End-to-end: parent + two independent children -> two workers -> two ready reports -> main commits and archives.
