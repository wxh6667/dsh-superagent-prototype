/** Session tool registration, role-scoped resource reads, and routing/settings tool contracts. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TICKET_STATES } from '../src/app/cards.ts'
import { builtInBase, builtInParts, defaultPrompts } from '../src/app/prompts.ts'
import { UserError } from '../src/core/index.ts'
import { KV } from '../src/kv.ts'
import { RESOURCES } from '../src/app/resources.ts'
import { CliError, Commands } from '../src/infra/commands.ts'
import { IM_WORDS, NOTE_WORDS } from '../src/infra/text.ts'
import { CHAT, feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ')
const read = (resource: string, page: { offset?: number; limit?: number } = {}) =>
  h.runTool(h.runtime.masterId, 'orchestrator_read', { resource, ...page })

it('reads the lists, a ticket, a decision, the settings, the prompts and the models as resources', async () => {
  const { ticket, trigger } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  await h.acceptedTicket(feishu('2', '@bot 再修一个'))
  const tickets = await read('tickets', { limit: 1 })
  expect(tickets).toEqual({ items: [expect.objectContaining({ ticket_id: expect.any(String), state: 'working' })], next_offset: 1 })
  expect(await read('tickets', { offset: 1 })).toMatchObject({ items: [expect.objectContaining({ ticket_id: ticket.id })], next_offset: null })
  const triggers = await read('triggers') as { items: { trigger_id: string }[] }
  expect(triggers.items.map(item => item.trigger_id)).toEqual([expect.any(String), trigger.id])
  expect(await read('threads')).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ tickets: [ticket.id] })]) })
  const decisions = await read('decisions') as { items: { decision_id: string; read: string }[] }
  const accepted = expect.objectContaining({ kind: 'accept', ticket_id: ticket.id, trigger_ids: [trigger.id], read: expect.stringMatching(/^decision\//) })
  expect(decisions.items).toContainEqual(accepted)
  expect(await read(decisions.items.at(-1)!.read)).toMatchObject({ kind: 'accept', ticket_id: ticket.id, mandate: { strength: 'explicit' } })
  expect(await read(`ticket/${ticket.id}`)).toMatchObject({ ticket_id: ticket.id, state: 'working', directory: ticket.execution!.directory,
    trigger_id: trigger.id, assignments: { items: [expect.objectContaining({ state: 'running' })] }, assignment: `ticket/${ticket.id}/assignment` })
  // The settings name each block's revision and hold the small blocks; a block reads whole by the name a save takes.
  const settings = await read('settings')
  expect(settings).toMatchObject({ eval: { value: { mode: 'auto' } }, policy: { revision: expect.any(Number), allowed: { feishu: 1, github: 1 }, read: 'settings/policy' },
    pause: { value: { paused: false } }, sources: expect.arrayContaining([expect.objectContaining({ id: 'local', read: 'settings/source:local' })]) })
  expect(JSON.stringify(settings)).not.toContain('ou_alice')
  for (const block of ['policy', 'eval', 'executor', 'pause', 'source:github']) {
    const page = await read(`settings/${block}`) as { text: string }
    expect(JSON.parse(page.text)).toEqual({ block, revision: h.runtime.store.blockRevision(block as 'policy'), value: h.runtime.settings.block(block).value })
  }
  expect(JSON.parse((await read('settings/policy') as { text: string }).text).value.sources.feishu.allowed).toEqual([{ id: 'ou_alice', name: 'Alice' }])
  await expect(read('settings/source:retired')).rejects.toThrow('Unknown settings block')
  const skills = { built_in: [], team: [] }
  expect(await read('prompts')).toMatchObject({ revision: 0, read: 'prompts/0', skills, items: [expect.objectContaining({ revision: 0 })], next_offset: null })
  const models = [{ id: 'm1', name: 'One' }, { id: 'm2', name: 'Two' }]
  const catalog = { default: { provider: 'p', model: 'm1' }, groups: [{ id: 'p', name: 'Provider', models }], failures: [] }
  Object.assign(h.controller, { modelCatalog: vi.fn(async () => catalog) })
  expect(await read('models')).toMatchObject({ providers: [{ id: 'p', count: 2, read: 'models/p' }], roles: expect.any(Object) })
  expect(await read('models/p', { limit: 1 })).toEqual({ items: [models[0]], next_offset: 1 })
  await expect(read('ticket')).rejects.toThrow('Unknown context resource')
  // A list page holds at most 50 items, the prompt history too.
  const config = h.runtime.prompts.current().config
  for (let revision = 0; revision < 51; revision++) h.runtime.prompts.save({ ...config, scope: `Scope ${revision}.` }, revision, 'panel')
  expect(await read('prompts', { limit: 8000 })).toMatchObject({ items: expect.objectContaining({ length: 50 }), next_offset: 50 })
})

it('lists in prompts the built-in parts whose text changed since the team overrode them, and the built-in parts in prompts/defaults', async () => {
  const read = (resource: string, offset = 0) => h.runTool(h.runtime.masterId, 'orchestrator_read', { resource, offset, limit: 8000 })
  expect(await read('prompts')).not.toHaveProperty('default_changed')
  // An override edited from the built-in text of an earlier version.
  h.runtime.prompts.save({ ...defaultPrompts(), overrides: { 'runtime/dispatch': { text: '## dispatch\nOurs.', base: 'earlier' } } }, 0, 'panel')
  expect(await read('prompts')).toMatchObject({ default_changed: ['runtime/dispatch'] })
  // A text page at a time, which the whole text joins.
  let text = '', offset: number | null = 0
  while (offset !== null) {
    const page = await read('prompts/defaults', offset) as { text: string; next_offset: number | null }
    text += page.text; offset = page.next_offset
  }
  const defaults = JSON.parse(text) as { parts: Record<string, string> }
  expect(defaults.parts).toEqual(Object.fromEntries(Object.entries(builtInParts()).map(([key, part]) => [key, part.text])))
})

it('saves with the prompt save tool an override without its base, refuses a part no version has, and drops a removed one read back', async () => {
  const save = (overrides: Record<string, unknown>) => h.runTool(h.runtime.masterId, 'orchestrator_prompts_save',
    { config: { ...defaultPrompts(), overrides }, baseRevision: h.runtime.prompts.current().revision })
  await expect(save({ constructor: { text: 'x' } })).rejects.toThrow(new UserError('unknownPromptPart', { part: 'constructor' }))
  await save({ 'runtime/dispatch': { text: '## dispatch\nOurs.' } })
  const dispatch = { text: '## dispatch\nOurs.', base: builtInBase(builtInParts()['runtime/dispatch'].text) }
  expect(h.runtime.prompts.current().config.overrides).toEqual({ 'runtime/dispatch': dispatch })
  // The saved version overrides a part this version no longer has: saving back the configuration as read drops it.
  const { revision } = h.runtime.prompts.current(), read = { ...defaultPrompts(), overrides: { 'runtime/dispatch': dispatch,
    'runtime/retired': { text: 'Old.', base: 'b' } } }
  h.runtime.store.set(KV.prompts.version(revision + 1), { revision: revision + 1, previousRevision: revision, savedAt: '', source: 'panel', config: read })
  h.runtime.store.set(KV.prompts.revision, revision + 1)
  await h.runTool(h.runtime.masterId, 'orchestrator_prompts_save', { config: read, baseRevision: revision + 1 })
  expect(h.runtime.prompts.current().config.overrides).toEqual({ 'runtime/dispatch': dispatch })
  // The tool describes the overrides once, in its schema.
  const tool = h.tools.get(h.runtime.masterId)!.get('orchestrator_prompts_save') as unknown as { description: string }
  expect(tool.description).not.toContain('overrides')
})

it('keeps the main Session\'s resources from an Executor Session, which lists only its own', async () => {
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  for (const resource of ['tickets', 'triggers', 'threads', 'decisions', 'settings', 'prompts', 'models']) {
    await expect(h.runTool(sessionId, 'orchestrator_read', { resource })).rejects.toThrow('belongs to the main Session')
  }
  expect(await h.runTool(sessionId, 'orchestrator_read', { resource: `ticket/${ticket.id}` })).toMatchObject({ ticket_id: ticket.id })
  type Registered = { description: string; parameters: { properties: { resource: { description: string } } } }
  const registered = h.tools.get(sessionId)!.get('orchestrator_read') as unknown as Registered
  const offered = registered.description + registered.parameters.properties.resource.description
  for (const { name, executor } of RESOURCES) expect(offered.includes(`${name}:`), name).toBe(!!executor)
  expect(offered).not.toMatch(/preview/i)
})

it('returns where a reply stands: sent, or dropped when its conversation can no longer receive it', async () => {
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary: 'Done.' })
  const reply = (text: string) => h.runTool(h.runtime.masterId, 'orchestrator_reply', { ticket_id: ticket.id, purpose: 'result', text })
  expect(await reply('修好了。')).toEqual({ status: 'sent' })
  vi.mocked(Commands.prototype.lark).mockRejectedValue(new CliError('the message was withdrawn', 230011))
  expect(await reply('修好了，请看 PR。')).toEqual({ status: 'dropped' })
})

it('saves a settings block by name, a Source\'s block with the Source\'s id', async () => {
  const save = (args: Record<string, unknown>) => h.runTool(h.runtime.masterId, 'orchestrator_settings_save', args)
  const github = { config: h.runtime.store.settings().sources.github!.config, revision: h.runtime.store.blockRevision('source:github') }
  const off = { enabled: false, config: github.config }
  await expect(save({ block: 'source', value: off, revision: github.revision })).rejects.toThrow('source names the Source')
  await expect(save({ block: 'source:github', value: off, revision: github.revision })).rejects.toThrow()
  expect(await save({ block: 'source', source: 'github', value: off, revision: github.revision })).toMatchObject({ saved: true })
  expect(h.runtime.store.settings().sources.github?.enabled).toBe(false)
  expect(await save({ block: 'pause', value: { paused: true }, revision: 0 })).toEqual({ paused: true })
})

it('previews a prompt configuration without saving it, and saves one only against the revision it edits', async () => {
  const save = (args: Record<string, unknown>) => h.runTool(h.runtime.masterId, 'orchestrator_prompts_save', args)
  const config = { ...h.runtime.prompts.current().config, scope: 'Finish what was asked.' }
  const preview = await save({ config, preview: true }) as { previews: { role: string; read: string }[] }
  expect(preview.previews.map(item => item.role)).toEqual(['orchestrator', 'worker'])
  let text = '', offset: number | null = 0
  while (offset !== null) {
    const page = await read(preview.previews[1]!.read, { offset, limit: 8000 }) as { text: string; next_offset: number | null }
    text += page.text; offset = page.next_offset
  }
  expect(text).toContain('## Ticket scope\nFinish what was asked.')
  expect(h.runtime.prompts.current().revision).toBe(0)
  await expect(save({ config })).rejects.toThrow('baseRevision')
  expect(await save({ config, baseRevision: 0 })).toMatchObject({ revision: 1 })
})

it('releases the tools it registered for a Session once its agent is disposed, and leaves the other Sessions\' tools', async () => {
  const { ticket } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const worker = `worker-${ticket.id}`
  expect(h.tools.get(worker)!.size).toBeGreaterThan(0)
  h.ctx.emit('agent/disposed', { agent: h.agents.get(worker) } as never)
  expect([h.tools.get(worker)!.size, h.tools.get(h.runtime.masterId)!.size > 0]).toEqual([0, true])
  // Releasing again, as at shutdown, finds nothing left of it.
  h.ctx.emit('agent/disposed', { agent: h.agents.get(worker) } as never)
  expect(h.tools.get(worker)!.size).toBe(0)
})

it('reads a thread by the key cards show: its label, tickets, latest decisions and triggers, newest first, also for its own worker', async () => {
  const { ticket, trigger, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const key = `feishu:${CHAT}:om_1`
  const threads = await read('threads') as { items: { thread: string; label: string; read: string }[] }
  expect(threads.items[0]).toMatchObject({ thread: key, label: '@bot 修一下回归', read: `thread/${key}` })
  const thread = await read(`thread/${key}`)
  expect(thread).toMatchObject({ thread: key, label: '@bot 修一下回归', tickets: [expect.objectContaining({ ticket_id: ticket.id })],
    decisions: [expect.objectContaining({ kind: 'accept', ticket_id: ticket.id })], items: [expect.objectContaining({ trigger_id: trigger.id, read: `trigger/${trigger.id}` })],
    next_offset: null })
  expect(await h.runTool(sessionId, 'orchestrator_read', { resource: `thread/${key}` })).toMatchObject({ thread: key })
  const elsewhere = feishu('5', '@bot 别的事', { chat_id: 'oc_other' })
  h.runtime.store.triggers.save(elsewhere)
  h.runtime.store.threads.save({ key: `feishu:oc_other:om_5`, ref: { source: 'feishu', id: 'oc_other:om_5' }, createdAt: '', subscriptions: [], correlated: [], pending: [], meta: {} })
  await expect(h.runTool(sessionId, 'orchestrator_read', { resource: 'thread/feishu:oc_other:om_5' })).rejects.toThrow('Unknown or inaccessible thread')
})

it('reads a ticket with the ids it is tied to, its reports by assignment, and its assignments and inputs a page at a time, each by the name its line gives or by its id', async () => {
  const { ticket, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const stored = h.runtime.store.tickets.get(ticket.id)!
  const at = (n: number) => `2026-10-05T00:${String(n).padStart(2, '0')}:00.000Z`
  const report = (n: number) => ({ state: 'progress' as const, summary: `Report ${n}: ${'checked the config and the build. '.repeat(46)}`.slice(0, 1500), at: at(n) })
  const assignments = [1, 2, 3, 4, 5, 6, 7].map(n => ({ ...stored.assignments[0]!, id: `a${n}`, state: n < 7 ? 'ended' as const : 'running' as const, report: report(n), createdAt: at(n) }))
  const inputs = Array.from({ length: 24 }, (_, n) => n === 23 ? { id: 'text:long', kind: 'text' as const, text: `Note: ${'check the margin on mobile as well. '.repeat(4)}`, at: at(n) }
    : n % 2 ? { id: `text:${n}`, kind: 'text' as const, text: `Note ${n}: check the margin.`, at: at(n) }
    : { id: `trigger:${n}`, kind: 'trigger' as const, triggerId: `trigger-${n}`, at: at(n) })
  h.runtime.store.tickets.save({ ...stored, assignments, inputs: [...stored.inputs, ...inputs] })
  type Page = { items: { read?: string; report: { read: string } }[]; next_resource?: string; next_offset?: number }
  const details = await read(`ticket/${ticket.id}`) as { inputs: Page; assignments: Page }
  expect(details).toMatchObject({ trigger_id: ticket.origin.triggerId, decision_id: ticket.decisionId, threads: [{ thread: `feishu:${CHAT}:om_1` }],
    inputs: { next_resource: `ticket/${ticket.id}/inputs`, next_offset: 10 }, assignments: { next_resource: `ticket/${ticket.id}/assignments`, next_offset: 3 } })
  expect([details.inputs.items.length, details.assignments.items.length]).toEqual([10, 3])
  // The earlier assignments read on, so a worker reaches every report it continues from.
  const earlier = await read(details.assignments.next_resource!, { offset: details.assignments.next_offset! }) as Page
  expect([earlier.items.map(item => (item as { id?: string }).id), earlier.next_offset]).toEqual([['a4', 'a3', 'a2'], 6])
  expect(await read(details.assignments.next_resource!, { offset: 6 })).toEqual({ next_offset: null,
    items: [expect.objectContaining({ id: 'a1', report: expect.objectContaining({ read: `ticket/${ticket.id}/report/a1` }) })] })
  expect(await h.runTool(sessionId, 'orchestrator_read', { resource: `ticket/${ticket.id}/report/a1` })).toMatchObject({ text: report(1).summary })
  expect(JSON.stringify(details).length).toBeLessThan(3000)
  const page = await read(details.inputs.items[0]!.read!) as { text: string }
  expect(page.text).toContain('check the margin on mobile as well.')
  // An Input also reads by the id it has on the ticket.
  expect(await read(`ticket/${ticket.id}/input/text:long`)).toMatchObject({ text: page.text })
  expect(await read(`ticket/${ticket.id}/inputs`, { offset: 20 })).toMatchObject({ items: expect.objectContaining({ length: 4 }), next_offset: null })
  expect(await read(details.assignments.items[0]!.report.read)).toMatchObject({ text: report(7).summary.slice(0, 4000) })
  vi.mocked(h.controller.inspect).mockResolvedValueOnce({ events: [{ type: 'assistant/message', data: { message: { role: 'assistant',
    content: [{ type: 'text', text: `I fixed the margin. ${'Details. '.repeat(20)}` }] } } }] } as never)
  const transcript = JSON.parse((await read(`ticket/${ticket.id}/transcript`) as { text: string }).text) as { preview: string; read: string }
  expect(transcript).toMatchObject({ preview: expect.stringMatching(/^I fixed the margin\./), read: `ticket/${ticket.id}/message/0` })
  expect(transcript.preview.length).toBeLessThanOrEqual(80)
})

it('reads a trigger once with the message it replies to and the messages around it on its thread, without the CI runs', async () => {
  const at = (minute: number) => `2026-10-06T00:0${minute}:00.000Z`
  const message = (id: string, minute: number, overrides: Record<string, unknown> = {}) => ({ ...feishu(id, `message ${id}`, { root_id: 'om_root', ...overrides }), at: at(minute) })
  const ci = (id: string, minute: number) => ({ ...message(id, minute), source: 'github', human: false, text: '{"check":"build"}', meta: { ci: true } })
  const asked = message('asked', 1), replying = message('reply', 3, { parent_id: 'om_asked' })
  for (const item of [message('root', 0, { root_id: undefined }), asked, ci('ci-1', 2), replying, ci('ci-2', 4), message('later', 5)]) h.runtime.store.triggers.save(item)
  const page = await read(`trigger/${replying.id}`)
  expect(page).toMatchObject({ trigger_id: replying.id, replied_to: { trigger_id: asked.id, read: `trigger/${asked.id}` },
    around: { before: { trigger_id: asked.id }, after: { trigger_id: feishu('later', '').id } }, text: 'message reply' })
  // The page holds the text once, and no pointer to itself.
  expect(page).not.toHaveProperty('preview')
  expect(page).not.toHaveProperty('read')
})

const relaysOf = (kind: string) => h.relays(h.runtime.masterId).filter(item => item.kind === kind)
const notices = () => h.agents.get(h.runtime.masterId)!.inject.mock.calls
  .map(([message]) => JSON.parse(message.content.map(block => block.type === 'text' ? block.text : '').join('')) as Record<string, unknown>)

it('relays a worker\'s report with its ticket card and the start of its summary, and a question with the card alone', async () => {
  const { ticket, trigger, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  await h.runTool(sessionId, 'orchestrator_report', { state: 'progress', summary: 'Needs a decision.', human_action: 'Desktop too?' })
  await h.runtime.idle()
  expect(relaysOf('worker_attention').at(-1)).toEqual({ kind: 'worker_attention', state: 'progress', read: `ticket/${ticket.id}/result`,
    ticket: expect.objectContaining({ ticket_id: ticket.id, state: 'person/answer', attention: expect.objectContaining({ question: 'Desktop too?' }) }) })
  const summary = 'Done. ' + 'Evidence. '.repeat(100)
  await h.runTool(sessionId, 'orchestrator_report', { state: 'ready', summary, human_action: null })
  await h.runtime.idle()
  const report = relaysOf('worker_report').at(-1)!
  expect(report).toMatchObject({ ticket: { ticket_id: ticket.id, title: ticket.title }, trigger_id: trigger.id, state: 'ready', chars: summary.length,
    read: `ticket/${ticket.id}/result` })
  expect(String(report.summary)).toBe(summary.slice(0, 600))
  expect(report.ticket).not.toHaveProperty('preview')
  // The end of the ticket, which the ready report brought, comes with its card.
  expect(notices().at(-1)).toMatchObject({ ticket_ended: { ticket_id: ticket.id, state: 'completed' } })
})

it('tells the main Session of the settings, prompts, requeues and unsubscriptions others made, never of its own', async () => {
  const save = (args: Record<string, unknown>) => h.runTool(h.runtime.masterId, 'orchestrator_settings_save', args)
  const evaluation = h.runtime.store.settings().eval
  await h.runtime.settings.save('eval', { ...evaluation, mode: 'observe' }, h.runtime.store.blockRevision('eval'), 'panel')
  await h.runtime.idle()
  expect(notices().at(-1)).toEqual({ settings_saved: 'eval', changed: ['eval.mode'], read: 'settings/eval' })
  const before = notices().length
  expect(await save({ block: 'eval', value: { ...evaluation, mode: 'auto' }, revision: h.runtime.store.blockRevision('eval') })).not.toHaveProperty('context_delivery')
  const config = { ...h.runtime.prompts.current().config, scope: 'Finish what was asked.' }
  expect(await h.runTool(h.runtime.masterId, 'orchestrator_prompts_save', { config, baseRevision: 0 })).not.toHaveProperty('context_delivery')
  await h.runtime.idle()
  expect(notices().slice(before)).toEqual([])
})

it('shows an Executor Session no id it cannot read: no Decision, no other ticket, no Trigger its ticket did not reach', async () => {
  const { ticket, trigger, sessionId } = await h.acceptedTicket(feishu('1', '@bot 修一下回归'))
  const other = await h.acceptedTicket(feishu('2', '@bot 再修一个', { root_id: undefined }))
  const worker = (resource: string) => h.runTool(sessionId, 'orchestrator_read', { resource })
  const thread = await worker(`thread/feishu:${CHAT}:om_1`)
  expect(thread).not.toHaveProperty('tickets')
  expect(thread).not.toHaveProperty('decisions')
  for (const page of [thread, await worker(`ticket/${ticket.id}`), await worker(`trigger/${trigger.id}`)]) {
    const shown = JSON.stringify(page)
    expect(shown).not.toContain(ticket.decisionId)
    expect(shown).not.toContain(other.ticket.id)
  }
  expect(await read(`thread/feishu:${CHAT}:om_1`)).toMatchObject({ tickets: expect.arrayContaining([expect.objectContaining({ ticket_id: ticket.id })]),
    decisions: expect.arrayContaining([expect.objectContaining({ decision_id: ticket.decisionId })]) })
  expect(await read(`ticket/${ticket.id}`)).toMatchObject({ decision_id: ticket.decisionId })
})

it('gives a worker the other messages of the request its ticket was accepted from, in its first message and on its ticket', async () => {
  // Pause while receiving two messages so they are evaluated as a single batch.
  await h.runtime.settings.pause(true, 'panel')
  const first = feishu('1', '@bot 首页的标题'), second = feishu('2', '@bot 改成“浏览网页”', { root_id: 'om_1' })
  await h.runtime.receive(first); await h.runtime.receive(second)
  await h.runtime.settings.pause(false, 'panel')
  await h.runtime.pump(); await h.runtime.idle()
  const decision = h.runtime.engine.decide(second.id, { kind: 'accept', title: 'Retitle', scope: 'Retitle', reason: { code: 'explicitRouted' },
    acknowledgement: '收到。', name: 'retitle' })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get(decision.ticketId!)!
  const other = ticket.origin.triggerIds.find(id => id !== ticket.origin.triggerId)!
  expect(ticket.origin.triggerIds).toHaveLength(2)
  const message = h.relays(`worker-${ticket.id}`)[0]!
  expect(message.batch).toEqual([expect.objectContaining({ trigger_id: other, preview: expect.any(String), read: `trigger/${other}` })])
  const page = await h.runTool(`worker-${ticket.id}`, 'orchestrator_read', { resource: `ticket/${ticket.id}` })
  expect(page).toMatchObject({ batch: [{ trigger_id: other, read: `trigger/${other}` }] })
  expect(await h.runTool(`worker-${ticket.id}`, 'orchestrator_read', { resource: `trigger/${other}` })).toMatchObject({ trigger_id: other })
})
