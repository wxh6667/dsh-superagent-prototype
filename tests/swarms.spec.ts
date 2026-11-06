import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/app/store.ts'
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

/** A SwarmManager over the real Store with recording fakes for the master, archival and reporting seams. */
function fake(fail?: (sessionId: string) => boolean) {
  const ensured: { id: string; cwd: string; title: string }[] = []
  const unarchived: string[] = []
  const archived: string[] = []
  const reported: { swarm: Swarm; error: unknown }[] = []
  const ensureMaster = vi.fn(async (id: string, cwd: string, title: string) => {
    if (fail?.(id)) throw new Error(`cannot ensure ${id}`)
    ensured.push({ id, cwd, title })
  })
  const archiveSession = vi.fn(async (id: string) => { archived.push(id) })
  const unarchiveSession = vi.fn(async (id: string) => { unarchived.push(id) })
  const report = vi.fn((swarm: Swarm, error: unknown) => { reported.push({ swarm, error }) })
  const manager = new SwarmManager({ store, sessions: { ensureMaster }, workspace: { archiveSession, unarchiveSession }, report })
  return { manager, ensureMaster, archiveSession, unarchiveSession, report, ensured, unarchived, archived, reported }
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
  const { manager, ensured } = fake()
  const created = await manager.create(brief({ acceptance: 'It works', scope: 'the repo', budget: { maxTasks: 4 } }))
  expect(created).toMatchObject({ title: 'Ship it', mission: 'Do the thing', acceptance: 'It works', scope: 'the repo', workspace,
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 4, maxWorkers: 2, maxRounds: 3 }, status: 'active' })
  expect(created.id).toMatch(/^[a-f0-9]{32}$/)
  expect(created.masterSessionId).toBe(`orchestrator-${created.id}`)
  expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(ensured).toEqual([{ id: created.masterSessionId, cwd: workspace, title: '[swarm] Ship it' }])
  expect(store.swarms.get(created.id)).toEqual(created)
  expect(store.swarms.active().map(item => item.id)).toEqual([created.id])
})

it('leaves no swarm behind when creating its master fails', async () => {
  const { manager } = fake(() => true)
  await expect(manager.create(brief())).rejects.toThrow('cannot ensure')
  expect(store.swarms.list()).toEqual([])
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
  expect(ensured).toEqual([{ id: 'orchestrator-active', cwd: workspace, title: '[swarm] Swarm active' }])
  expect(unarchived).toEqual(['orchestrator-active'])
  await expect(manager.open('done')).rejects.toThrow('not active')
  await expect(manager.open('legacy')).rejects.toThrow('not active')
  await expect(manager.open('missing')).rejects.toThrow('Unknown swarm')
  expect(ensureMaster).toHaveBeenCalledTimes(1)
  expect(unarchiveSession).toHaveBeenCalledTimes(1)
})

it('refuses finish while an owned ticket is open, then archives the master and completes the swarm', async () => {
  const { manager, archiveSession, archived } = fake()
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

it('ensures only active swarms at startup and reports one failure without stopping the rest', async () => {
  const { manager, ensured, unarchived, reported } = fake(id => id === 'orchestrator-b')
  store.swarms.save(swarm('a'))
  store.swarms.save(swarm('b'))
  store.swarms.save(swarm('c', 'completed'))
  await manager.ensureActive()
  // Active swarms are newest first, so b fails before a is repaired; c never wakes.
  expect(ensured.map(item => item.id)).toEqual(['orchestrator-a'])
  expect(unarchived).toEqual(['orchestrator-a'])
  expect(reported).toHaveLength(1)
  expect(reported[0]!.swarm.id).toBe('b')
  expect(String(reported[0]!.error)).toContain('orchestrator-b')
})
