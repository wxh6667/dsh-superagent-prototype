/** Local runtime integration: setup resolves the local repository, and a confirmed local plan becomes a Ticket. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { swarmsView } from '../src/app/views/swarms.ts'
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
  expect(ticket.swarmId).toBeUndefined()
  expect(ticket.mandate.actor).toEqual({ source: 'local', id: 'local-user' })
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.source).toBe('local')
  expect(ticket.execution).toBeDefined()
})

it('attributes a ticket a new swarm\'s master dispatches to that swarm, without a restart', async () => {
  const repository = h.runtime.deployment.local!.repository
  mkdirSync(join(repository, '.trellis', 'scripts'), { recursive: true })
  writeFileSync(join(repository, '.trellis', 'scripts', 'task.py'), '')
  // The master Session is created and decorated here, before the Swarm record is saved.
  const swarm = await h.runtime.swarms.create({ title: 'Ownership', mission: 'Own its dispatches', workspace: repository,
    budget: { maxTasks: 1 } })
  const task = join(repository, '.trellis', 'tasks', '11-07-owned')
  mkdirSync(task, { recursive: true })
  const result = await h.runTool(swarm.masterSessionId, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: task, title: 'Owned', acknowledgement: '收到。' }],
  })
  const ticketId = (result.results as { ticket: { ticket_id: string } }[])[0]!.ticket.ticket_id
  const ticket = h.runtime.store.tickets.get(ticketId)!
  expect(ticket.swarmId).toBe(swarm.id)
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.meta.swarmId).toBe(swarm.id)
  // The swarm's status and budget count it: a second dispatch would exceed maxTasks.
  await h.runtime.idle()
  const view = swarmsView(h.runtime.store.swarms.list(), h.runtime.store.tickets.list()).find(item => item.id === swarm.id)!
  expect(view.tasks).toMatchObject({ running: 1 })
  await expect(h.runTool(swarm.masterSessionId, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: task, title: 'Second', acknowledgement: '收到。' }],
  })).rejects.toThrow('at most 1 tasks')
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
