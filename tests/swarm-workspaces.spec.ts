import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/app/store.ts'
import { SwarmWorkspaces, type RegisteredWorkspace } from '../src/app/swarm-workspaces.ts'
import type { Swarm } from '../src/core/index.ts'

let directory: string
let store: Store
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-swarm-workspaces-'))
  store = new Store(join(directory, 'state.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

/** A workspace registry over a path-to-workspace map, with recording deletions and injectable failures. */
function registry(initial: string[] = []) {
  const entries = new Map<string, RegisteredWorkspace>()
  const deleted: string[] = []
  const failing = new Set<string>()
  for (const path of initial) entries.set(path, { id: path as RegisteredWorkspace['id'], path, title: basename(path) })
  return {
    deleted, failing, entries,
    service: {
      list: () => [...entries.values()],
      create: async (path: string) => {
        const found = entries.get(path)
        if (found) return found
        const workspace = { id: path as RegisteredWorkspace['id'], path, title: basename(path) }
        entries.set(path, workspace)
        return workspace
      },
      delete: async (id: RegisteredWorkspace['id']) => {
        if (failing.has(String(id))) throw new Error(`cannot delete ${String(id)}`)
        const existed = entries.delete(String(id))
        if (existed) deleted.push(String(id))
        return existed
      },
    },
  }
}

const swarm = (id: string, status: Swarm['status'] = 'active'): Swarm => ({
  id, title: `Swarm ${id}`, mission: `Mission ${id}`, workspace: '/repo/user', verify: 'scripts/verify.sh', prepare: '',
  budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 }, status, masterSessionId: `orchestrator-${id}`,
  createdAt: '2026-11-06T00:00:00.000Z', ...status === 'completed' ? { completedAt: '2026-11-06T01:00:00.000Z' } : {},
})

it('records a new registration and a reused one apart, and removes only the new one', async () => {
  const fake = registry(['/repo/user'])
  const report = vi.fn()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service, report })
  const user = await workspaces.ensure('/repo/user', 's1')
  const worktree = await workspaces.ensure('/state/work/ticket-1', 's1')
  expect(user.id).toBe('/repo/user')
  expect(worktree.id).toBe('/state/work/ticket-1')
  expect(workspaces.recorded('s1')).toEqual([
    { id: '/repo/user', path: '/repo/user', title: 'user', created: false },
    { id: '/state/work/ticket-1', path: '/state/work/ticket-1', title: 'ticket-1', created: true },
  ])
  // The launcher keeps the person's repository and hides only the worktree the swarm added.
  expect(workspaces.longTerm().map(item => item.path)).toEqual(['/repo/user'])
  // A Session without a swarm records nothing, so a legacy master never makes its directory temporary.
  await workspaces.ensure('/state/orchestrator', undefined)
  expect(workspaces.recorded('s1')).toHaveLength(2)

  const result = await workspaces.cleanup('s1')
  expect(result).toEqual({ removed: ['/state/work/ticket-1'], failed: [] })
  expect(fake.deleted).toEqual(['/state/work/ticket-1'])
  expect(fake.entries.has('/repo/user')).toBe(true)
  expect(fake.entries.has('/state/orchestrator')).toBe(true)
  expect(workspaces.recorded('s1')).toEqual([])
  expect(workspaces.longTerm().map(item => item.path)).toEqual(['/repo/user', '/state/orchestrator'])
  expect(report).not.toHaveBeenCalled()
})

it('keeps a failed deletion recorded and reported, then removes it on the next cleanup', async () => {
  const fake = registry()
  const report = vi.fn()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service, report })
  await workspaces.ensure('/state/work/ticket-1', 's1')
  await workspaces.ensure('/state/work/ticket-2', 's1')
  fake.failing.add('/state/work/ticket-1')

  const first = await workspaces.cleanup('s1')
  expect(first.removed).toEqual(['/state/work/ticket-2'])
  expect(first.failed.map(item => item.workspace.id)).toEqual(['/state/work/ticket-1'])
  expect(String(first.failed[0]!.error)).toContain('cannot delete')
  expect(report).toHaveBeenCalledTimes(1)
  expect(String(report.mock.calls[0]![0])).toContain('/state/work/ticket-1')
  // The failed registration stays hidden from the launcher and recorded for the retry.
  expect(workspaces.recorded('s1').map(item => item.id)).toEqual(['/state/work/ticket-1'])
  expect(workspaces.longTerm()).toEqual([])

  fake.failing.clear()
  await expect(workspaces.cleanup('s1')).resolves.toEqual({ removed: ['/state/work/ticket-1'], failed: [] })
  expect(workspaces.recorded('s1')).toEqual([])
  expect(store.keys('swarm-workspaces:')).toEqual([])
})

it('forgets a registration the registry no longer knows without reporting a failure', async () => {
  const fake = registry()
  const report = vi.fn()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service, report })
  await workspaces.ensure('/state/work/ticket-1', 's1')
  fake.entries.clear()
  await expect(workspaces.cleanup('s1')).resolves.toEqual({ removed: [], failed: [] })
  expect(workspaces.recorded('s1')).toEqual([])
  expect(report).not.toHaveBeenCalled()
})

it('keeps the created mark when a later ensure finds the same registration already present', async () => {
  const fake = registry()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service })
  await workspaces.ensure('/state/work/ticket-1', 's1')
  // A restart recreates the Session after its registration exists, which reads as reused; the swarm still owns it.
  await workspaces.ensure('/state/work/ticket-1', 's1')
  expect(workspaces.recorded('s1')).toEqual([
    { id: '/state/work/ticket-1', path: '/state/work/ticket-1', title: 'ticket-1', created: true },
  ])
  await expect(workspaces.cleanup('s1')).resolves.toEqual({ removed: ['/state/work/ticket-1'], failed: [] })
  expect(fake.deleted).toEqual(['/state/work/ticket-1'])
})

it('never deletes a reused registration, even when the swarm ends with a record of it', async () => {
  const fake = registry(['/repo/user'])
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service })
  await workspaces.ensure('/repo/user', 's1')
  await expect(workspaces.cleanup('s1')).resolves.toEqual({ removed: [], failed: [] })
  expect(fake.deleted).toEqual([])
  expect(fake.entries.has('/repo/user')).toBe(true)
  expect(store.keys('swarm-workspaces:')).toEqual([])
})

it('retries completed and orphaned records at startup while an active swarm keeps its own', async () => {
  const fake = registry()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service })
  const active = swarm('a'), completed = swarm('c', 'completed')
  await workspaces.ensure('/state/work/active', 'a')
  await workspaces.ensure('/state/work/completed', 'c')
  await workspaces.ensure('/state/work/orphan', 'gone')

  await workspaces.reconcile([active, completed])
  expect(fake.deleted.sort()).toEqual(['/state/work/completed', '/state/work/orphan'])
  expect(workspaces.recorded('a').map(item => item.id)).toEqual(['/state/work/active'])
  expect(workspaces.recorded('c')).toEqual([])
  expect(workspaces.recorded('gone')).toEqual([])
  // Only the active swarm's worktree stays temporary; the cleaned registrations are not in the registry any more.
  expect(workspaces.longTerm()).toEqual([])
})

it('keeps a failed startup retry recorded and reported, and leaves the record for the next attempt', async () => {
  const fake = registry()
  const report = vi.fn()
  const workspaces = new SwarmWorkspaces({ store, registry: fake.service, report })
  await workspaces.ensure('/state/work/left', 'done')
  fake.failing.add('/state/work/left')
  await workspaces.reconcile([swarm('done', 'completed')])
  expect(report).toHaveBeenCalledTimes(1)
  expect(workspaces.recorded('done').map(item => item.id)).toEqual(['/state/work/left'])
  expect(workspaces.longTerm()).toEqual([])
})

it('finds a completed swarm\'s leftover record after the state database is reopened', async () => {
  const fake = registry()
  const before = new SwarmWorkspaces({ store, registry: fake.service })
  await before.ensure('/state/work/left', 'done')
  store.close()
  store = new Store(join(directory, 'state.sqlite'))
  const after = new SwarmWorkspaces({ store, registry: fake.service })
  // The record survived the restart and still hid the worktree from the launcher before it is cleaned.
  expect(after.recorded('done').map(item => item.id)).toEqual(['/state/work/left'])
  expect(after.longTerm()).toEqual([])
  await after.reconcile([swarm('done', 'completed')])
  expect(fake.deleted).toEqual(['/state/work/left'])
  expect(after.recorded('done')).toEqual([])
})
