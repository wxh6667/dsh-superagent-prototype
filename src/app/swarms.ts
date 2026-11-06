/** Swarm persistence and master-Session lifecycle: creation, lookup, reopening and completion. */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { key, type Swarm, type SwarmBudget } from '../core/index.ts'
import { MAX_ACTIVE_SWARMS, SWARM_LIMITS } from '../limits.ts'
import type { RoleModel } from '../policy.ts'
import type { Store } from './store.ts'
import type { SwarmWorkspaces } from './swarm-workspaces.ts'

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
  /** The model a new master Session starts with; absent inherits the global main-Session model. */
  masterModel?: RoleModel
  /** The model a new worker Session starts with; absent inherits the global Executor model. */
  workerModel?: RoleModel
  budget?: Partial<SwarmBudget>
}

/**
 * The narrow dependencies the SwarmManager uses: swarm persistence, master Sessions, workspace archival, and the
 * workspace registrations each swarm's Sessions added.
 */
export interface SwarmHost {
  readonly store: Pick<Store, 'swarms' | 'tickets'>
  readonly sessions: {
    ensureMaster(id: string, cwd: string, title: string, swarmId?: string, model?: RoleModel | null): Promise<unknown>
    /** Steers the brief into the swarm's master Session, waking it to start; `requestId` keeps the delivery idempotent. */
    relay(requestId: string, text: string, target?: { swarmId?: string }): void
  }
  readonly workspace: { archiveSession(id: string): Promise<void>; unarchiveSession(id: string): Promise<void> }
  readonly workspaces: Pick<SwarmWorkspaces, 'cleanup' | 'reconcile'>
  /** Receives a startup repair or cleanup failure for one swarm without stopping the work on the others. */
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

/** The first message of a swarm's master Session, as the relay channel carries it: the brief the person supplied, and nothing else. */
export function swarmBrief(swarm: Pick<Swarm, 'mission' | 'workspace' | 'acceptance' | 'scope' | 'verify' | 'budget'>): string {
  return JSON.stringify({ kind: 'swarm_brief', goal: swarm.mission, workspace: swarm.workspace,
    ...swarm.acceptance ? { acceptance: swarm.acceptance } : {}, ...swarm.scope ? { scope: swarm.scope } : {},
    validation: swarm.verify, budget: swarm.budget })
}

/** DSH may address a Session with its `dsh_` prefix while a Swarm saves the bare id; both name the same Session. */
const DSH_SESSION_PREFIX = 'dsh_'

/** The Session id without DSH's `dsh_` prefix, so ids saved with and without it compare equal. */
function bareSessionId(id: string): string {
  return id.startsWith(DSH_SESSION_PREFIX) ? id.slice(DSH_SESSION_PREFIX.length) : id
}

/** The Session id with DSH's `dsh_` prefix, when it lacks one. */
function addressedSessionId(id: string): string {
  return id.startsWith(DSH_SESSION_PREFIX) ? id : `${DSH_SESSION_PREFIX}${id}`
}

/** The forms one Session id may be addressed by: as given, and with DSH's `dsh_` prefix toggled. */
function sessionForms(id: string): readonly string[] {
  const bare = bareSessionId(id)
  return bare === id ? [id, addressedSessionId(id)] : [id, bare]
}

/**
 * Whether two ids name the same Session, whichever of them carries DSH's `dsh_` prefix.
 * A Swarm's saved `masterSessionId` is never rewritten, so existing rows must resolve in either form.
 */
export function sameSession(a: string, b: string): boolean {
  return bareSessionId(a) === bareSessionId(b)
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
   * A failure to create the master leaves no swarm record behind and removes the workspace registration it added.
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
    try { await this.host.sessions.ensureMaster(masterSessionId, workspace, `[swarm] ${title}`, id, input.masterModel ?? null) }
    catch (error) {
      // The swarm never existed, so no later finish would clean up what creating its master registered.
      await this.host.workspaces.cleanup(id).catch(() => { /* The failure that stopped creation is the one to report. */ })
      throw error
    }
    const acceptance = input.acceptance?.trim(), scope = input.scope?.trim()
    const swarm: Swarm = {
      id, title, mission,
      ...acceptance ? { acceptance } : {},
      ...scope ? { scope } : {},
      ...input.masterModel ? { masterModel: input.masterModel } : {},
      ...input.workerModel ? { workerModel: input.workerModel } : {},
      workspace,
      verify: input.verify ?? 'scripts/verify.sh',
      prepare: input.prepare ?? '',
      budget,
      status: 'active',
      masterSessionId,
      createdAt: new Date().toISOString(),
    }
    this.host.store.swarms.save(swarm)
    // The master starts from the brief the person supplied; the durable relay wakes it to plan against the goal.
    this.host.sessions.relay(`swarm-brief:${id}`, swarmBrief(swarm), { swarmId: id })
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
   * `swarmId` may name the Swarm or its master Session, with or without DSH's `dsh_` prefix; the saved
   * `masterSessionId` is returned as stored. A completed or legacy swarm has no master to wake, so ticket-related
   * messages never route to it and fall back to the legacy master instead.
   */
  masterFor(swarmId?: string): string | undefined {
    if (!swarmId) return undefined
    const swarm = this.host.store.swarms.get(swarmId) ?? this.swarmOf(swarmId)
    return swarm && swarm.status === 'active' && !swarm.legacy && swarm.masterSessionId ? swarm.masterSessionId : undefined
  }

  /** The active, non-legacy swarm whose master Session is `sessionId`, with or without DSH's `dsh_` prefix. */
  swarmOf(sessionId: string): Swarm | undefined {
    return this.host.store.swarms.active().find(swarm => !swarm.legacy && swarm.masterSessionId !== ''
      && sessionForms(swarm.masterSessionId).includes(sessionId))
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
   * Completes an active swarm after archiving its master Session, then removes the workspace registrations its
   * Sessions added. Refused while any open Ticket still carries `swarmId === id`; an archive failure leaves the
   * swarm active. A cleanup failure is reported and keeps its record for the next startup, but never blocks completion.
   */
  async finish(id: string): Promise<Swarm> {
    const swarm = this.require(id)
    if (swarm.status !== 'active' || swarm.legacy) throw new Error(`Swarm ${id} is not active`)
    const open = this.host.store.tickets.open().filter(ticket => ticket.swarmId === id)
    if (open.length) throw new Error(`Swarm ${id} still has ${open.length} open ticket${open.length === 1 ? '' : 's'}`)
    await this.host.workspace.archiveSession(swarm.masterSessionId)
    const completed: Swarm = { ...swarm, status: 'completed', completedAt: new Date().toISOString() }
    this.host.store.swarms.save(completed)
    try { await this.host.workspaces.cleanup(id) }
    catch (error) { this.host.report?.(completed, error) }
    return completed
  }

  /**
   * Repairs every active swarm's master at startup, then retries the workspace cleanup of completed or missing
   * swarms. One swarm that cannot be restored is reported and does not stop the others; completed and legacy swarms
   * never wake.
   */
  async ensureActive(): Promise<void> {
    for (const swarm of this.host.store.swarms.active()) {
      try { await this.restore(swarm) }
      catch (error) { this.host.report?.(swarm, error) }
    }
    // Records left by a failed cleanup, an interrupted end, or a migration are cleaned now, before the panel opens.
    await this.host.workspaces.reconcile(this.host.store.swarms.list())
  }

  /** Ensures the swarm has a master Session, then unarchives it if DSH had archived it. */
  private async restore(swarm: Swarm): Promise<void> {
    await this.host.sessions.ensureMaster(swarm.masterSessionId, swarm.workspace, `[swarm] ${swarm.title}`, swarm.id,
      swarm.masterModel ?? null)
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
