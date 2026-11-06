/** Local runtime integration: setup resolves the local repository, and a confirmed local plan becomes a Ticket. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })

it('resolves the local repository and reports the runtime ready', () => {
  expect(h.runtime.configured()).toBe(true)
  expect(h.runtime.setupProblem).toBeUndefined()
  expect(h.runtime.deployment.local).toMatchObject({ baseBranch: 'main', verify: 'scripts/verify.sh' })
  expect(h.runtime.health.local?.state).toBe('ready')
})

it('turns a confirmed local task into a local Trigger, Decision and Ticket', async () => {
  const task = join(h.runtime.deployment.local.repository, '.trellis', 'tasks', '01-local')
  mkdirSync(task, { recursive: true })
  const result = await h.runTool(h.runtime.masterId, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: task, title: 'Local fix', scope: 'local', acknowledgement: '收到。' }],
  })
  expect(result.results).toEqual([expect.objectContaining({ task_dir: task, decision: 'accept' })])
  const ticket = h.runtime.store.tickets.list()[0]!
  expect(ticket.mandate.actor).toEqual({ source: 'local', id: 'local-user' })
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.source).toBe('local')
  expect(ticket.execution).toBeDefined()
})

it('refuses a task directory outside the local workspace', async () => {
  const refused = await h.runTool(h.runtime.masterId, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: '/tmp/not-trellis', title: 'Foreign', acknowledgement: '收到。' }],
  })
  expect(refused).toMatchObject({ results: [{ refused: expect.stringContaining('Not a Trellis task') }] })
})

it('pauses and resumes processing through its own settings block', async () => {
  expect(await h.runtime.settings.pause(true, 'panel')).toEqual({ paused: true })
  expect(h.runtime.store.settings().paused).toBe(true)
  expect(await h.runtime.settings.pause(false, 'panel')).toEqual({ paused: false })
  expect(h.runtime.store.settings().paused).toBe(false)
})
