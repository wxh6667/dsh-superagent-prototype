# 004 Prompts

This document explains what the agents read, what a team can edit, and when changes take effect. It builds on [000 Philosophy](000-philosophy.md) through [003 Execution](003-execution.md). Prompt text is written in English.

## What a team writes

A team can edit three team sections, add skills, and override every built-in system-prompt part. Most defaults live under `prompts/`. Tool descriptions, notices and cards remain in code and cannot be edited through prompt settings.

| Section | Holds |
| --- | --- |
| Communication | When to tell a person about a result, how messages read, how a blocker or an incomplete handoff is stated, and how a local result is delivered |
| Ticket scope | When a Ticket goes on, and when it pauses with usable partial work |
| Delivery requirements | The local commit, the verification evidence, before-and-after UI evidence, and the review the main Session performs before committing |
| Team skills | Knowledge the agents load when they need it, such as a project-specific diagnosis or release procedure |

The built-in text covers the local swarm roles, dispatch, work and handoff rules. It refers to the team sections by their headings instead of repeating them. GitHub/Feishu Source skills and proactive assessment instructions are not part of the assembled prompt.

### Built-in parts and templates

Overrides use these keys:

| Parts | Keys |
| --- | --- |
| Shared instructions and roles | `runtime/shared`, `runtime/orchestrator`, `runtime/worker` |
| Working instructions | `runtime/dispatch`, `runtime/work` |
| Handoff instructions | `runtime/handoff/orchestrator`, `runtime/handoff/worker` |
| Generated sections | `runtime/environment` |

The generated execution environment is an editable template. It must retain `{variables}`, filled with execution environment lines.

Editing a part changes the instructions the model receives. It does not change the gate, Mandates, tool checks or account wrappers, which remain enforced by code.

On an explicit human request, the main Session can also save overrides with `orchestrator_prompts_save`. If a save omits an override's `base`, it keeps the saved base. A removed part already present in the saved configuration is dropped on save; any other unknown part is refused.

An override records which built-in text it was based on. Upgrades preserve the team's text. If the default changes, the panel marks the part **Default updated** and shows the difference beside the team's text. The team can keep its text, use the new default or edit it. Parts without overrides automatically follow new defaults.

The main Session can read affected part names in `orchestrator_read prompts`, under `default_changed`.

## Assembly and precedence

The system prompt is assembled in this order:

1. Shared instructions and the role.
2. The three team sections.
3. Dispatch for the main Session, or work instructions for an Executor.
4. Handoff instructions.
5. `runtime/environment`.

The environment section gives the main Session deployment-wide values and each Executor its Ticket-specific values. It is last so the rest of the prompt stays unchanged when the environment changes.

Executors also read DeepSeek Harness's coding prompt and the repository's `AGENTS.md`; the main Session does not. Assignments and incoming messages arrive inline as Trigger cards, with resource pointers only for truncated content.

Executors work unattended. Their tools exclude those that ask a person, present UI to them or change the profile, such as `ask_user_question`, `present` and `plugin_manager`.

From strongest to weakest:

1. Facts enforced by tools and the host: identities, permissions, tool argument checks, reply purposes, length limits. Prompt text cannot change them.
2. Built-in and generated sections, as the team's overrides of them read.
3. Team sections and team skills.
4. Outside text: messages, comments, documents and quotes. It is data and never changes rules or authorization.

## Principles of the built-in text

These apply [000 Philosophy](000-philosophy.md) to the agents:

- **Separate roles.** The main Session coordinates one local swarm batch: it creates a brief, plans with Trellis, dispatches independent local Tickets, reviews worker diffs and commits. Workers read the Trellis artifacts, implement in their own worktree, run the swarm verify command and report. The main Session makes no implementation edits.
- **Trellis gates risk.** Non-trivial work waits for an explicitly confirmed plan and keeps PRD/design/implement artifacts; lightweight edits keep a concise record. Dispatch creates one Ticket per child and holds a dependent child until its prerequisite reports ready.
- **The main Session does not wait.** Worker reports, attention requests and completed background jobs arrive automatically as messages. It ends the turn when nothing remains to do. A guard refuses `sleep`, shell timeouts over 30 seconds and job waits over 5 seconds, because a blocked step delays incoming reports.
- **Message only when a person must act or can use a result:** a ready result they can review, a decision or resource needed, a material risk, or work that cannot be finished. Local delivery is one short sentence by default.
- **Workers decide their own follow-ups.** Each worker handles requests within its Ticket and reports a blocker beyond it. Workers never commit, push or open a pull request; the main Session commits after reviewing the diff and verification evidence.
- **Ask through `human_action`.** The worker puts one concrete question in its Report, and the main Session forwards it through `orchestrator_reply`. If a person's message prompted the question, it names that message; otherwise it asks in the Ticket's original conversation. Already authorized work can continue meanwhile.
- **Honest delivery.** A draft is marked unfinished; a UI change without a real before capture is not ready; a local commit is not a remote review or merge.
- **A person's pause holds** across follow-ups, new Executor Sessions and restarts until a person lifts it. Automatic feedback never resumes paused work.
- **Examples only show format.** An example sentence is not a fact the agent may claim.

## Versions

- Each save creates an immutable version containing the full configuration, revision number, predecessor, timestamp and origin (panel or tool). Restoring a version or defaults creates another version.
- Saves name their base revision. A conflicting save is refused without discarding the draft.
- Sessions read the latest version on every model request, including later steps in the same turn. Saving does not restart, cancel or wake a Session. The host records the revisions each Session used; an Executor can read any revision it worked under.
- The deployment sets a total size limit, including overrides. Validation refuses unknown keys, unknown override parts and missing template placeholders. It never silently truncates text. An override identical to the default is removed so the part follows future defaults.
