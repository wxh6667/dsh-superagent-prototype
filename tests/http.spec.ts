import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { registerHttp } from '../src/app/http.ts'
import type { Swarm, Ticket } from '../src/core/index.ts'
import { PromptConflict } from '../src/app/prompts.ts'
import { SettingsConflict } from '../src/app/settings.ts'
import type { HttpHost } from '../src/app/http.ts'
import { SettingsSchema } from '../src/policy.ts'
import { SetupError } from '../src/setup.ts'

type Handler = (req: unknown, res: unknown) => Promise<void>
type Headers = Record<string, string | undefined>
/** Mount management HTTP routes on a fake web server and return a request helper that includes default panel headers. */
function serve(runtime: Partial<Record<keyof HttpHost, unknown>>, host = '127.0.0.1') {
  let handler: Handler = async () => {}
  const ctx = { webServer: { host, port: 3082, register: (route: { handler: Handler }) => { handler = route.handler; return () => {} } } }
  registerHttp(ctx as never, { ready: Promise.resolve(), ...runtime } as unknown as HttpHost)
  return async (method: string, path: string, body?: unknown, headers: Headers = {}) => {
    let status = 0, text = ''
    const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
    const sent = Object.fromEntries(Object.entries({ host: '127.0.0.1:3082', 'x-orchestrator-request': '1', ...headers }).filter(([,
      value]) => value !== undefined))
    const req = { method, url: `/orchestrator/api/${path}`, headers: sent, async *[Symbol.asyncIterator]() { yield* chunks } }
    await handler(req, { writeHead: (code: number) => { status = code }, end: (data: string) => { text = data } })
    return { status, body: JSON.parse(text) as Record<string, unknown> }
  }
}

it('answers each kind of failure with its own status', async () => {
  const saves: unknown[] = []
  const call = serve({
    store: { tickets: { get: () => undefined }, blockRevision: () => 0 },
    sources: { instances: () => [{ id: 'local' }] },
    settings: { save: async (...args: unknown[]) => {
      saves.push(args)
      if (args[1] === 'stale') throw new SettingsConflict('Settings changed. Reload before saving.')
      if (args[1] === 'invalid') z.object({ maxWorkers: z.number() }).parse({})
      if (args[1] === 'refused') throw new SetupError('localRepositoryUnset')
      if (args[1] === 'broken') throw new Error('disk full')
      return { saved: true, revision: 1, restarting: false }
    } },
  })
  expect(await call('PUT', 'settings/executor', { value: 'stale', revision: 0 })).toMatchObject({ status: 409 })
  expect(await call('PUT', 'settings/executor', { value: 'invalid', revision: 0 })).toMatchObject({ status: 400, body: { issues: [{ path: 'maxWorkers' }] } })
  expect(await call('PUT', 'settings/source:local', { value: 'refused', revision: 0 })).toMatchObject({ status: 400, body: { setup: { code: 'localRepositoryUnset', place: 'local' } } })
  expect(await call('PUT', 'settings/executor', { value: 'broken', revision: 0 })).toEqual({ status: 500, body: { error: 'disk full' } })
  // Block names are validated before calling settings.save: reject unknown blocks or non-existent Sources.
  expect(await call('PUT', 'settings/pause', { value: {}, revision: 0 })).toMatchObject({ status: 400 })
  expect(await call('PUT', 'settings/source:chat', { value: {}, revision: 0 })).toEqual({ status: 404, body: { error: 'Source not found' } })
  expect(saves).toHaveLength(4)
  expect(await call('POST', 'tickets/t9/retry')).toEqual({ status: 404, body: { error: 'Ticket not found' } })
  expect(await call('GET', 'nothing/here')).toEqual({ status: 404, body: { error: 'Unknown operation' } })
  expect(await call('POST', 'executor/pause', 'not json')).toEqual({ status: 400, body: { error: 'The request body is not JSON' } })
})

it('decodes path parameters and parses each route\'s query', async () => {
  const seen: unknown[] = []
  const call = serve({
    store: { settings: () => SettingsSchema.parse({}),
      read: { decisions: (filter: unknown, offset: number, limit: number) => { seen.push({ filter, offset, limit }); return { items: [], more: false } } } },
    links: () => () => ({ url: '', label: { zh: '', en: '' } }),
    engine: { unsubscribe: (key: string) => { seen.push(key); return true } },
    sessions: { delivery: async () => 'injected' },
  })
  expect(await call('POST', `threads/${encodeURIComponent('local:room:root')}/unsubscribe`)).toMatchObject({ status: 200, body: { context_delivery: 'injected' } })
  // Invalid offsets default to 0, and limits above the route maximum are clamped.
  expect(await call('GET', 'decisions?kind=accept%2Creopen&limit=500&offset=x&window=24h')).toEqual({ status: 200, body: { items: [], next_offset: null } })
  expect(seen).toEqual(['local:room:root', { filter: { kinds: ['accept', 'reopen'], since: expect.any(String) }, offset: 0, limit: 200 }])
})

it('answers only a same-origin request from the panel on the loopback address', async () => {
  const call = serve({ sessions: { delivery: async () => 'injected' }, engine: { unsubscribe: () => true } })
  const post = (headers: Headers) => call('POST', 'threads/local%3A1/unsubscribe', undefined, headers)
  for (const headers of [{ 'x-orchestrator-request': undefined }, { host: 'evil.example:3082' }, { host: '127.0.0.1:9999' },
    { origin: 'http://evil.example' }, { host: 'localhost:3082', origin: 'http://127.0.0.1:3082' }]) {
    expect(await post(headers), JSON.stringify(headers)).toEqual({ status: 403,
      body: { error: 'Same-origin management request required' } })
  }
  expect(await post({ host: 'localhost:3082', origin: 'http://localhost:3082' })).toMatchObject({ status: 200 })
  // Management routes require a loopback Web server.
  expect(() => serve({}, '0.0.0.0')).toThrow('Orchestrator management requires a loopback Web server')
})

it('accepts a configured reverse-proxy origin and still requires the panel header', async () => {
  const call = serve({ sessions: { delivery: async () => 'injected' }, engine: { unsubscribe: () => true },
    machine: { managementOrigins: ['https://dsh.example.com'] } })
  const post = (headers: Headers) => call('POST', 'threads/local%3A1/unsubscribe', undefined, headers)
  expect(await post({ host: 'dsh.example.com', origin: 'https://dsh.example.com' })).toMatchObject({ status: 200 })
  // A GET may carry no Origin; the trusted Host is enough with the panel header.
  expect(await post({ host: 'dsh.example.com' })).toMatchObject({ status: 200 })
  // A proxy may rewrite Host to loopback but leave the public Origin.
  expect(await post({ host: '127.0.0.1:3082', origin: 'https://dsh.example.com' })).toMatchObject({ status: 200 })
  expect(await post({ host: 'dsh.example.com', origin: 'https://evil.example' })).toMatchObject({ status: 403 })
  expect(await post({ host: 'evil.example', origin: 'https://evil.example' })).toMatchObject({ status: 403 })
  expect(await call('POST', 'threads/local%3A1/unsubscribe', undefined,
    { host: 'dsh.example.com', origin: 'https://dsh.example.com', 'x-orchestrator-request': undefined })).toMatchObject({ status: 403 })
})

it('answers a prompt save that lost a race with 409, and a settings body over 128 KiB with 400', async () => {
  const saves: unknown[] = []
  const call = serve({
    machine: { promptMaxChars: { get: () => 100_000 } },
    store: { atomic: (work: () => unknown) => work(), blockRevision: () => 0 },
    prompts: { save: () => { throw new PromptConflict('Prompt version changed to 3; compare the latest version before saving') } },
    sessions: { notify: () => {}, delivery: async () => 'injected' },
    settings: { save: async (...args: unknown[]) => { saves.push(args); return { saved: true, revision: 1, restarting: false } } },
  })
  expect(await call('PUT', 'prompts', { config: {}, baseRevision: 2 }))
    .toEqual({ status: 409, body: { error: 'Prompt version changed to 3; compare the latest version before saving' } })
  const value = { prepare: 'x'.repeat(128 * 1024) }
  expect(await call('PUT', 'settings/executor', { value, revision: 0 })).toEqual({ status: 400,
    body: { error: `Request exceeds ${128 * 1024} bytes` } })
  expect(saves).toEqual([])
})

const swarmRecord = (id: string, status: Swarm['status'] = 'active'): Swarm => ({
  id, title: `Swarm ${id}`, mission: `Mission ${id}`, workspace: '/srv/repo', verify: 'scripts/verify.sh', prepare: '',
  budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 }, status, masterSessionId: `orchestrator-${id}`,
  createdAt: '2026-11-06T00:00:00Z', ...status === 'completed' ? { completedAt: '2026-11-06T01:00:00Z' } : {},
})
const ticketRecord = (id: string, swarmId: string, fields: Partial<Ticket> = {}): Ticket => ({
  id, title: `Ticket ${id}`, swarmId, decisionId: '',
  mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' }, actor: { source: 'local', id: '' }, scope: '' },
  channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
  origin: { triggerId: '', triggerIds: [] }, ...fields,
})

it('lists swarms with the launcher defaults and creates, opens and finishes one', async () => {
  const active = swarmRecord('s1'), legacy = { ...swarmRecord('legacy', 'completed'), masterSessionId: '', legacy: true as const }
  const created = { ...active, title: 'Ship', mission: 'Do it' }
  const completed = { ...active, status: 'completed' as const, completedAt: '2026-11-06T01:00:00Z' }
  const create = vi.fn(async () => created), open = vi.fn(async () => active), finish = vi.fn(async () => completed)
  const workspaces = { longTerm: () => [{ id: 'w1', path: '/srv/repo', title: 'repo' }] }
  const call = serve({
    masterId: 'legacy-master',
    store: { swarms: { list: () => [active, legacy] }, tickets: { list: () => [] },
      settings: () => SettingsSchema.parse({ sources: { local: { enabled: true, config: { repository: '/srv/repo' } } } }) },
    workspaces, swarms: { create, open, finish },
  })
  expect(await call('GET', 'swarms')).toEqual({ status: 200, body: {
    items: [{ ...active, tasks: { running: 0, pending: 0, ended: 0 } }, { ...legacy, tasks: { running: 0, pending: 0, ended: 0 } }],
    workspaces: [{ id: 'w1', path: '/srv/repo', title: 'repo' }], defaultWorkspace: '/srv/repo', legacyMasterId: 'legacy-master' } })
  const brief = { title: ' Ship ', mission: ' Do it ', acceptance: ' Works ', scope: ' repo ', workspace: '/srv/repo',
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 4, maxWorkers: 2, maxRounds: 3 } }
  expect(await call('POST', 'swarms', brief)).toEqual({ status: 200, body: { swarm: created, masterId: 'orchestrator-s1' } })
  expect(create).toHaveBeenCalledWith({ title: 'Ship', mission: 'Do it', acceptance: 'Works', scope: 'repo', workspace: '/srv/repo',
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 4, maxWorkers: 2, maxRounds: 3 } })
  expect(await call('POST', 'swarms/s1/open')).toEqual({ status: 200, body: { swarm: active, masterId: 'orchestrator-s1' } })
  expect(open).toHaveBeenCalledWith('s1')
  expect(await call('POST', 'swarms/s1/finish')).toEqual({ status: 200, body: { swarm: completed } })
  expect(finish).toHaveBeenCalledWith('s1')
})

it('refuses an invalid swarm brief and reports manager refusals as 400 with their message', async () => {
  const call = serve({
    masterId: 'm',
    store: { swarms: { list: () => [] }, tickets: { list: () => [] }, settings: () => SettingsSchema.parse({}) },
    workspaces: { longTerm: () => [] },
    swarms: { create: async () => { throw new Error('Not a Trellis workspace') },
      open: async () => { throw new Error('Unknown swarm s1') },
      finish: async () => { throw new Error('Swarm s1 still has 2 open tickets') } },
  })
  expect((await call('POST', 'swarms', { title: ' ', mission: ' ', workspace: 'relative' })).body.error).toContain('title')
  expect((await call('POST', 'swarms', { title: 't', mission: 'm', workspace: 'relative' })).body.error).toContain('absolute workspace')
  expect((await call('POST', 'swarms', { title: 't', mission: 'm', workspace: '/r',
    budget: { maxTasks: 0 } })).body.error).toContain('maxTasks')
  expect(await call('POST', 'swarms', { title: 't', mission: 'm', workspace: '/r' }))
    .toEqual({ status: 400, body: { error: 'Not a Trellis workspace' } })
  expect(await call('POST', 'swarms/s1/open')).toEqual({ status: 400, body: { error: 'Unknown swarm s1' } })
  expect(await call('POST', 'swarms/s1/finish')).toEqual({ status: 400,
    body: { error: 'Swarm s1 still has 2 open tickets' } })
  expect(await call('GET', 'swarms')).toEqual({ status: 200,
    body: { items: [], workspaces: [], defaultWorkspace: '', legacyMasterId: 'm' } })
})

it('reports each swarm\'s running, queued and just-ended tasks and its latest change', async () => {
  const active = swarmRecord('s1'), other = swarmRecord('s2')
  const now = new Date().toISOString()
  const run = ticketRecord('run', 's1', { updatedAt: '2026-11-06T00:00:01Z', assignments: [{ id: 'a1', state: 'running', createdAt: now }] })
  const queued = ticketRecord('queued', 's1', { updatedAt: '2026-11-06T00:00:02Z', assignments: [{ id: 'a2', state: 'pending', createdAt: now }] })
  const done = ticketRecord('done', 's1', { updatedAt: '2026-11-06T00:00:03Z', ended: { at: now, by: 'executor', outcome: 'completed' },
    assignments: [{ id: 'a3', state: 'ended', createdAt: now }] })
  // A Ticket of another swarm and one that ended long ago do not change this swarm's counts.
  const elsewhere = ticketRecord('elsewhere', 's2', { assignments: [{ id: 'a4', state: 'running', createdAt: now }] })
  const old = ticketRecord('old', 's1', { updatedAt: '2026-01-01T00:00:00Z', ended: { at: '2026-01-01T00:00:00Z', by: 'executor', outcome: 'completed' } })
  const call = serve({
    masterId: 'm',
    store: { swarms: { list: () => [active, other] }, tickets: { list: () => [run, queued, done, elsewhere, old] },
      settings: () => SettingsSchema.parse({}) },
    workspaces: { longTerm: () => [] },
  })
  const body = (await call('GET', 'swarms')).body as { items: { id: string; tasks: unknown }[] }
  expect(body.items.map(item => ({ id: item.id, tasks: item.tasks }))).toEqual([
    { id: 's1', tasks: { running: 1, pending: 1, ended: 1,
      latest: { ticketId: 'done', title: 'Ticket done', at: '2026-11-06T00:00:03Z', stage: { stage: 'ended' } } } },
    { id: 's2', tasks: { running: 1, pending: 0, ended: 0,
      latest: { ticketId: 'elsewhere', title: 'Ticket elsewhere', at: '2026-11-06T00:00:00Z', stage: { stage: 'working' } } } },
  ])
})
