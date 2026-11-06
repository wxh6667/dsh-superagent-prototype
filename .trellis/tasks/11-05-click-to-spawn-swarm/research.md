# Reference analysis: zcode-swarm (Harness 5.0.1)

Source: `/home/gpy/桌面/codes/me-reverse/work/dsh-build/5.0.1/蜂群实现分析.md`

## What it actually is

- A prompt-only plugin: 3 roles (`swarm-scout`, `swarm-worker`, `swarm-validator`), 2 commands, 5 skills; no executable orchestration.
- The host code only registers resources, verifies a file hash manifest, loads role/command/skill text, and stores model overrides.
- Coordination is enforced by instructions, not code: brief fields, write-domain pre-check, branch naming, `swarm/DECISIONS.md`, `swarm/ledger.tsv`, patch-id review, gap handling, cost-adaptive validation, reflection.
- It is single-layer: coordinator → subagents. Subagents cannot spawn further subagents.
- Workers share the main workspace/filesystem; there is no write isolation. Validator is read-only by tool list, but Bash can still write; the real constraint is prompt text.
- Completion is model-written; the ledger has no parser and the verdict is not independently enforced.

## What to borrow

- A swarm starts from an explicit mission/brief, not a blank coordinator: goal, acceptance, scope/write domains, budget, and validation expectation.
- Coordinator/worker/validator separation of concerns, with the validator read-only and independent from the implementer.
- A shared, inspectable state surface: decisions, current unit, completion evidence, gaps, and next action.
- Budget and round limits, including “do not open a swarm when one session can finish it”.
- Post-run reflection: capture lessons into durable project guidance.
- Explicit entry: a user action starts a swarm; it is not inferred from vague chatter.

## What not to copy

- Do not make coordination prompt-only where our host can enforce it.
- Do not let workers share one workspace for concurrent writes; use per-ticket worktrees.
- Do not use a Markdown ledger as the only source of truth; our Tickets, Reports and Trellis artifacts are typed and durable.
- Do not accept a model-written verdict as validation; require actual checks and an independent validator for risky work.
- Do not allow unbounded subagents/swarms; cap workers, rounds, cost and lifetime.
- Do not copy ZCode-specific registration, model-override or UI code; it does not fit DSH.

## Mapping to this project

| Reference mechanism | This project's equivalent | Adaptation |
| --- | --- | --- |
| coordinator | master Session | Keep routing-only; one per swarm |
| unit/worker | Ticket + worker Session | Keep per-task worktree and report |
| scout | read-only subagent or investigation ticket | Optional; do not add a fixed role by default |
| validator | independent verification ticket/subagent | Read-only tools; runs checks; reports gaps |
| brief | swarm brief / Trellis PRD | Typed fields, confirmed before dispatch |
| ledger | Ticket/report state + Trellis artifacts | No parallel Markdown ledger |
| write-domain mutex | per-ticket worktrees + ticket scope | Stronger than prompt pre-check; master resolves overlaps |
| patch-id review | git commit/diff review | Use actual diff and checks |
| DECISIONS.md | Trellis design/PRD + ticket notes | Durable, reviewable |
| reflect | `.trellis/spec` / workspace journal | Capture only verified lessons |

## Implications for click-to-spawn swarms

- A click should create a swarm with a **mission**, not an empty master that waits for an unbound input. The brief is the swarm's reason to exist.
- If every click creates a swarm, each swarm needs a bounded lifetime and a clear completion condition; otherwise the list fills with idle masters.
- The master stays a coordinator. Tasks become Tickets; workers keep isolated worktrees. Validator/scout are optional roles, not new permanent sessions for every task.
- The shared state should be our existing Ticket/Report state plus Trellis, not a new ledger file. A human or master can inspect both.
- Budgets belong to the swarm: max tasks, max concurrent workers, max rounds, time/cost. Global caps remain.
- “Single session can finish it” should be an explicit gate: not every request deserves a swarm.
- The reference's prompt-only design is a warning, not a model: our value is enforcement through the Engine, worktrees, typed reports and verification.

## Resolved question

Q7: Is a click-created swarm a goal-scoped batch (one mission, then archive) or a long-lived workspace hive (many missions over time)? **Resolved: goal-scoped batch (option A).** Long-lived hives are out of scope for this version. This matches the reference's `/swarm <goal>` shape and gives each click a completion condition.
