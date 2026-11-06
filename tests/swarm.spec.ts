import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SCHEMA_VERSION, Store } from '../src/app/store.ts'
import { LEGACY_SWARM_ID, type Swarm, type Ticket } from '../src/core/index.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'orchestrator-swarm-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const ticket = (id: string, fields: Partial<Ticket> = {}): Ticket => ({
  id, title: id, decisionId: '', mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'x', id: '' }, scope: '' },
  channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: '', triggerIds: [] }, ...fields,
})

/** Seed a minimal schema 11 database: the Store adds the remaining tables and columns while opening it. */
function schema11(path: string, tickets: Ticket[]): void {
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  db.prepare('INSERT INTO kv VALUES (?, ?)').run('schema', '11')
  for (const item of tickets) db.prepare('INSERT INTO ticket VALUES (?, ?)').run(item.id, JSON.stringify(item))
  db.close()
}

const swarm = (id: string, status: Swarm['status']): Swarm => ({
  id, title: id, mission: `Mission ${id}`, workspace: '/w', verify: 'scripts/verify.sh', prepare: 'pnpm install',
  budget: { maxTasks: 2, maxWorkers: 1, maxRounds: 3 }, status, masterSessionId: `orchestrator-${id}`, createdAt: `2026-10-0${id.length}T00:00:00.000Z`,
  ...status === 'completed' ? { completedAt: `2026-10-0${id.length}T01:00:00.000Z` } : {},
})

it('opens a fresh database at schema 12 without a legacy swarm', () => {
  const store = new Store(join(directory, 'fresh.sqlite'))
  expect(store.get('schema')).toBe(SCHEMA_VERSION)
  expect(store.swarms.list()).toEqual([])
  expect(store.swarms.get(LEGACY_SWARM_ID)).toBeUndefined()
  store.close()
})

it('opens a schema 11 database as schema 12 with one legacy swarm owning the tickets that had no swarm', () => {
  const path = join(directory, 'schema11.sqlite')
  const historical = ticket('t1', { title: 'Fix login', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    execution: { name: 'login', directory: '/w/login', assignment: 'Fix it.' } })
  const owned = ticket('t2', { swarmId: 'another', title: 'Other work' })
  schema11(path, [historical, owned])
  const store = new Store(path)
  expect(store.get('schema')).toBe(SCHEMA_VERSION)
  expect(store.swarms.list()).toHaveLength(1)
  const legacy = store.swarms.get(LEGACY_SWARM_ID)!
  expect(legacy).toMatchObject({ id: LEGACY_SWARM_ID, title: 'Legacy work', mission: 'Historical tickets kept read-only.', workspace: '', verify: '', prepare: '',
    budget: { maxTasks: 0, maxWorkers: 0, maxRounds: 0 }, status: 'completed', masterSessionId: '', legacy: true })
  expect(legacy.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(legacy.completedAt).toBe(legacy.createdAt)
  // The historical ticket keeps every field it had and gains only its owner; an already-owned ticket is untouched.
  expect(store.tickets.get('t1')).toEqual({ ...historical, swarmId: LEGACY_SWARM_ID })
  expect(store.tickets.get('t2')).toEqual(owned)
  store.close()
})

it('reopens a migrated database without duplicating the legacy swarm or rewriting owned tickets', () => {
  const path = join(directory, 'idempotent.sqlite')
  schema11(path, [ticket('t1', { title: 'Fix login' }), ticket('t2', { title: 'Fix logout' })])
  const store = new Store(path)
  const legacy = store.swarms.get(LEGACY_SWARM_ID)!
  const tickets = store.tickets.list()
  store.close()
  // Run the schema 12 step again to prove it is idempotent, as reopening an older fixture would.
  const db = new DatabaseSync(path)
  db.prepare("UPDATE kv SET value='11' WHERE key='schema'").run()
  db.close()
  const again = new Store(path)
  expect(again.get('schema')).toBe(SCHEMA_VERSION)
  expect(again.swarms.list()).toEqual([legacy])
  expect(again.tickets.list()).toEqual(tickets)
  again.close()
})

it('saves, gets, lists newest first, and filters swarms by status', () => {
  const store = new Store(join(directory, 'swarms.sqlite'))
  store.swarms.save(swarm('a', 'active'))
  store.swarms.save(swarm('b', 'completed'))
  store.swarms.save(swarm('c', 'active'))
  expect(store.swarms.get('b')).toEqual(swarm('b', 'completed'))
  expect(store.swarms.get('missing')).toBeUndefined()
  expect(store.swarms.list().map(item => item.id)).toEqual(['c', 'b', 'a'])
  expect(store.swarms.active().map(item => item.id)).toEqual(['c', 'a'])
  expect(store.swarms.completed().map(item => item.id)).toEqual(['b'])
  // Saving an existing swarm updates its value and keeps its place in the list.
  store.swarms.save({ ...swarm('a', 'active'), title: 'Updated' })
  expect(store.swarms.get('a')).toMatchObject({ title: 'Updated', status: 'active' })
  expect(store.swarms.list().map(item => item.id)).toEqual(['c', 'b', 'a'])
  store.close()
})
