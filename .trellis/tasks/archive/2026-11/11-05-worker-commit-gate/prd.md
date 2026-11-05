# Worker local execution, verification and commit gate

## Goal

Run local Tickets in isolated worktrees, require verification evidence, and make the main Session the only committer under an active Trellis task.

## Requirements

- The Ticket directory is a git worktree of the configured local repository; the prepare command uses the local Source's environment variables.
- Workers read the Trellis task artifacts by absolute path, modify only the worktree, and never commit, push, or open a pull request.
- Workers run `scripts/verify.sh` and report the actual command, result, diff summary, and worktree path.
- The main Session can rerun verification in the worktree, review the diff, commit in the target repository, and archive the task.
- Add a main-Session bash guard for `git commit`: require an active Trellis task; `WXH_TRELLIS_BYPASS=1` is the explicit bypass.
- The guard must not intercept Trellis' internal archive commit.
- Prove parallel execution with a parent task and two independent child Tickets.

## Acceptance criteria

- [ ] A local Ticket's worker starts in a worktree of the local repository.
- [ ] The worker reads its Trellis task and modifies only the worktree.
- [ ] The worker runs `scripts/verify.sh` and reports actual evidence.
- [ ] The worker's commit/push attempts are refused.
- [ ] The main Session can commit under an active task and archive the task.
- [ ] A commit without an active task is refused; the bypass works.
- [ ] Two independent child Tickets run concurrently and both reach reviewable results.
- [ ] Existing non-local workflows are unaffected.

## Out of scope

- Changing Trellis' own archive behavior.
- A domain-level dependency graph.
- Merging worker changes automatically without main-Session review.
