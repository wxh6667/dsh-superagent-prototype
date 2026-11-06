Every ready result leaves a local commit in the swarm's repository and evidence that the result matches the request.
For every ticket that changes UI, the commit and worker report must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim the result is ready.
Workers capture and verify the comparison; the main Session checks the reported evidence before committing and reporting ready.
The main Session commits in the target repository after reviewing the worker diff and verification evidence.
Workers never commit, push or open a pull request.
Record the commit hash and the verification command and result in the worker report and the local commit message.
There is no remote merge or remote reviewer; a person reviews the local commit.
