/** Swarm persistence and master-Session lifecycle: creation, lookup, reopening and completion. */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { key, type Swarm, type SwarmBudget } from '../core/index.ts'
import { MAX_ACTIVE_SWARMS, SWARM_LIMITS } from '../limits.ts'
import type { Store } from './store.ts'

/** What a person supplies when starting a swarm; only the title, mission and workspace are required. */
export interface SwarmCreateInput {
  title: string
  mission: string
  acceptance?: string
  scope?: string
  /** Absolute local path of the Trellis workspace the swarm is bound to. */
  workspace: string
  /** Command each worker runs to validate its work; defaults to `scripts/verify.sh`. */
  verify?: string
  /** Command run per worker before its work starts; defaults to empty. */
  prepare?: string
  budget?: Partial<SwarmBudget>
}

/** The narrow dependencies the SwarmManager uses: swarm persistence, master Sessions and workspace archival. */
export interface SwarmHost {
  readonly store: Pick<Store, 'swarms' | 'tickets'>
  readonly sessions: { ensureMaster(id: string, cwd: string, title: string): Promise<unknown> }
  readonly workspace: { archiveSession(id: string): Promise<void>; unarchiveSession(id: string): Promise<void> }
  /** Receives a startup repair failure for one swarm without stopping the repair of the others. */
  readonly report?: (swarm: Swarm, error: unknown) => void
}

/** The default caps of a new swarm when the caller supplies none. */
const DEFAULT_BUDGET: SwarmBudget = { maxTasks: 20, maxWorkers: 2, maxRounds: 3 }
/** The budget fields and the shared bounds each must stay within. */
const BUDGET_FIELDS = ['maxTasks', 'maxWorkers', 'maxRounds'] as const
/** Applies defaults and refuses a budget field outside its shared bounds. */
function budgetOf(input: Partial<SwarmBudget> | undefined): SwarmBudget {
  const budget: SwarmBudget = {
    maxTasks: input?.maxTasks ?? DEFAULT_BUDGET.maxTasks,
    maxWorkers: input?.maxWorkers ?? DEFAULT_BUDGET.maxWorkers,
    maxRounds: input?.maxRounds ?? DEFAULT_BUDGET.maxRounds,
  }
  for (const field of BUDGET_FIELDS) {
    const { min, max } = SWARM_LIMITS[field], value = budget[field]
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${field} must be an integer from ${min} to ${max}; got ${value}`)
  }
  return budget
}

/**
 * Owns Swarm persistence and master Sessions: it creates a swarm together with its `orchestrator-<id>` master,
 * reopens active swarms (ensuring and unarchiving their master), and completes a swarm once no ticket remains open.
 * It does not own Tickets or routing; those stay in the Engine.
 */
export class SwarmManager {
  constructor(private readonly host: SwarmHost) {}

  /**
   * Validates the brief and workspace, creates the swarm's master Session, then saves the active Swarm.
   * A failure to create the master leaves no swarm record behind.
   */
  async create(input: SwarmCreateInput): Promise<Swarm> {
    const title = input.title.trim(), mission = input.mission.trim()
    if (!title) throw new Error('A swarm needs a title')
    if (!mission) throw new Error('A swarm needs a mission')
    const workspace = this.workspaceOf(input.workspace)
    const active = this.host.store.swarms.active().length
    if (active >= MAX_ACTIVE_SWARMS)
      throw new Error(`Cannot create a swarm: ${active} active swarms already run (maximum ${MAX_ACTIVE_SWARMS})`)
    const budget = budgetOf(input.budget)
    const id = key('swarm', title, randomUUID())
    const masterSessionId = `orchestrator-${id}`
    await this.host.sessions.ensureMaster(masterSessionId, workspace, `[swarm] ${title}`)
    const acceptance = input.acceptance?.trim(), scope = input.scope?.trim()
    const swarm: Swarm = {
      id, title, mission,
      ...acceptance ? { acceptance } : {},
      ...scope ? { scope } : {},
      workspace,
      verify: input.verify ?? 'scripts/verify.sh',
      prepare: input.prepare ?? '',
      budget,
      status: 'active',
      masterSessionId,
      createdAt: new Date().toISOString(),
    }
    this.host.store.swarms.save(swarm)
    return swarm
  }

  /** Returns a swarm by id, including completed and legacy history. */
  get(id: string): Swarm | undefined { return this.host.store.swarms.get(id) }

  /** Every swarm, newest first. */
  list(): Swarm[] { return this.host.store.swarms.list() }

  /** Active swarms only, newest first. */
  active(): Swarm[] { return this.host.store.swarms.active() }

  /**
   * The master Session that owns `swarmId`, or `undefined` when it is absent, unknown, completed, or legacy.
   * A completed or legacy swarm has no master to wake, so ticket-related messages never route to it and fall back to
   * the legacy master instead.
   */
  masterFor(swarmId?: string): string | undefined {
    if (!swarmId) return undefined
    const swarm = this.host.store.swarms.get(swarmId)
    return swarm && swarm.status === 'active' && !swarm.legacy && swarm.masterSessionId ? swarm.masterSessionId : undefined
  }

  /** The active, non-legacy swarm whose master Session is `sessionId`, or `undefined` when `sessionId` owns none. */
  swarmOf(sessionId: string): Swarm | undefined {
    return this.host.store.swarms.active().find(swarm => !swarm.legacy && swarm.masterSessionId === sessionId)
  }

  /**
   * Reopens an active swarm: ensures its master Session exists and unarchives it.
   * Completed and legacy swarms are read-only and refused.
   */
  async open(id: string): Promise<Swarm> {
    const swarm = this.require(id)
    if (swarm.status !== 'active' || swarm.legacy) throw new Error(`Swarm ${id} is not active`)
    await this.restore(swarm)
    return swarm
  }

  /**
   * Completes an active swarm after archiving its master Session. Refused while any open Ticket still carries
   * `swarmId === id`; an archive failure leaves the swarm active.
   */
  async finish(id: string): Promise<Swarm> {
    const swarm = this.require(id)
    if (swarm.status !== 'active' || swarm.legacy) throw new Error(`Swarm ${id} is not active`)
    const open = this.host.store.tickets.open().filter(ticket => ticket.swarmId === id)
    if (open.length) throw new Error(`Swarm ${id} still has ${open.length} open ticket${open.length === 1 ? '' : 's'}`)
    await this.host.workspace.archiveSession(swarm.masterSessionId)
    const completed: Swarm = { ...swarm, status: 'completed', completedAt: new Date().toISOString() }
    this.host.store.swarms.save(completed)
    return completed
  }

  /**
   * Repairs every active swarm's master at startup. One swarm that cannot be restored is reported and does not
   * stop the others; completed and legacy swarms never wake.
   */
  async ensureActive(): Promise<void> {
    for (const swarm of this.host.store.swarms.active()) {
      try { await this.restore(swarm) }
      catch (error) { this.host.report?.(swarm, error) }
    }
  }

  /** Ensures the swarm has a master Session, then unarchives it if DSH had archived it. */
  private async restore(swarm: Swarm): Promise<void> {
    await this.host.sessions.ensureMaster(swarm.masterSessionId, swarm.workspace, `[swarm] ${swarm.title}`)
    await this.host.workspace.unarchiveSession(swarm.masterSessionId)
  }

  /** Returns the swarm or throws when it does not exist. */
  private require(id: string): Swarm {
    const swarm = this.host.store.swarms.get(id)
    if (!swarm) throw new Error(`Unknown swarm ${id}`)
    return swarm
  }

  /** Validates that `workspace` is an absolute Trellis workspace (it holds `.trellis/scripts/task.py`). */
  private workspaceOf(workspace: string): string {
    if (!workspace || !isAbsolute(workspace)) throw new Error('A swarm needs an absolute workspace path')
    const task = join(workspace, '.trellis', 'scripts', 'task.py')
    let present = false
    try { present = statSync(task).isFile() } catch { present = false }
    if (!present) throw new Error(`Not a Trellis workspace: ${workspace} does not contain .trellis/scripts/task.py`)
    return workspace
  }
}
