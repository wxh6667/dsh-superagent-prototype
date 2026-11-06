import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { followupNotice, reportRelay, resultRelay } from '../src/app/notices.ts'
import type { SourceRegistry } from '../src/sources/registry.ts'
import type { Ticket, Trigger } from '../src/core/index.ts'

let directory: string
let store: Store
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-notices-'))
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

/** A follow-up Source seam: no message is replied to, which is all `followupNotice` reads from its Sources. */
const sources = { repliesTo: () => undefined } as unknown as SourceRegistry

it('carries the ticket swarm on result, report and attention relays, and omits it for legacy tickets', () => {
  const owned = ticket('t1', { swarmId: 'swarm-a', attention: { id: 'a1', question: 'Which layout?' } })
  expect(resultRelay(owned, 'ready', 'Done').swarmId).toBe('swarm-a')
  expect(reportRelay(owned, { state: 'ready', summary: 'Done' })?.swarmId).toBe('swarm-a')
  expect(reportRelay(owned, { state: 'blocked', summary: 'Need a decision', question: 'Which layout?' }))
    .toMatchObject({ swarmId: 'swarm-a', id: `attention:t1:a1` })
  // A legacy ticket has no swarm and stays on the legacy master.
  const legacy = ticket('t2', { swarmId: undefined })
  expect(resultRelay(legacy, 'ready', 'Done')).not.toHaveProperty('swarmId')
  expect(reportRelay(legacy, { state: 'ready', summary: 'Done' })).not.toHaveProperty('swarmId')
})

it('selects the first live ticket swarm for a follow-up relay, else its trigger metadata', () => {
  const trigger: Trigger = { id: 'tg1', source: 'local', threads: [{ source: 'local', id: 'main' }], actor: { source: 'local', id: 'me' },
    human: true, at: '2026-10-01T00:00:00.000Z', text: 'one more thing', meta: {} }
  store.triggers.save(trigger)
  store.tickets.save(ticket('t1', { swarmId: 'swarm-a' }))
  store.triggers.saveDisposition(trigger.id, { fanout: ['t1'], at: trigger.at })
  expect(followupNotice(store, sources, trigger.id)).toMatchObject({ id: `followup:${trigger.id}`, swarmId: 'swarm-a' })
  // A live ticket without an owner lets the trigger's own swarm metadata decide the master.
  const metad = { ...trigger, id: 'tg2', meta: { swarmId: 'swarm-b' } }
  store.triggers.save(metad)
  store.tickets.save(ticket('t2', { swarmId: undefined }))
  store.triggers.saveDisposition(metad.id, { fanout: ['t2'], at: metad.at })
  expect(followupNotice(store, sources, metad.id)).toMatchObject({ id: `followup:${metad.id}`, swarmId: 'swarm-b' })
})
