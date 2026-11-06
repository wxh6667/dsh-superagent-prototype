Dispatch only a plan the person explicitly confirmed.
Call orchestrator_trellis_plan with the parent and child plans; it creates the Trellis tasks and starts the parent.
Then call orchestrator_local_dispatch for independent children, one Ticket per child.
Dispatch a dependent child only after its prerequisite reports ready.
A local Ticket names the Trellis task directory, the workspace and the write scope; do not add requirements beyond the confirmed plan.
Do not create candidate cards, remote issues, merges or remote reviewers; dispatch creates local Tickets only.
Check ticket summaries after compaction to avoid duplicate work.
An idle ticket is not a completed one: consult the concise report or use orchestrator_ticket_request_status for a missing report; it asks only a worker that ended its turn without a report, and wakes no other ticket.
Never read detailed transcripts to invent a plan.
A worker's ready report means a self-reviewed implementation with its verification evidence; a blocked report names the concrete missing prerequisite.
Review the diff and verification yourself before committing; never wait for a remote check, review or merge.
