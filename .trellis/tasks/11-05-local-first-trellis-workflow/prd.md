# Local-first Trellis development workflow

## Goal

Make dsh-superagent able to run its multi-ticket development workflow entirely on a local repository, and integrate the Trellis planning/verification/commit workflow so a local user can go from a request to reviewed, verified, committed work without GitHub.

## Confirmed decisions

- Local-first; GitHub and Feishu remain optional Sources.
- The local user talks to the main Session in the DSH GUI; Grill and plan confirmation happen there.
- The main Session creates and owns Trellis tasks; workers execute Tickets.
- Trellis tasks live in the target repository's `.trellis`; workers run in per-Ticket git worktrees of that repository.
- A request may become a parent Trellis task plus N child tasks, each with its own Ticket and worker; independent children run in parallel.
- Worker runs `scripts/verify.sh` and reports evidence; the main Session reviews the diff and commits. Workers do not commit.
- The reference is the workflow skeleton of `wxh-dev-standard` (Grill, plan confirmation, Trellis lifecycle, verification, commit gate), not its global configuration.

## Requirements

- A local-only deployment must start without a GitHub repository, GitHub CLI account, or push access.
- A local request must enter the domain as a real Trigger, producing a Decision and Ticket through the existing Engine contracts.
- Local acknowledgements, results and attention messages must be visible in the main Session.
- The main Session must be able to create a Trellis parent task and child tasks, write their PRD/Design/Implement artifacts, and dispatch one Ticket per child.
- Workers must read the Trellis task artifacts, work only in their Ticket worktree, run the project verification entrypoint, and report actual evidence.
- The main Session must be able to review a worker's diff, rerun verification, commit to the target repository under an active Trellis task, and archive the task.
- The commit gate must refuse a main-Session `git commit` when the target repository has no active Trellis task, unless explicitly bypassed.

## Acceptance criteria

- [ ] A local-only deployment starts with GitHub and Feishu disabled and reports a local repository setup problem only when the local path is invalid or lacks `.trellis`.
- [ ] A local request creates a local Trigger and a Ticket; acknowledgement, result and attention messages reach the main Session.
- [ ] A parent Trellis task and N child tasks are created with the requested plan artifacts; no Ticket is created before the plan is confirmed.
- [ ] Each child task can dispatch its own Ticket and worker; two independent children run concurrently.
- [ ] A worker reads its Trellis task, modifies only its worktree, runs `scripts/verify.sh`, and reports commands, results and diff summary without committing.
- [ ] The main Session can rerun verification, commit under the active task, and archive the child and parent tasks.
- [ ] A `git commit` without an active Trellis task is refused in the main Session; the explicit bypass works.
- [ ] Existing GitHub and Feishu deployments continue to pass their existing tests.
- [ ] `scripts/verify.sh` is the single verification entrypoint and runs the project's actual checks.

## Out of scope

- Removing GitHub/Feishu code or their Sources.
- Cross-source identity mapping or multi-tenant local users.
- A domain-level Ticket dependency graph; dependencies are managed by the main Session and recorded in Trellis task text.
- Replacing the existing Engine, Ticket, Assignment, Attention, or Source contracts.
- Copying `wxh-dev-standard` global instructions, Skills, hooks, or MCP baseline into this repository.

## Risks

- Setup/deployment changes touch the GitHub path; local-only must be an additive branch, not a replacement.
- A worker's worktree does not contain the main repository's untracked `.trellis`; task artifacts are read by absolute path, and only the main Session owns task state.
- Trellis archive auto-commits internally; the commit gate must guard agent `git commit` calls, not intercept Trellis' own commit.
- The current working tree contains an unfinished previous task; baseline stabilization must land first.
