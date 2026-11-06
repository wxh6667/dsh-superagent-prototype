import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/app/store.ts'
import { SwarmWorkspaces, type RegisteredWorkspace } from '../src/app/swarm-workspaces.ts'
import { SwarmManager, type SwarmCreateInput } from '../src/app/swarms.ts'
import type { Swarm, SwarmBudget, Ticket } from '../src/core/index.ts'
import { MAX_ACTIVE_SWARMS, SWARM_LIMITS } from '../src/limits.ts'

let directory: string
let workspace: string
let store: Store
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-swarms-'))
  workspace = join(directory, 'workspace')
  mkdirSync(join(workspace, '.trellis', 'scripts'), { recursive: true })
  writeFileSync(join(workspace, '.trellis', 'scripts', 'task.py'), '')
  store = new Store(join(directory, 'state.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

const ticket = (id: string, fields: Partial<Ticket> = {}): Ticket => ({
  id, title: id, decisionId: '',
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'local', id: '' }, scope: '' },
  channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  origin: { triggerId: '', triggerIds: [] }, ...fields,
})

const swarm = (id: string, status: Swarm['status'] = 'active', fields: Partial<Swarm> = {}): Swarm => ({
  id, title: `Swarm ${id}`, mission: `Mission ${id}`, workspace, verify: 'scripts/verify.sh', prepare: '',
  budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 }, status, masterSessionId: `orchestrator-${id}`,
  createdAt: '2026-10-01T00:00:00.000Z', ...status === 'completed' ? { completedAt: '2026-10-02T00:00:00.000Z' } : {}, ...fields,
})

/** A SwarmManager over the real Store with recording fakes for the master, archival, workspace and reporting seams. */
function fake(fail?: (sessionId: string) => boolean) {
  const ensured: { id: string; cwd: string; title: string; swarmId?: string }[] = []
  const unarchived: string[] = []
  const archived: string[] = []
  const cleaned: string[] = []
  const reconciled: Swarm[][] = []
  const reported: { swarm: Swarm; error: unknown }[] = []
  const ensureMaster = vi.fn(async (id: string, cwd: string, title: string, swarmId?: string) => {
    if (fail?.(id)) throw new Error(`cannot ensure ${id}`)
    ensured.push({ id, cwd, title, ...swarmId ? { swarmId } : {} })
  })
  const archiveSession = vi.fn(async (id: string) => { archived.push(id) })
  const unarchiveSession = vi.fn(async (id: string) => { unarchived.push(id) })
  const relay = vi.fn((_requestId: string, _text: string, _target?: { swarmId?: string }) => {})
  const report = vi.fn((swarm: Swarm, error: unknown) => { reported.push({ swarm, error }) })
  const workspaces = {
    cleanup: vi.fn(async (id: string) => { cleaned.push(id); return { removed: [], failed: [] } }),
    reconcile: vi.fn(async (swarms: readonly Swarm[]) => { reconciled.push([...swarms]) }),
  }
  const manager = new SwarmManager({ store, sessions: { ensureMaster, relay }, workspace: { archiveSession, unarchiveSession }, workspaces, report })
  return { manager, ensureMaster, relay, archiveSession, unarchiveSession, workspaces, report, ensured, unarchived, archived, cleaned, reconciled, reported }
}

const brief = (fields: Partial<SwarmCreateInput> = {}): SwarmCreateInput => ({ title: 'Ship it', mission: 'Do the thing', workspace, ...fields })

it('refuses a missing, non-absolute or non-Trellis workspace without saving a swarm', async () => {
  const { manager, ensureMaster } = fake()
  await expect(manager.create(brief({ workspace: '' }))).rejects.toThrow('absolute workspace')
  await expect(manager.create(brief({ workspace: 'relative/repo' }))).rejects.toThrow('absolute workspace')
  await expect(manager.create(brief({ workspace: join(directory, 'plain') }))).rejects.toThrow('Not a Trellis workspace')
  await expect(manager.create(brief({ title: '  ' }))).rejects.toThrow('title')
  await expect(manager.create(brief({ mission: ' ' }))).rejects.toThrow('mission')
  expect(store.swarms.list()).toEqual([])
  expect(ensureMaster).not.toHaveBeenCalled()
})

it('creates the master and saves an active swarm with the supplied brief and budget defaults', async () => {
  const { manager, ensured, relay } = fake()
  const created = await manager.create(brief({ acceptance: 'It works', scope: 'the repo', budget: { maxTasks: 4 } }))
  expect(created).toMatchObject({ title: 'Ship it', mission: 'Do the thing', acceptance: 'It works', scope: 'the repo', workspace,
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 4, maxWorkers: 2, maxRounds: 3 }, status: 'active' })
  expect(created.id).toMatch(/^[a-f0-9]{32}$/)
  expect(created.masterSessionId).toBe(`orchestrator-${created.id}`)
  expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(ensured).toEqual([{ id: created.masterSessionId, cwd: workspace, title: '[swarm] Ship it', swarmId: created.id }])
  expect(store.swarms.get(created.id)).toEqual(created)
  expect(store.swarms.active().map(item => item.id)).toEqual([created.id])
  // The master's first message is the brief, delivered once under a swarm-scoped request id.
  expect(relay).toHaveBeenCalledWith(`swarm-brief:${created.id}`, JSON.stringify({ kind: 'swarm_brief', goal: 'Do the thing',
    workspace, acceptance: 'It works', scope: 'the repo', validation: 'scripts/verify.sh',
    budget: { maxTasks: 4, maxWorkers: 2, maxRounds: 3 } }), { swarmId: created.id })
})

it('leaves no swarm behind when creating its master fails, and removes the workspace registration it added', async () => {
  const { manager, cleaned, relay } = fake(() => true)
  await expect(manager.create(brief())).rejects.toThrow('cannot ensure')
  expect(store.swarms.list()).toEqual([])
  expect(cleaned).toHaveLength(1)
  // No swarm means no master and no brief.
  expect(relay).not.toHaveBeenCalled()
})

it('refuses a create at the active-swarm cap before creating a master', async () => {
  const { manager, ensureMaster } = fake()
  for (let index = 0; index < MAX_ACTIVE_SWARMS; index += 1) store.swarms.save(swarm(`active-${index}`))
  await expect(manager.create(brief())).rejects.toThrow(`maximum ${MAX_ACTIVE_SWARMS}`)
  expect(ensureMaster).not.toHaveBeenCalled()
  expect(store.swarms.list()).toHaveLength(MAX_ACTIVE_SWARMS)
})

it('refuses budget fields outside the shared bounds before creating a master', async () => {
  const { manager, ensureMaster } = fake()
  const outside: [keyof SwarmBudget, number][] = [
    ['maxTasks', SWARM_LIMITS.maxTasks.min - 1],
    ['maxTasks', SWARM_LIMITS.maxTasks.max + 1],
    ['maxWorkers', SWARM_LIMITS.maxWorkers.min - 1],
    ['maxWorkers', SWARM_LIMITS.maxWorkers.max + 1],
    ['maxRounds', SWARM_LIMITS.maxRounds.min - 1],
    ['maxRounds', SWARM_LIMITS.maxRounds.max + 1],
    ['maxTasks', 1.5],
  ]
  for (const [field, value] of outside) {
    await expect(manager.create(brief({ budget: { [field]: value } }))).rejects.toThrow(field)
  }
  expect(ensureMaster).not.toHaveBeenCalled()
  expect(store.swarms.list()).toEqual([])
})

it('accepts a budget at the shared bounds', async () => {
  const { manager } = fake()
  const created = await manager.create(brief({ budget: {
    maxTasks: SWARM_LIMITS.maxTasks.max,
    maxWorkers: SWARM_LIMITS.maxWorkers.max,
    maxRounds: SWARM_LIMITS.maxRounds.max,
  } }))
  expect(created.budget).toEqual({
    maxTasks: SWARM_LIMITS.maxTasks.max,
    maxWorkers: SWARM_LIMITS.maxWorkers.max,
    maxRounds: SWARM_LIMITS.maxRounds.max,
  })
})

it('gets, lists newest first and filters active swarms', () => {
  store.swarms.save(swarm('a'))
  store.swarms.save(swarm('b', 'completed'))
  store.swarms.save(swarm('c'))
  const { manager } = fake()
  expect(manager.get('b')).toMatchObject({ id: 'b', status: 'completed' })
  expect(manager.get('missing')).toBeUndefined()
  expect(manager.list().map(item => item.id)).toEqual(['c', 'b', 'a'])
  expect(manager.active().map(item => item.id)).toEqual(['c', 'a'])
})

it('resolves an active swarm master and refuses completed, legacy, empty-master and unknown swarms', () => {
  store.swarms.save(swarm('a'))
  store.swarms.save(swarm('done', 'completed'))
  store.swarms.save(swarm('legacy', 'completed', { legacy: true, masterSessionId: '' }))
  store.swarms.save(swarm('empty', 'active', { masterSessionId: '' }))
  const { manager } = fake()
  expect(manager.masterFor('a')).toBe('orchestrator-a')
  expect(manager.masterFor('done')).toBeUndefined()
  expect(manager.masterFor('legacy')).toBeUndefined()
  expect(manager.masterFor('empty')).toBeUndefined()
  expect(manager.masterFor('missing')).toBeUndefined()
  expect(manager.masterFor()).toBeUndefined()
})

it('finds the active, non-legacy swarm whose master owns a Session', () => {
  store.swarms.save(swarm('a'))
  store.swarms.save(swarm('done', 'completed'))
  store.swarms.save(swarm('legacy', 'completed', { legacy: true, masterSessionId: '' }))
  store.swarms.save(swarm('legacy-active', 'active', { legacy: true }))
  const { manager } = fake()
  expect(manager.swarmOf('orchestrator-a')).toMatchObject({ id: 'a', status: 'active' })
  expect(manager.swarmOf('orchestrator-done')).toBeUndefined()
  expect(manager.swarmOf('orchestrator-legacy')).toBeUndefined()
  expect(manager.swarmOf('orchestrator-legacy-active')).toBeUndefined()
  expect(manager.swarmOf('unknown-session')).toBeUndefined()
  expect(manager.swarmOf('')).toBeUndefined()
})

it('opens an active swarm by ensuring and unarchiving its master, and refuses completed or legacy swarms', async () => {
  const { manager, ensureMaster, unarchiveSession, ensured, unarchived } = fake()
  const active = swarm('active'), completed = swarm('done', 'completed'), legacy = swarm('legacy', 'completed', { legacy: true, masterSessionId: '' })
  store.swarms.save(active); store.swarms.save(completed); store.swarms.save(legacy)
  await expect(manager.open('active')).resolves.toEqual(active)
  expect(ensured).toEqual([{ id: 'orchestrator-active', cwd: workspace, title: '[swarm] Swarm active', swarmId: 'active' }])
  expect(unarchived).toEqual(['orchestrator-active'])
  await expect(manager.open('done')).rejects.toThrow('not active')
  await expect(manager.open('legacy')).rejects.toThrow('not active')
  await expect(manager.open('missing')).rejects.toThrow('Unknown swarm')
  expect(ensureMaster).toHaveBeenCalledTimes(1)
  expect(unarchiveSession).toHaveBeenCalledTimes(1)
})

it('refuses finish while an owned ticket is open, then archives the master, completes the swarm and cleans its workspaces', async () => {
  const { manager, archiveSession, archived, cleaned } = fake()
  store.swarms.save(swarm('s'))
  const open = ticket('t-open', { swarmId: 's' })
  store.tickets.save(open)
  // A ticket of another swarm does not block this one.
  store.tickets.save(ticket('t-other', { swarmId: 'other' }))
  await expect(manager.finish('s')).rejects.toThrow('1 open ticket')
  expect(archiveSession).not.toHaveBeenCalled()
  expect(store.swarms.get('s')).toMatchObject({ status: 'active' })
  store.tickets.save({ ...open, ended: { at: '2026-10-03T00:00:00.000Z', by: 'executor', outcome: 'completed' } })
  const finished = await manager.finish('s')
  expect(archived).toEqual(['orchestrator-s'])
  expect(cleaned).toEqual(['s'])
  expect(finished).toMatchObject({ id: 's', status: 'completed' })
  expect(finished.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(store.swarms.get('s')).toEqual(finished)
  await expect(manager.finish('s')).rejects.toThrow('not active')
})

it('leaves a swarm active when archiving its master fails', async () => {
  const { manager, archiveSession } = fake()
  store.swarms.save(swarm('s'))
  archiveSession.mockRejectedValueOnce(new Error('archive failed'))
  await expect(manager.finish('s')).rejects.toThrow('archive failed')
  expect(store.swarms.get('s')).toMatchObject({ status: 'active' })
})

it('keeps the person\'s workspace and removes the swarm\'s worktree registrations when it finishes', async () => {
  const entries = new Map<string, RegisteredWorkspace>([[workspace,
    { id: workspace as RegisteredWorkspace['id'], path: workspace, title: 'workspace' }]])
  const deleted: string[] = []
  const registry = {
    list: () => [...entries.values()],
    create: async (path: string) => {
      const found = entries.get(path)
      if (found) return found
      const created = { id: path as RegisteredWorkspace['id'], path, title: path.split('/').at(-1)! }
      entries.set(path, created)
      return created
    },
    delete: async (id: RegisteredWorkspace['id']) => {
      const found = entries.delete(String(id))
      if (found) deleted.push(String(id))
      return found
    },
  }
  const workspaces = new SwarmWorkspaces({ store, registry })
  const manager = new SwarmManager({ store,
    // The master Session registers the chosen workspace; each worker registers its own worktree Session directory.
    sessions: { ensureMaster: async (_id, cwd, _title, swarmId) => { await workspaces.ensure(cwd, swarmId) }, relay: () => {} },
    workspace: { archiveSession: async () => {}, unarchiveSession: async () => {} }, workspaces })
  const created = await manager.create(brief())
  await workspaces.ensure('/state/work/ticket-1', created.id)
  await workspaces.ensure('/state/work/ticket-2', created.id)
  expect(workspaces.longTerm().map(item => item.path)).toEqual([workspace])
  await manager.finish(created.id)
  expect(deleted.sort()).toEqual(['/state/work/ticket-1', '/state/work/ticket-2'])
  // The person's workspace registration and directory remain; the temporary worktree registrations are gone.
  expect([...entries.keys()]).toEqual([workspace])
  expect(workspaces.longTerm().map(item => item.path)).toEqual([workspace])
  expect(workspaces.recorded(created.id)).toEqual([])
})

it('completes a swarm even when its workspace cleanup fails, and reports the failure', async () => {
  const { manager, workspaces, reported } = fake()
  store.swarms.save(swarm('s'))
  workspaces.cleanup.mockRejectedValueOnce(new Error('cleanup failed'))
  const finished = await manager.finish('s')
  expect(finished).toMatchObject({ id: 's', status: 'completed' })
  expect(store.swarms.get('s')).toEqual(finished)
  expect(reported).toHaveLength(1)
  expect(reported[0]!.swarm.id).toBe('s')
  expect(String(reported[0]!.error)).toContain('cleanup failed')
})

it('ensures only active swarms at startup, retries every workspace record, and reports one failure without stopping the rest', async () => {
  const { manager, ensured, unarchived, reconciled, reported } = fake(id => id === 'orchestrator-b')
  store.swarms.save(swarm('a'))
  store.swarms.save(swarm('b'))
  store.swarms.save(swarm('c', 'completed'))
  await manager.ensureActive()
  // Active swarms are newest first, so b fails before a is repaired; c never wakes.
  expect(ensured.map(item => item.id)).toEqual(['orchestrator-a'])
  expect(unarchived).toEqual(['orchestrator-a'])
  // The completed swarm's leftover records are retried, as are every other swarm's; active ones keep their records.
  expect(reconciled.map(list => list.map(item => item.id))).toEqual([['c', 'b', 'a']])
  expect(reported).toHaveLength(1)
  expect(reported[0]!.swarm.id).toBe('b')
  expect(String(reported[0]!.error)).toContain('orchestrator-b')
})
