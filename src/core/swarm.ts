/** Swarm domain data: a goal-scoped batch owning its tickets, master Session and budget, independent of persistence. */

/** Lifecycle of a swarm: work may be dispatched while active; a completed swarm is read-only history. */
export type SwarmStatus = 'active' | 'completed'
/** Caps a swarm's work: tasks it may open, workers it may run at once, and coordination rounds it may take. */
export interface SwarmBudget { maxTasks: number; maxWorkers: number; maxRounds: number }
/** A goal-scoped batch: one mission brief, one master Session, and the tickets created under it. */
export interface Swarm {
  id: string
  title: string
  /** The goal and acceptance the master coordinates against. */
  mission: string
  acceptance?: string
  scope?: string
  /** Absolute local workspace path the swarm is bound to at creation. */
  workspace: string
  /** Command each worker runs to validate its work. */
  verify: string
  /** Command run per worker before its work starts. */
  prepare: string
  budget: SwarmBudget
  status: SwarmStatus
  masterSessionId: string
  createdAt: string
  completedAt?: string
  /** Historical rows migrated from before swarms existed; they are read-only. */
  legacy?: true
}
/** The synthetic swarm that owns tickets written before schema 12, which remain read-only history. */
export const LEGACY_SWARM_ID = 'legacy'
