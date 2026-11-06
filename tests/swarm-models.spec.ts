/** A swarm's pinned models seed its new master and worker Sessions; a role a swarm does not pin inherits the global model. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => {
  h = await startRuntime()
  mkdirSync(join(repository(), '.trellis', 'scripts'), { recursive: true })
  writeFileSync(join(repository(), '.trellis', 'scripts', 'task.py'), '')
  // The global role models a swarm inherits when it pins none.
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings,
    eval: { ...settings.eval, model: { provider: 'global-master', model: 'main' } },
    executor: { ...settings.executor, model: { provider: 'global-worker', model: 'fast' } } })
})
afterEach(async () => { await h.stop() })

const repository = () => h.runtime.deployment.local!.repository
/** Every model route the host resolved for a new Session, in the order the Sessions were seeded. */
const resolved = () => (h.ctx as unknown as { llm: { resolveCallConfig: { mock: { calls: unknown[][] } } } }).llm
  .resolveCallConfig.mock.calls.map(([value]) => value)

/** Dispatches one task from `masterSessionId`, waits for its launch, and returns the worker Session's id. */
async function dispatch(masterSessionId: string, task: string): Promise<string> {
  const taskDir = join(repository(), '.trellis', 'tasks', task)
  mkdirSync(taskDir, { recursive: true })
  const result = await h.runTool(masterSessionId, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: taskDir, title: task, acknowledgement: '收到。' }],
  })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.results as { ticket: { ticket_id: string } }[])[0]!.ticket.ticket_id)!
  return `worker-${ticket.id}`
}

it('seeds a new master and its worker Sessions with the models the swarm pins', async () => {
  const swarm = await h.runtime.swarms.create({ title: 'Pinned', mission: 'Use the pins', workspace: repository(),
    masterModel: { provider: 'provider-a', model: 'main' }, workerModel: { provider: 'provider-b', model: 'fast' } })
  expect(resolved()).toEqual([{ provider: 'provider-a', model: 'main' }])
  const worker = await dispatch(swarm.masterSessionId, '11-06-pinned')
  expect(h.agents.has(swarm.masterSessionId)).toBe(true)
  expect(h.agents.has(worker)).toBe(true)
  expect(resolved()).toEqual([{ provider: 'provider-a', model: 'main' }, { provider: 'provider-b', model: 'fast' }])
})

it('gives each swarm its own worker model, and inherits the global role models where a swarm pins none', async () => {
  const first = await h.runtime.swarms.create({ title: 'First', mission: 'One worker model', workspace: repository(),
    workerModel: { provider: 'worker-a', model: 'one' } })
  const second = await h.runtime.swarms.create({ title: 'Second', mission: 'No pins', workspace: repository() })
  // Both masters inherit the global main-Session model because neither swarm pins one.
  expect(resolved()).toEqual([
    { provider: 'global-master', model: 'main' },
    { provider: 'global-master', model: 'main' },
  ])
  await dispatch(first.masterSessionId, '11-06-first')
  await dispatch(second.masterSessionId, '11-06-second')
  // Each worker takes the model of the swarm that owns its Ticket; the unpinned swarm's worker inherits the global one.
  expect(resolved()).toEqual([
    { provider: 'global-master', model: 'main' },
    { provider: 'global-master', model: 'main' },
    { provider: 'worker-a', model: 'one' },
    { provider: 'global-worker', model: 'fast' },
  ])
})
