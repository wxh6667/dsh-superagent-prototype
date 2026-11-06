/** Workspace registrations a swarm's Sessions create, and the cleanup that removes them when the swarm ends. */
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { Swarm } from '../core/index.ts'
import { KV } from '../kv.ts'
import type { Store } from './store.ts'

/** A workspace registration as the registry exposes it. */
export type RegisteredWorkspace = Pick<Workspace, 'id' | 'path' | 'title'>
/** One workspace a swarm's Sessions touched: `created` marks the registration the swarm added, which its end removes. */
export interface SwarmWorkspace extends RegisteredWorkspace { created: boolean }
/** The persisted record of one swarm's workspace registrations. */
export interface SwarmWorkspaceRecord { workspaces: SwarmWorkspace[] }
/** The registry calls `SwarmWorkspaces` makes, narrowed to what it reads; `ctx.workspaceRegistry` implements them. */
export interface WorkspaceRegistryLike {
  list(): readonly RegisteredWorkspace[]
  create(path: string): Promise<RegisteredWorkspace>
  delete(id: Workspace['id']): Promise<boolean>
}
/** What `SwarmWorkspaces` reads and writes: the KV store, the workspace registry, and the report of a failed deletion. */
export interface SwarmWorkspaceHost {
  readonly store: Pick<Store, 'get' | 'set' | 'delete' | 'keys'>
  readonly registry: WorkspaceRegistryLike
  /** Receives a deletion failure, which keeps the registration recorded for a later cleanup. */
  readonly report?: (error: unknown) => void
}
/** What a cleanup removed and what it could not remove, the latter kept for a later attempt. */
export interface WorkspaceCleanup { removed: string[]; failed: { workspace: SwarmWorkspace; error: unknown }[] }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/**
 * Remembers the workspaces each swarm's Sessions registered, so the swarm's end can remove only the registrations it
 * added. A reused registration is recorded too but never removed: it belonged to the person before the swarm.
 * Records live in `KV` so a restart can still find and clean a completed swarm's leftovers.
 */
export class SwarmWorkspaces {
  constructor(private readonly host: SwarmWorkspaceHost) {}

  /**
   * Create or reuse the workspace of a Session in `cwd`, recording it for `swarmId` when it names one.
   * The registry is read before `create` so the returned id tells a new registration from a reused one.
   */
  async ensure(cwd: string, swarmId?: string): Promise<RegisteredWorkspace> {
    const known = new Set(this.host.registry.list().map(workspace => workspace.id))
    const workspace = await this.host.registry.create(cwd)
    if (swarmId) this.record(swarmId, workspace, !known.has(workspace.id))
    return workspace
  }

  /** Record `workspace` for `swarmId`; a registration an earlier call recorded keeps its `created` mark. */
  record(swarmId: string, workspace: RegisteredWorkspace, created: boolean): void {
    const record = this.read(swarmId)
    const found = record.workspaces.find(item => item.id === workspace.id)
    if (found) {
      if (created && !found.created) { found.created = true; this.write(swarmId, record) }
      return
    }
    record.workspaces.push({ id: workspace.id, path: workspace.path, title: workspace.title, created })
    this.write(swarmId, record)
  }

  /** The workspaces this swarm's Sessions touched, with the registrations it added marked `created`. */
  recorded(swarmId: string): readonly SwarmWorkspace[] { return this.read(swarmId).workspaces }

  /**
   * Remove this swarm's created registrations; a reused one is never touched. An id the registry no longer knows is
   * dropped, and a deletion that fails is reported and kept for a later cleanup. Directories and session logs stay.
   */
  async cleanup(swarmId: string): Promise<WorkspaceCleanup> {
    const record = this.read(swarmId)
    const removed: string[] = [], failed: WorkspaceCleanup['failed'] = [], kept: SwarmWorkspace[] = []
    for (const workspace of record.workspaces) {
      if (!workspace.created) continue
      try {
        if (await this.host.registry.delete(workspace.id)) removed.push(workspace.id)
      } catch (error) {
        failed.push({ workspace, error })
        kept.push(workspace)
        this.host.report?.(new Error(`Could not remove the temporary workspace ${workspace.path} of swarm ${swarmId}: ${message(error)}`,
          { cause: error }))
      }
    }
    if (kept.length) this.write(swarmId, { workspaces: kept })
    else if (record.workspaces.length) this.host.store.delete(KV.swarms.workspaces(swarmId))
    return { removed, failed }
  }

  /**
   * Retry every recorded cleanup whose swarm is completed, missing, or otherwise no longer active. Called once at
   * startup: without it, a record left by a failed cleanup, an interrupted end, or a migration would keep filtering a
   * workspace from the launcher forever.
   */
  async reconcile(swarms: readonly Swarm[]): Promise<void> {
    const known = new Map(swarms.map(swarm => [swarm.id, swarm]))
    for (const name of this.host.store.keys(KV.swarms.workspaces)) {
      const swarmId = name.slice(KV.swarms.workspaces.prefix.length)
      const swarm = known.get(swarmId)
      if (swarm && swarm.status === 'active' && !swarm.legacy) continue
      await this.cleanup(swarmId).catch(error => this.host.report?.(error))
    }
  }

  /** Every registered workspace except the temporary registrations a swarm added; the launcher offers only these. */
  longTerm(): RegisteredWorkspace[] {
    const temporary = new Set<string>()
    for (const name of this.host.store.keys(KV.swarms.workspaces)) {
      const record = this.host.store.get<SwarmWorkspaceRecord>(name)
      for (const workspace of record?.workspaces ?? []) if (workspace.created) temporary.add(workspace.id)
    }
    return this.host.registry.list().filter(workspace => !temporary.has(workspace.id))
      .map(({ id, path, title }) => ({ id, path, title }))
  }

  private read(swarmId: string): SwarmWorkspaceRecord {
    return this.host.store.get(KV.swarms.workspaces(swarmId)) ?? { workspaces: [] }
  }
  private write(swarmId: string, record: SwarmWorkspaceRecord): void { this.host.store.set(KV.swarms.workspaces(swarmId), record) }
}
