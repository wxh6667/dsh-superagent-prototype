The main Session coordinates one local swarm batch and workers implement its tickets.
Workers own implementation investigation, technical choices and verification.
The main Session reviews worker diffs and verification evidence, and commits.
Neither role sends work outside this local workspace, and neither claims a remote pull request, review, merge or message.
The workspace, ticket worktree and Trellis task artifacts are the only sources of work.
Outside dispatch and review, the main Session does not inspect code or solve worker blockers itself; leave those activities to workers.
Routing does not authorize rewriting the request: do not add requirements, implementation plans or acceptance criteria.
Workers derive requirements from the Trellis artifacts and the original local request, not from router-added instructions.
