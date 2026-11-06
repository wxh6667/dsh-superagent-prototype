import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SCHEMA_VERSION, Store } from '../src/app/store.ts'
import { KV } from '../src/kv.ts'
import { basisOf, reasonsOf, withoutCopies } from '../src/app/migration.ts'
import { Prompts, composePrompt, defaultPrompts } from '../src/app/prompts.ts'
import { masterPrompt } from '../src/app/context.ts'
import { SettingsSchema } from '../src/policy.ts'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'orchestrator-migration-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

/** Seed a SQLite database in the schema 10 layout (including the legacy `outbox.sent` column and `inbox` table). */
function schema10(path: string, records: Record<string, unknown>, rows: { ticket?: object[]; decision?: object[]; thread?: object[]; trigger?: object[] } = {}): void {
  new Store(path).close()
  const db = new DatabaseSync(path)
  db.exec('DROP TABLE outbox; CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0)')
  const set = (name: string, value: unknown) => db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name, JSON.stringify(value))
  set('schema', 10)
  for (const [name, value] of Object.entries(records)) set(name, value)
  for (const ticket of rows.ticket ?? []) db.prepare('INSERT INTO ticket VALUES (?,?)').run((ticket as { id: string }).id, JSON.stringify(ticket))
  for (const decision of rows.decision ?? []) {
    const { id, threadKey } = decision as { id: string; threadKey: string }
    db.prepare('INSERT INTO decision VALUES (?,?,?)').run(id, threadKey, JSON.stringify(decision))
  }
  for (const thread of rows.thread ?? []) db.prepare('INSERT INTO thread VALUES (?,?)').run((thread as { key: string }).key, JSON.stringify(thread))
  for (const trigger of rows.trigger ?? []) {
    const { id, at } = trigger as { id: string; at: string }
    db.prepare('INSERT INTO trigger VALUES (?,?,?)').run(id, JSON.stringify(trigger), at)
  }
  db.exec('CREATE TABLE inbox (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.close()
}

/** Seed a SQLite database in the schema 12 layout, before the local-only cleanup. */
function schema12(path: string, records: Record<string, unknown>, rows: { ticket?: object[]; decision?: object[]; thread?: object[]; trigger?: object[]; outbox?: object[] } = {}): void {
  new Store(path).close()
  const db = new DatabaseSync(path)
  const set = (name: string, value: unknown) => db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name, JSON.stringify(value))
  set('schema', 12)
  for (const [name, value] of Object.entries(records)) set(name, value)
  for (const ticket of rows.ticket ?? []) db.prepare('INSERT INTO ticket VALUES (?,?)').run((ticket as { id: string }).id, JSON.stringify(ticket))
  for (const decision of rows.decision ?? []) {
    const { id, threadKey } = decision as { id: string; threadKey: string }
    db.prepare('INSERT INTO decision VALUES (?,?,?)').run(id, threadKey, JSON.stringify(decision))
  }
  for (const thread of rows.thread ?? []) db.prepare('INSERT INTO thread VALUES (?,?)').run((thread as { key: string }).key, JSON.stringify(thread))
  for (const trigger of rows.trigger ?? []) {
    const { id, at } = trigger as { id: string; at: string }
    db.prepare('INSERT INTO trigger VALUES (?,?,?)').run(id, JSON.stringify(trigger), at)
  }
  for (const message of rows.outbox ?? []) db.prepare('INSERT INTO outbox VALUES (?,?)').run((message as { id: string }).id, JSON.stringify(message))
  db.close()
}

const actor = { source: 'feishu', id: 'ou_alice' }
const mandate = (basis: object) => ({ strength: 'explicit', policyVersion: 'v1', basis, actor, scope: 'small' })

it('refuses a database older than schema 10 and asks for a new state directory', () => {
  const path = join(directory, 'db.sqlite')
  new Store(path).close()
  const schema = (version: number) => { const db = new DatabaseSync(path); db.prepare("UPDATE kv SET value=? WHERE key='schema'").run(String(version)); db.close() }
  schema(9)
  expect(() => new Store(path)).toThrow(/schema 9 predates schema 10, which this version cannot migrate; start with a new state directory/)
})

it('changes nothing when one step fails: the database stays at schema 10 as it was', () => {
  const path = join(directory, 'db.sqlite')
  const ticket = { id: 't1', title: 'Fix', decisionId: 'd1', channels: [], state: 'open', assignments: [], inputs: [], undelivered: [], summary: '', createdAt: '1',
    updatedAt: '2', mandate: mandate({ via: 'listed' }), meta: { sourceTriggerId: 'trig-1', workspace: '/w/fix-1' } }
  // The current settings must validate; an invalid value aborts the migration transaction.
  schema10(path, { settings: { executor: { maxWorkers: 'many' } } }, { ticket: [ticket] })
  expect(() => new Store(path)).toThrow(/^The orchestrator database is unchanged at schema 10: its migration to schema 13 failed: the settings: /)
  const db = new DatabaseSync(path)
  expect(db.prepare("SELECT value FROM kv WHERE key='schema'").get()).toEqual({ value: '10' })
  expect(JSON.parse(String(db.prepare("SELECT value FROM ticket WHERE id='t1'").get()!.value))).toMatchObject({ meta: { workspace: '/w/fix-1' } })
  db.close()
})

it('reads every basis an earlier gate recorded in the current shape', () => {
  const scope = { chatId: 'oc_1', direct: false }
  expect(basisOf({ source: 'feishu', scope, row: 'oc_1', sender: 'Alice', addressed: 'mention' })).toEqual({ via: 'addressed', source: 'feishu', scope, row: 'oc_1',
    sender: 'Alice', addressed: 'mention' })
  expect(basisOf({ source: 'feishu', scope, followup: true, rules: ['r'] })).toEqual({ via: 'followup', source: 'feishu', scope, rules: ['r'] })
  expect(basisOf({ source: 'feishu', scope, addressed: 'direct', admission: 'unlistedAddressed' })).toEqual({ via: 'admission', source: 'feishu', scope,
    cell: 'unlistedAddressed', addressed: 'direct' })
  // Observed under an earlier gate that recorded no cell: the sender had to be on the list.
  expect(basisOf({ source: 'feishu', scope, sender: 'Alice', observation: true, mode: 'auto', rules: ['r'] })).toEqual({ via: 'listed', source: 'feishu', scope,
    sender: 'Alice', rules: ['r'], observation: { mode: 'auto' } })
  expect(basisOf({ chatId: 'oc_1', direct: true, followup: true, member: 'ou_a' })).toEqual({ via: 'followup', source: 'feishu', scope: { chatId: 'oc_1', direct: true },
    sender: 'ou_a' })
  expect(basisOf({ member: 'ou_a', mention: true })).toEqual({ via: 'listed', sender: 'ou_a', addressed: 'mention' })
  expect(basisOf({ legacyAuthority: 'explicit_mention' })).toEqual({ via: 'listed', authority: 'explicit_mention' })
  expect(basisOf({ via: 'followup' })).toEqual({ via: 'followup' })
})

/** Build a pre-team-sections prompt version where fixed and built-in guides were stored inside the config object. */
const legacyPrompts = (revision: number, guides: Record<string, string> = {}) => ({
  [`prompt-version:${revision}`]: { revision, previousRevision: revision ? revision - 1 : null, savedAt: '', source: 'web',
    config: { shared: 'Legacy shared rule.', orchestrator: 'Legacy orchestrator: only route.', worker: 'Legacy worker.',
      guides: { replies: 'Legacy replies.', dispatch: 'Accept any screenshot.', work: 'Legacy work. Enable auto-merge once it changes fewer than 350 lines (additions plus deletions); and so on.',
        feishu: 'Legacy Feishu skill.', identities: 'Alice is @alice.', ...guides } } },
  'prompt-revision': revision, 'prompt-settings-text': 1,
})
const opened = (records: Record<string, unknown>) => {
  const path = join(directory, `db-${Math.random()}.sqlite`)
  schema10(path, records)
  return new Store(path)
}

it('writes a prompt version saved before the team sections in them, keeping its skills and dropping the remote threshold, and marks it', () => {
  const store = opened({ ...legacyPrompts(3, { notes: 'Call orchestrator_create_task with event_id, read event/<id>, follow guide/work and guide/release, load dsh-tag-github, cd "$DSH_TAG_DIR".' }) })
  const prompts = new Prompts(store, () => 100000, () => undefined)
  const { config } = prompts.version(3)
  expect(config.communication).toBe(defaultPrompts().communication)
  // The local delivery default replaces the remote auto-merge text instead of carrying its line threshold.
  expect(config.delivery).toBe(defaultPrompts().delivery)
  expect(config.delivery).not.toContain('fewer than 350 lines')
  // Guides that are now fixed or built-in are gone; the team's own skills stay, in current names.
  expect(Object.keys(config.skills)).toEqual(['identities', 'notes'])
  expect(config.skills.notes).toBe('Call orchestrator_route (kind accept) with trigger_id, read trigger/<id>, follow the work section and skill dsh-superagent-release, load dsh-superagent-github, cd "$DSH_SUPERAGENT_DIR".')
  const prompt = composePrompt(config, 'orchestrator')
  expect(prompt).not.toContain('Legacy orchestrator')
  expect(prompt).toContain(masterPrompt)
  expect(prompts.current().revision).toBe(3)
  // Read as the built-in text, a legacy version says so instead of listing its differences.
  expect(prompts.history(0, 1).revisions.map(version => version.changed)).toEqual([['legacy']])
  store.close()
})

it('writes saved team sections and skills under current names: earlier project names, the tools that became reads and the routing tools', () => {
  const config = { ...defaultPrompts(), delivery: 'Merge with --repo $DSH_FREELANCER_GITHUB_REPOSITORY.',
    skills: { notes: 'Load dsh-freelancer-github; cd "$DSH_FREELANCER_DIR". List with orchestrator_tickets, then orchestrator_ticket_inspect.',
      routing: 'Accept with orchestrator_ticket_accept; stop with orchestrator_ticket_stop, never orchestrator_trigger_ignore.' } }
  const store = opened({ 'prompt-version:1': { revision: 1, previousRevision: 0, savedAt: '', source: 'web', config }, 'prompt-revision': 1, 'prompt-settings-text': 1 })
  const { config: current } = new Prompts(store, () => 100000, () => undefined).current()
  expect(current.delivery).toBe('Merge with --repo $DSH_SUPERAGENT_GITHUB_REPOSITORY.')
  expect(current.skills.notes).toBe('Load dsh-superagent-github; cd "$DSH_SUPERAGENT_DIR". List with orchestrator_read tickets, then orchestrator_read ticket/<id>.')
  // The four routing tools are one.
  expect(current.skills.routing).toBe('Accept with orchestrator_route (kind accept); stop with orchestrator_route (kind stop), never orchestrator_route (kind ignore).')
  store.close()
})

it('drops removed auto-merge and cross-Source identity settings without writing them into the prompts', () => {
  const before = { policy: { autoMergeLineLimit: 350, members: [{ name: 'Alice', feishuId: 'ou_alice', github: 'alice' }, { name: 'Bob', feishuId: 'ou_bob', github: '' }] } }
  const store = opened({ 'settings-before-9': before })
  const prompts = new Prompts(store, () => 100000, () => undefined)
  const current = prompts.current()
  expect(current.revision).toBe(0)
  expect(current.config.delivery).toBe(defaultPrompts().delivery)
  expect(current.config.skills).not.toHaveProperty('identities')
  expect(store.get('settings-before-9')).toBeUndefined()
  store.close()
})

it('reads a current prompt version that does not read as the one before it, keeping what it said', () => {
  const config = { ...defaultPrompts(), delivery: 'Deliver PRs.' }
  const store = opened({ 'prompt-revision': 2, 'prompt-settings-text': 1,
    'prompt-version:1': { revision: 1, previousRevision: 0, savedAt: '', source: 'web', config },
    'prompt-version:2': { revision: 2, previousRevision: 1, savedAt: '', source: 'web', config: { delivery: ['not text'] } } })
  const prompts = new Prompts(store, () => 100000, () => undefined)
  expect(prompts.current()).toMatchObject({ revision: 2, config, legacy: { config: { delivery: ['not text'] } } })
  expect(prompts.history(0, 2).revisions.map(version => version.changed)).toEqual([['legacy'], []])
  store.close()
})

/**
 * Create a raw SQLite database matching the exact table DDL of the last schema 10 release (before working-set columns
 * and the `effect` table were added, and with leftover schema 6 `inbox` and `task` tables).
 */
function lastSchema10(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE thread (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE trigger_thread (thread TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, human INTEGER NOT NULL, PRIMARY KEY (thread, id));
    CREATE INDEX trigger_at ON trigger(at);
    CREATE INDEX trigger_thread_at ON trigger_thread(thread, at);
    CREATE INDEX decision_thread ON decision(thread);
    CREATE TABLE inbox (id TEXT PRIMARY KEY, value TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE task (id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  const kv = (name: string, value: unknown) => db.prepare('INSERT INTO kv VALUES (?,?)').run(name, JSON.stringify(value))
  kv('schema', 10); kv('master-id', 'orchestrator-1'); kv('settings', { executor: { maxWorkers: 2 } })
  kv('relay-queue', [{ id: 'report:old', text: '{"kind":"worker_report"}' }])
  const trigger = { id: 'trig-1', source: 'feishu', threads: [{ source: 'feishu', id: 'oc_team:om_1' }], actor, human: true, at: '2026-10-01T00:00:00Z', text: 'fix it', meta: {} }
  db.prepare('INSERT INTO trigger VALUES (?,?,?)').run(trigger.id, JSON.stringify(trigger), trigger.at)
  db.prepare('INSERT INTO trigger_thread VALUES (?,?,?,1)').run('feishu:oc_team:om_1', trigger.id, trigger.at)
  const thread = { key: 'feishu:oc_team:om_1', ref: trigger.threads[0], createdAt: trigger.at, subscriptions: ['t1'], correlated: [], pending: [], meta: {} }
  db.prepare('INSERT INTO thread VALUES (?,?)').run(thread.key, JSON.stringify(thread))
  const ticket = { id: 't1', title: 'Fix', decisionId: 'd1', channels: [], state: 'open', summary: '', createdAt: trigger.at, updatedAt: trigger.at,
    mandate: mandate({ source: 'feishu', scope: { chatId: 'oc_team' }, sender: 'Alice', addressed: 'mention' }), inputs: [], undelivered: [],
    assignments: [{ id: 'a1', state: 'running', createdAt: trigger.at }],
    meta: { sourceTriggerId: trigger.id, triggerIds: [trigger.id], workspace: '/w/fix-1', name: 'fix-1', sessionId: 'worker-t1', assignment: 'Read trigger/trig-1.' } }
  db.prepare('INSERT INTO ticket VALUES (?,?)').run(ticket.id, JSON.stringify(ticket))
  const reply = { id: 'reply-1', channel: { source: 'feishu', thread: thread.key, address: { chatId: 'oc_team', messageId: 'om_1' } }, text: '收到', kind: 'reply', attempts: 0, error: '' }
  db.prepare('INSERT INTO outbox VALUES (?,?,0)').run(reply.id, JSON.stringify(reply))
  db.prepare('INSERT INTO inbox VALUES (?,?,0)').run('left-out', '{"id":"left-out"}')
  db.close()
}

it('keeps each fact of a ticket once: its end, its latest report, and no worker Session it can derive', () => {
  const base = { id: 't', title: 'Fix', decisionId: 'd', channels: [], inputs: [], undelivered: [], createdAt: '1', updatedAt: '2',
    mandate: mandate({ via: 'listed' }), origin: { triggerId: 'x', triggerIds: ['x'] }, execution: { name: 'fix', directory: '/w', session: 'worker-t', assignment: 'Do it.' } }
  const open = withoutCopies({ ...base, state: 'open', summary: 'Working on it',
    assignments: [{ id: 'a1', ticketId: 't', ref: 'worker-t', state: 'running', createdAt: '1' }] })
  expect(open).toEqual({ ...base, execution: { name: 'fix', directory: '/w', assignment: 'Do it.' },
    assignments: [{ id: 'a1', state: 'running', createdAt: '1', report: { state: 'progress', summary: 'Working on it', at: '2' } }] })
  // A report the ticket had stays the latest one; an ended ticket without an end record ended closed.
  const reported = { id: 'a1', ticketId: 't', ref: '', state: 'ended', createdAt: '1', report: { state: 'ready', summary: 'Done', at: '2' } }
  expect(withoutCopies({ ...base, state: 'ended', summary: 'Done', assignments: [reported] })).toMatchObject({
    ended: { at: '2', by: 'executor', outcome: 'closed' }, assignments: [{ id: 'a1', state: 'ended', report: { summary: 'Done' } }] })
})

it('reads the reasons earlier versions stored in words as codes, and keeps any other words as written', () => {
  expect(reasonsOf('Assessment timed out')).toEqual([{ code: 'timeout' }])
  expect(reasonsOf('a1: not_a_member; b2: no_mention')).toEqual([{ code: 'not_a_member', triggerId: 'a1' }, { code: 'no_mention', triggerId: 'b2' }])
  expect(reasonsOf('Routed to ticket t9')).toEqual([{ code: 'routed', values: { ticket: 't9' } }])
  expect(reasonsOf('Observe mode: would accept (a copy fix)')).toEqual([{ code: 'observed', values: { text: 'a copy fix' } }])
  // An assessor's words may hold a colon or a semicolon; they stay one reason.
  expect(reasonsOf('Not a request: chatter; nothing to do')).toEqual([{ code: 'said', values: { text: 'Not a request: chatter; nothing to do' } }])
  expect(reasonsOf([{ code: 'timeout' }])).toEqual([{ code: 'timeout' }])
})

const ticket10 = (id: string, fields: Record<string, unknown> = {}) => ({ id, title: 'Fix', decisionId: 'd1', channels: [], state: 'open', assignments: [],
  inputs: [], undelivered: [], summary: '', createdAt: '1', updatedAt: '2', mandate: mandate({ via: 'listed' }), meta: { sourceTriggerId: 'trig-1' }, ...fields })
/** Populate `trigger_thread` rows for `triggers` as schema 10 did on save. */
function indexed(path: string, triggers: { id: string; at: string; threads: { source: string; id: string }[] }[]): void {
  const db = new DatabaseSync(path)
  for (const { id, at, threads } of triggers) {
    for (const thread of threads) db.prepare('INSERT INTO trigger_thread VALUES (?, ?, ?, 1)').run(`${thread.source}:${thread.id}`, id, at)
  }
  db.close()
}

it('names the ticket it stopped at when a ticket does not read, and leaves the database at schema 10 as it was', () => {
  const path = join(directory, 'db.sqlite')
  const { inputs: _inputs, ...broken } = ticket10('t9')
  schema10(path, {}, { ticket: [broken] })
  expect(() => new Store(path)).toThrow(/^The orchestrator database is unchanged at schema 10: its migration to schema 13 failed: ticket t9: /)
  const db = new DatabaseSync(path)
  expect(db.prepare("SELECT value FROM kv WHERE key='schema'").get()).toEqual({ value: '10' })
  expect(JSON.parse(String(db.prepare("SELECT value FROM ticket WHERE id='t9'").get()!.value))).toEqual(broken)
  db.close()
})

it('makes the newest saved revision the current settings when it holds them, and moves a lagging pointer to it', () => {
  const path = join(directory, 'db.sqlite')
  const version = (revision: number, settings: object) => ({ revision, savedAt: '', source: 'web', policyVersion: '', policyChanged: false, notified: [], settings })
  schema10(path, { settings: { executor: { maxWorkers: 4 } }, 'settings-revision': 1, 'settings-version:1': version(1, {}),
    'settings-version:2': version(2, { executor: { maxWorkers: 4 } }) })
  const store = new Store(path)
  expect(store.settingsHistory().map(item => item.revision)).toEqual([2, 1])
  expect([store.get(KV.settings.revision), store.settings().executor.maxWorkers, store.get('settings')]).toEqual([2, 4, undefined])
  store.close()
})

it('reads the reasons a Trigger\'s filter and an Assignment\'s end stored in words as codes, and keeps an end\'s reason once', () => {
  const path = join(directory, 'db.sqlite')
  const assignment = (id: string, endedReason: string) => ({ id, ticketId: 't1', ref: '', state: 'ended', createdAt: '1', endedAt: '2', endedReason })
  schema10(path, {}, { ticket: [ticket10('t1', { assignments: [assignment('a1', 'Retried by a person'), assignment('a2', 'host restarted'),
    { id: 'a3', ticketId: 't1', ref: '', state: 'running', createdAt: '2' }] })] })
  const db = new DatabaseSync(path)
  db.prepare('INSERT INTO disposition VALUES (?, ?)').run('trig-1', JSON.stringify({ filtered: 'Sender is not an authorized human member', fanout: [], at: '' }))
  db.close()
  const store = new Store(path)
  expect(store.tickets.get('t1')!.assignments.map(item => item.endedReason)).toEqual(['retried', 'hostRestarted', undefined])
  expect(store.triggers.disposition('trig-1')).toMatchObject({ filtered: { code: 'senderNotMember' } })
  store.close()
  // The Assignment an end stopped does not repeat the end's reason, which the end keeps.
  const ended = withoutCopies({ ...ticket10('t2'), state: 'ended', ended: { at: '5', by: 'human', reason: 'Not needed', outcome: 'stopped' },
    assignments: [{ id: 'a1', state: 'ended', createdAt: '1', endedAt: '5', endedReason: 'Not needed' }] })
  expect([ended.ended, ended.assignments[0]]).toEqual([{ at: '5', by: 'human', reason: 'Not needed', outcome: 'stopped' }, { id: 'a1', state: 'ended', createdAt: '1', endedAt: '5' }])
})


it('backs up a schema 12 database, then removes non-local records and keeps local records and unrelated settings', () => {
  const path = join(directory, 'db.sqlite')
  const at = '2026-11-01T00:00:00.000Z'
  const settings = SettingsSchema.parse({
    paused: true,
    sources: { local: { enabled: true, config: { repository: '/repo' } }, chat: { enabled: true, config: {} } },
    policy: { sources: { local: { allowed: [{ id: 'local-user' }] }, chat: { allowed: [{ id: 'ou_alice' }] } } },
    executor: { maxWorkers: 5 },
  })
  const localTrigger = { id: 'local:1', source: 'local', threads: [{ source: 'local', id: 'local:t' }], actor: { source: 'local', id: 'local-user' },
    human: true, at, text: 'local', addressed: 'direct', meta: {} }
  const remoteTrigger = { id: 'chat:1', source: 'chat', threads: [{ source: 'chat', id: 'chat:t' }], actor: { source: 'chat', id: 'ou_alice' },
    human: true, at, text: 'remote', addressed: 'mention', meta: {} }
  const localThread = { key: 'local:t', ref: { source: 'local', id: 't' }, createdAt: at, subscriptions: ['lt'], correlated: [], pending: [], meta: {} }
  const remoteThread = { key: 'chat:t', ref: { source: 'chat', id: 't' }, createdAt: at, subscriptions: ['rt'], correlated: [], pending: [], meta: {} }
  const localTicket = { id: 'lt', title: 'Local', decisionId: 'ld', channels: [{ source: 'chat', thread: 'chat:t', address: {} }], undelivered: [],
    createdAt: at, updatedAt: at, mandate: { strength: 'explicit', policyVersion: 'v', basis: { via: 'listed' },
      actor: { source: 'local', id: 'local-user' }, scope: '' },
    origin: { triggerId: 'local:1', triggerIds: ['local:1'] }, assignments: [],
    inputs: [{ id: 'i1', kind: 'trigger', triggerId: 'chat:1', at, human: true }], answers: ['chat:1'] }
  const remoteTicket = { ...localTicket, id: 'rt', title: 'Remote', decisionId: 'rd', origin: { triggerId: 'chat:1', triggerIds: ['chat:1'] }, inputs: [] }
  const localDecision = { id: 'ld', evalId: 'le', threadKey: 'local:t', triggerIds: ['local:1'], policyVersion: 'v', at, kind: 'accept',
    reason: { code: 'explicitRouted' }, strength: 'explicit',
    mandate: { strength: 'explicit', policyVersion: 'v', basis: { via: 'listed', source: 'local' }, actor: { source: 'local', id: 'local-user' }, scope: '' } }
  const remoteDecision = { ...localDecision, id: 'rd', threadKey: 'chat:t', triggerIds: ['chat:1'],
    mandate: { ...localDecision.mandate, basis: { via: 'listed', source: 'chat' }, actor: { source: 'chat', id: 'ou_alice' } } }
  schema12(path, {
    'settings-revision': 1,
    'settings-version:1': { revision: 1, savedAt: at, source: 'panel', policyVersion: 'old', policyChanged: false, notified: [], settings },
    'source-labels:local': { t: 'Local' }, 'source-labels:chat': { t: 'Chat' }, 'github-since': 'x', 'feishu-chats': { oc: true },
  }, { ticket: [localTicket, remoteTicket], decision: [localDecision, remoteDecision], thread: [localThread, remoteThread],
    trigger: [localTrigger, remoteTrigger], outbox: [
      { id: 'lo', channel: { source: 'local', thread: 'local:t', address: {} }, text: 'l', kind: 'notice', status: 'pending' },
      { id: 'ro', channel: { source: 'chat', thread: 'chat:t', address: {} }, text: 'r', kind: 'notice', status: 'pending' },
    ] })
  const db = new DatabaseSync(path)
  db.prepare("INSERT INTO effect (kind, key, value, seq, due, since) VALUES ('assessment', 'e1', ?, 1, 0, ?)")
    .run(JSON.stringify({ triggerId: 'chat:1' }), at)
  for (const [seq, key] of [[2, 'lo'], [3, 'ro']] as const) {
    db.prepare("INSERT INTO effect (kind, key, value, seq, due, since) VALUES ('reply', ?, '{}', ?, 0, ?)").run(key, seq, at)
  }
  db.close()
  const store = new Store(path)
  expect(store.get('schema')).toBe(SCHEMA_VERSION)
  const backups = readdirSync(join(directory, 'backups'))
  expect(backups).toHaveLength(1)
  expect(backups[0]).toMatch(/^db-.*\.sqlite$/)
  expect(store.triggers.get('local:1')).toBeDefined()
  expect(store.triggers.get('chat:1')).toBeUndefined()
  expect(store.threads.get('local:t')).toBeDefined()
  expect(store.threads.get('chat:t')).toBeUndefined()
  expect(store.tickets.get('lt')).toMatchObject({ id: 'lt', inputs: [], channels: [], answers: [] })
  expect(store.tickets.get('rt')).toBeUndefined()
  expect(store.decisions.get('ld')).toBeDefined()
  expect(store.decisions.get('rd')).toBeUndefined()
  const current = store.settings()
  expect(Object.keys(current.sources)).toEqual(['local'])
  expect(Object.keys(current.policy.sources)).toEqual(['local'])
  expect(current.paused).toBe(true)
  expect(current.executor.maxWorkers).toBe(5)
  expect(store.get('source-labels:local')).toEqual({ t: 'Local' })
  expect(store.get('source-labels:chat')).toBeUndefined()
  expect(store.get('github-since')).toBeUndefined()
  expect(store.get('feishu-chats')).toBeUndefined()
  expect(store.receipts.waiting().map(item => item.id)).toEqual(['lo'])
  expect(store.db.prepare("SELECT kind, key FROM effect ORDER BY kind, key").all()).toEqual([{ kind: 'reply', key: 'lo' }])
  store.close()
  // A second open does not back up again.
  new Store(path).close()
  expect(readdirSync(join(directory, 'backups'))).toHaveLength(1)
})
