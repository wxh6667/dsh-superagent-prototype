/** Reports and notices return to the Session that dispatched the ticket, or to its Swarm's master. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })

const SIDE = 'orchestrator-side'
const repository = () => h.runtime.deployment.local!.repository

/** Dispatches one task from a main Session that is neither the legacy master nor a Swarm's master. */
async function dispatchedFromSide(task = '11-06-side') {
  await h.runtime.sessions.ensure(SIDE, h.directory, 'Side main Session', 'orchestrator')
  const taskDir = join(repository(), '.trellis', 'tasks', task)
  mkdirSync(taskDir, { recursive: true })
  const result = await h.runTool(SIDE, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: taskDir, title: 'Side work', acknowledgement: '收到。' }],
  })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.results as { ticket: { ticket_id: string } }[])[0]!.ticket.ticket_id)!
  return { ticket, taskDir }
}

/** Advances the clock past each retry delay so `Effects` reaches its failure threshold without waiting. */
async function failEffect(kind: 'relay' | 'notice') {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(Date.now() + 120_000)
      await h.runtime.effects.idle(kind)
    }
  } finally { vi.useRealTimers() }
}

it('sends a ticket\'s reports, attention and end notice to the Session that dispatched it', async () => {
  const { ticket } = await dispatchedFromSide()
  expect(ticket.swarmId).toBeUndefined()
  expect(ticket.originSessionId).toBe(SIDE)
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.threads[0]?.id).toBe(`local:${SIDE}:11-06-side`)

  const worker = `worker-${ticket.id}`
  await h.runTool(worker, 'orchestrator_report', { state: 'progress', summary: 'Needs a decision.', human_action: 'Which layout?' })
  await h.runtime.idle()
  await h.runTool(worker, 'orchestrator_report', { state: 'ready', summary: 'Done.' })
  await h.runtime.idle()

  const reports = h.relays(SIDE).filter(item => item.kind === 'worker_report' || item.kind === 'worker_attention')
  expect(reports.map(item => item.kind)).toEqual(['worker_attention', 'worker_report'])
  expect(reports[0]).toMatchObject({ ticket: { ticket_id: ticket.id }, state: 'progress' })
  expect(reports[1]).toMatchObject({ ticket: { ticket_id: ticket.id }, state: 'ready', read: `ticket/${ticket.id}/result` })
  // The legacy master receives none of this ticket's reports or its end notice.
  expect(h.relays(h.runtime.masterId).filter(item => item.kind === 'worker_report')).toEqual([])
  const injected = h.agents.get(SIDE)!.inject.mock.calls.map(([message]) => JSON.parse(
    message.content.map(block => block.type === 'text' ? block.text : '').join('')) as Record<string, unknown>)
  expect(injected).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'acknowledgement', ticket_id: ticket.id }),
    expect.objectContaining({ ticket_ended: expect.objectContaining({ ticket_id: ticket.id }) }),
  ]))
  expect(h.agents.get(h.runtime.masterId)!.inject.mock.calls).toEqual([])
})

it('resolves the owning Session by swarm master, then dispatching Session, then the legacy master', async () => {
  mkdirSync(join(repository(), '.trellis', 'scripts'), { recursive: true })
  writeFileSync(join(repository(), '.trellis', 'scripts', 'task.py'), '')
  const swarm = await h.runtime.swarms.create({ title: 'Delivery', mission: 'Check ownership', workspace: repository() })
  const { ticket } = await dispatchedFromSide()
  // A live Swarm's master owns the message even when another Session dispatched the ticket.
  expect(h.runtime.sessions.messageTarget({ swarmId: swarm.id, ticketId: ticket.id })).toBe(swarm.masterSessionId)
  expect(h.runtime.sessions.messageTarget({ ticketId: ticket.id })).toBe(SIDE)
  const stored = () => h.runtime.store.tickets.get(ticket.id)!
  h.runtime.store.tickets.save({ ...stored(), swarmId: swarm.id })
  await h.runTool(`worker-${ticket.id}`, 'orchestrator_report', { state: 'blocked', summary: 'Waiting on a decision.' })
  await h.runtime.idle()
  expect(h.relays(swarm.masterSessionId).filter(item => item.kind === 'worker_report')).toHaveLength(1)
  expect(h.relays(SIDE).filter(item => item.kind === 'worker_report')).toEqual([])
  // A Ticket recorded before dispatch Sessions, or a message about no Ticket, keeps the legacy master.
  h.runtime.store.tickets.save({ ...stored(), swarmId: undefined, originSessionId: undefined })
  expect(h.runtime.sessions.messageTarget({ ticketId: ticket.id })).toBe(h.runtime.masterId)
  expect(h.runtime.sessions.messageTarget({})).toBe(h.runtime.masterId)
  // No owner at all: nothing to deliver to.
  expect(h.runtime.sessions.messageTarget({ ticketId: 'missing' })).toBeUndefined()
})

it('records a message with no owning Session in the effect\'s health instead of dropping it', async () => {
  h.runtime.sessions.relay('no-owner', JSON.stringify({ kind: 'worker_report', ticket_id: 'missing' }), { ticketId: 'missing' })
  await failEffect('relay')
  expect(h.runtime.health.relay).toMatchObject({ state: 'error', detail: expect.stringContaining('No Session owns the message no-owner') })
  expect(h.relays(h.runtime.masterId)).toEqual([])
})

it('logs a notice whose Session no longer exists instead of failing silently', async () => {
  const { ticket } = await dispatchedFromSide()
  const warn = vi.spyOn(h.ctx.logger, 'warn')
  h.agents.delete(SIDE)
  h.runtime.sessions.notify('gone', { ticket_ended: ticket.id }, 'Ticket ended', { ticketId: ticket.id })
  await h.runtime.effects.idle('notice')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not deliver the notice'), 'gone', SIDE, 'session/not-found')
})

it('dispatches from a master Session saved with DSH\'s dsh_ prefix and reports back to it', async () => {
  const id = 'prefixed', master = `dsh_orchestrator-${id}`
  h.runtime.store.swarms.save({
    id, title: 'Prefixed', mission: 'Check the prefixed master', workspace: repository(),
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 },
    status: 'active', masterSessionId: master, createdAt: '2026-11-06T00:00:00.000Z',
  })
  // Startup repairs the saved master as stored: its prefixed form is not rewritten to the bare one.
  await h.runtime.swarms.ensureActive()
  const taskDir = join(repository(), '.trellis', 'tasks', '11-06-prefixed-master')
  mkdirSync(taskDir, { recursive: true })
  const result = await h.runTool(master, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: taskDir, title: 'Prefixed work', acknowledgement: '收到。' }],
  })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.results as { ticket: { ticket_id: string } }[])[0]!.ticket.ticket_id)!
  expect(ticket.swarmId).toBe(id)
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.threads[0]?.id).toBe(`local:${id}:11-06-prefixed-master`)
  await h.runTool(`worker-${ticket.id}`, 'orchestrator_report', { state: 'ready', summary: 'Done.' })
  await h.runtime.idle()
  expect(h.relays(master).filter(item => item.kind === 'worker_report')).toHaveLength(1)
  expect(h.relays(h.runtime.masterId).filter(item => item.kind === 'worker_report')).toEqual([])
})

it('attributes a dispatch from a Session addressed with DSH\'s dsh_ prefix to the swarm that saved the bare master id', async () => {
  mkdirSync(join(repository(), '.trellis', 'scripts'), { recursive: true })
  writeFileSync(join(repository(), '.trellis', 'scripts', 'task.py'), '')
  const swarm = await h.runtime.swarms.create({ title: 'Prefix alias', mission: 'Check the alias', workspace: repository() })
  const prefixed = `dsh_${swarm.masterSessionId}`
  // The registered bare master is recognized under DSH's prefixed form before that Session exists.
  expect(h.runtime.sessions.isMaster(prefixed)).toBe(true)
  await h.runtime.sessions.ensure(prefixed, repository(), '[swarm] Prefix alias', 'orchestrator')
  // DSH addresses the one master Session by its prefixed id; the saved bare id resolves to it.
  h.aliasSession(prefixed, swarm.masterSessionId)
  const taskDir = join(repository(), '.trellis', 'tasks', '11-06-prefix-alias')
  mkdirSync(taskDir, { recursive: true })
  const result = await h.runTool(prefixed, 'orchestrator_local_dispatch', {
    tasks: [{ task_dir: taskDir, title: 'Alias work', acknowledgement: '收到。' }],
  })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.results as { ticket: { ticket_id: string } }[])[0]!.ticket.ticket_id)!
  expect(ticket.swarmId).toBe(swarm.id)
  expect(ticket.originSessionId).toBe(prefixed)
  expect(h.runtime.store.triggers.get(ticket.origin.triggerId)?.threads[0]?.id).toBe(`local:${swarm.id}:11-06-prefix-alias`)
  await h.runTool(`worker-${ticket.id}`, 'orchestrator_report', { state: 'ready', summary: 'Done.' })
  await h.runtime.idle()
  expect(h.relays(prefixed).filter(item => item.kind === 'worker_report')).toHaveLength(1)
  expect(h.relays(swarm.masterSessionId).filter(item => item.kind === 'worker_report')).toEqual([])
})
