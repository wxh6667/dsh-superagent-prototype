import { describe, expect, it } from 'vitest'
import { SettingsSchema, assessmentOutcome, allowedSender, anyoneAllowed, policyEffects, policyVersion, settingsPolicy, type Settings }
  from '../src/policy.ts'
import type { MandateBasis, Thread, Ticket, Trigger } from '../src/core/index.ts'
import { migrateSettings } from '../src/app/migration.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { chatKind, chat, CHAT, MEMBER } from './fixtures/chat.ts'

const OBSERVED = 'oc_1111111111111111111111111111'
const base = SettingsSchema.parse({
  policy: { sources: { chat: { allowed: [{ id: MEMBER, name: 'Alice' }] } } },
  eval: { mode: 'auto' },
  sources: { chat: { enabled: true, config: { chats: [{ chatId: CHAT, listen: 'mentions' }, { chatId: OBSERVED, listen: 'all' }], directMessages: true } } },
})
function setup(settings: Settings = base) {
  const sources = new SourceRegistry(() => settings)
  sources.register(chatKind)
  return { sources, policy: settingsPolicy(settings, sources), version: policyVersion(settings) }
}
const { sources, policy } = setup()
const thread = (subscriptions: string[] = []): Thread => ({ key: 'chat:x', ref: { source: 'chat', id: 'x' }, createdAt: '', subscriptions, correlated: [], pending: [], meta: {} })
const ticket = { id: 'ticket', ended: { at: '', by: 'executor', reason: 'closed', outcome: 'closed' } } as Ticket

describe('source scope', () => {
  it('listens to configured chats, reads every message only where configured, and follows the direct-message switch', () => {
    expect(sources.scope(chat('1', 'hi'))).toEqual({ listened: true, observed: false, row: CHAT })
    expect(sources.scope(chat('1', 'hi', { meta: { chatId: OBSERVED, direct: false, mentioned: false } }))).toEqual({ listened: true, observed: true, row: OBSERVED })
    expect(sources.scope(chat('1', 'hi', { meta: { chatId: 'oc_other', direct: false, mentioned: true } }))).toEqual({ listened: false, reason: 'chat_not_allowed' })
    expect(sources.scope(chat('1', 'hi', { meta: { chatId: 'p2p', direct: true, mentioned: false } }))).toEqual({ listened: true, observed: false, row: 'direct' })
    expect(setup({ ...base, sources: { chat: { enabled: true, config: { chats: [], directMessages: false } } } })
      .sources.scope(chat('1', 'hi', { meta: { chatId: 'p2p', direct: true, mentioned: false } }))).toEqual({ listened: false, reason: 'direct_messages_not_allowed' })
  })
  it('listens to nothing from a configured Source whose plugin is not loaded, and keeps an invalid stored configuration disabled', () => {
    const bare = new SourceRegistry(() => base)
    expect(bare.scope(chat('1', 'hi'))).toEqual({ listened: false, reason: 'source_not_installed' })
    const broken = new SourceRegistry(() => SettingsSchema.parse({ sources: { chat: { enabled: true, config: { chats: 'oops' } } } }))
    broken.register(chatKind)
    expect(broken.instance('chat')).toMatchObject({ enabled: false })
    expect(broken.scope(chat('1', 'hi'))).toEqual({ listened: false, reason: 'source_disabled' })
  })
})

describe('gate', () => {
  it('grants explicit strength when the sender is allowed in its Source\'s part and the Source marked the Trigger addressed', () => {
    expect(policy.gate(chat('1', 'hi'), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit',
      basis: { via: 'addressed', source: 'chat', sender: 'Alice', addressed: 'mention', scope: { chatId: CHAT } } })
    expect(policy.gate(chat('1', 'hi', { addressed: 'direct', meta: { chatId: 'p2p', direct: true, mentioned: false } }), thread(), []))
      .toMatchObject({ admissible: true, strength: 'explicit', basis: { addressed: 'direct' } })
    expect(allowedSender(base, { source: 'chat', id: 'OU_ALICE' })).toEqual({ id: MEMBER, name: 'Alice' })
    expect(allowedSender(base, { source: 'local', id: 'local-user' })).toBeUndefined()
    expect(anyoneAllowed(base)).toBe(true)
    expect(anyoneAllowed(SettingsSchema.parse({}))).toBe(false)
  })
  it('rejects unknown senders, automated messages, and allowed senders who did not address the agent', () => {
    expect(policy.gate(chat('1', 'hi', { actor: { source: 'chat', id: 'ou_guest' } }), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(policy.gate(chat('1', 'hi', { human: false }), thread(), [])).toEqual({ admissible: false, reason: 'not_human' })
    expect(policy.gate(chat('1', 'hi', { meta: { chatId: CHAT, direct: false, mentioned: false } }), thread(), [])).toEqual({ admissible: false, reason: 'no_mention' })
  })
  it('assesses follow-ups on Threads with Tickets, explicit from an allowed sender and inferred from anyone else', () => {
    const quiet = { meta: { chatId: CHAT, direct: false, mentioned: false } }
    expect(policy.gate(chat('1', 'hi', { ...quiet, actor: { source: 'chat', id: 'ou_guest' } }), thread(['ticket']), []))
      .toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'followup' } })
    expect(policy.gate(chat('1', 'hi', quiet), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup' } })
    // A Thread a ticket follows only for context lends no follow-up: the admission table decides, as on any Thread.
    const context = { ...thread(['ticket']), context: ['ticket'] }
    expect(policy.gate(chat('1', 'hi', quiet), context, [ticket])).toMatchObject({ admissible: false })
  })
})

describe('admission table', () => {
  const STRANGER = 'ou_stranger'
  const withTable = (admission: Record<string, Record<string, string>>, config: Record<string, unknown> = {}, mode: 'off' | 'observe' | 'auto' = 'auto') =>
    SettingsSchema.parse({ ...base, eval: { ...base.eval, mode },
      sources: { ...base.sources, chat: { enabled: true, config: { ...base.sources.chat!.config, ...config } } },
      policy: { ...base.policy, sources: { ...base.policy.sources, chat: { ...base.policy.sources.chat!, admission } } } })
  const inChat = (chatId: string, sender = MEMBER, addressed = true): Trigger => {
    const message = chat('1', 'hi', { actor: { source: 'chat', id: sender }, meta: { chatId, direct: false, mentioned: addressed } })
    if (addressed) return message
    const { addressed: _addressed, ...rest } = message
    return rest
  }
  it('reproduces the behaviour before the table with every cell unset', () => {
    expect(policy.gate(inChat(OBSERVED, MEMBER, false), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred',
      basis: { via: 'admission', row: OBSERVED, cell: 'listedUnaddressed', observation: { mode: 'auto' } } })
    expect(policy.gate(inChat(CHAT, STRANGER), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
    expect(policy.gate(inChat(CHAT, STRANGER, false), thread(), [])).toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('makes an unlisted sender\'s mention explicit or inferred as the row says, and an inferred one waits for a mode that assesses', () => {
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })).policy.gate(inChat(CHAT, STRANGER), thread(), []))
      .toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'admission', cell: 'unlistedAddressed', addressed: 'mention' } })
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } })).policy.gate(inChat(CHAT, STRANGER), thread(), []))
      .toMatchObject({ admissible: true, strength: 'inferred', basis: { cell: 'unlistedAddressed' } })
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } }, {}, 'off')).policy.gate(inChat(CHAT, STRANGER), thread(), []))
      .toEqual({ admissible: false, reason: 'not_a_member' })
  })
  it('ignores a listed sender\'s unaddressed message where the row says so, and never reads the table for messages the chat does not receive', () => {
    expect(setup(withTable({ [OBSERVED]: { listedUnaddressed: 'ignore' } })).policy.gate(inChat(OBSERVED, MEMBER, false), thread(), []))
      .toEqual({ admissible: false, reason: 'admission_ignored' })
    expect(setup(withTable({ [CHAT]: { listedUnaddressed: 'inferred' } })).policy.gate(inChat(CHAT, MEMBER, false), thread(), []))
      .toEqual({ admissible: false, reason: 'no_mention' })
  })
  it('keeps follow-ups on a Thread with Tickets outside the table', () => {
    const strict = setup(withTable({ [OBSERVED]: { listedUnaddressed: 'ignore', unlistedUnaddressed: 'ignore' } }))
    expect(strict.policy.gate(inChat(OBSERVED, MEMBER, false), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup' } })
    expect(strict.policy.gate(inChat(OBSERVED, STRANGER, false), thread(['ticket']), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'followup' } })
  })
  it('invalidates a Mandate once its cell gives less than the strength it was accepted with, and keeps it while the cell holds', () => {
    const open = withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })
    const gate = setup(open).policy.gate(inChat(CHAT, STRANGER), thread(), [])
    if (!gate.admissible) throw new Error('expected admission')
    const mandate = { strength: gate.strength, policyVersion: 'v', basis: gate.basis, actor: { source: 'chat', id: STRANGER }, scope: '' }
    expect(setup(open).policy.revalidate(mandate)).toBe(true)
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'inferred' } })).policy.revalidate(mandate)).toBe(false)
    expect(setup(withTable({})).policy.revalidate(mandate)).toBe(false)
  })
  it('changes the Policy version when a cell changes, but not for pause or Source configuration', () => {
    const version = setup().version
    expect(setup(withTable({ [CHAT]: { unlistedAddressed: 'explicit' } })).version).not.toBe(version)
    expect(setup({ ...base, paused: true, executor: { ...base.executor, maxWorkers: 9 }, sources: {
      chat: { enabled: true, config: { chats: [], directMessages: false } } } }).version).toBe(version)
    expect(setup({ ...base, eval: { ...base.eval, mode: 'off' } }).version).not.toBe(version)
  })
})

describe('revalidate', () => {
  it('keeps explicit Mandates while the sender stays allowed and the Source still listens, and rule Mandates only while auto mode and the rules hold', () => {
    const basis: MandateBasis = { via: 'addressed', source: 'chat', scope: { chatId: CHAT, direct: false }, sender: 'Alice', addressed: 'mention' }
    const mandate = { strength: 'explicit' as const, policyVersion: 'v', basis, actor: { source: 'chat', id: MEMBER }, scope: '' }
    expect(policy.revalidate(mandate)).toBe(true)
    expect(setup({ ...base, policy: { ...base.policy, sources: {} } }).policy.revalidate(mandate)).toBe(false)
    expect(setup({ ...base, sources: { chat: { enabled: true, config: { chats: [], directMessages: true } } } }).policy.revalidate(mandate)).toBe(false)
    const inferred = { ...mandate, strength: 'inferred' as const, basis: { via: 'listed', observation: {}, rules: ['copy'] } satisfies MandateBasis }
    expect(policy.revalidate(inferred)).toBe(true)
    expect(setup({ ...base, eval: { ...base.eval, mode: 'observe' } }).policy.revalidate(inferred)).toBe(false)
  })
})

describe('assessment outcomes', () => {
  const settings = (mode: 'auto' | 'observe') => {
    const parsed = SettingsSchema.parse({})
    return { ...parsed, eval: { ...parsed.eval, mode } }
  }
  const direction = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
  const judged = (current: ReturnType<typeof settings>, matched: boolean) =>
    current.policy.rules.filter(rule => rule.enabled).map(rule => ({ rule_id: rule.id, matched, reason: 'judged' }))
  const accept = (current: ReturnType<typeof settings>, matched = true) => ({ decision: 'accept' as const, rule_assessments: judged(current, matched),
    direction, title: 'Fix', scope: 'small', reason: 'asked', intent_evidence: 'quote', worktree_name: 'fix-copy' })
  it('accepts an inferred candidate on its matched rules in auto mode only, and the Policy admits only enabled matched rules', () => {
    const auto = settings('auto')
    const outcome = assessmentOutcome(accept(auto), auto, 'inferred')
    expect(outcome).toMatchObject({ kind: 'accept', rules: auto.policy.rules.filter(rule => rule.enabled).map(rule => rule.id), name: 'fix-copy' })
    expect(assessmentOutcome(accept(settings('observe')), settings('observe'), 'inferred'))
      .toMatchObject({ kind: 'ignore', reason: { code: 'observed', values: { text: 'asked' } }, audit: { would_accept: true } })
    expect(assessmentOutcome(accept(auto, false), auto, 'inferred')).toMatchObject({ kind: 'ignore', reason: { code: 'noRuleMatched' } })
    expect(() => assessmentOutcome({ ...accept(auto), rule_assessments: [] }, auto, 'inferred')).toThrow('Exactly one assessment for every enabled rule')
    expect(() => assessmentOutcome({ ...accept(auto), intent_evidence: null }, auto, 'inferred')).toThrow('Acceptance requires intent_evidence')
  })
  it('refuses an assessment that judges one enabled rule twice and leaves another unjudged', () => {
    const parsed = SettingsSchema.parse({ eval: { mode: 'auto' }, policy: { rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' },
      { id: 'visual', name: 'Visual', enabled: true, instruction: 'Fix colors.' }] } })
    const direction = { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'asked' }
    const assessment = { decision: 'accept' as const, direction, title: 'Fix', scope: 'small', reason: 'asked', intent_evidence: 'quote',
      rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'typo' }, { rule_id: 'copy', matched: false, reason: 'again' }] }
    expect(() => assessmentOutcome(assessment, parsed, 'inferred')).toThrow('Exactly one assessment for every enabled rule')
    const once = { ...assessment, rule_assessments: [assessment.rule_assessments[0]!, { rule_id: 'visual', matched: false, reason: 'no colors' }] }
    expect(assessmentOutcome(once, parsed, 'inferred')).toMatchObject({ kind: 'accept', rules: ['copy'] })
  })
})

describe('admission table settings', () => {
  it('refuses an explicit cell for messages that do not address the agent, in the settings and in a submitted Policy', () => {
    for (const cell of ['listedUnaddressed', 'unlistedUnaddressed']) {
      const part = { allowed: [], admission: { [CHAT]: { [cell]: 'explicit' } } }
      expect(() => SettingsSchema.parse({ policy: { sources: { chat: part } } })).toThrow()
      expect(() => sources.validatePolicy({ chat: part })).toThrow()
    }
    expect(sources.validatePolicy({ chat: { allowed: [], admission: { [CHAT]: { unlistedAddressed: 'explicit' } } } }).chat)
      .toMatchObject({ admission: { [CHAT]: { unlistedAddressed: 'explicit' } } })
  })
  it('admits a listed bot that mentions the agent where the Source does not observe its messages', () => {
    const settings = SettingsSchema.parse({ ...base, policy: { ...base.policy, sources: { ...base.policy.sources,
      chat: { ...base.policy.sources.chat, bots: [{ id: 'cli_alerts' }] } } } })
    const mention = chat('1', 'hi', { actor: { source: 'chat', id: 'cli_alerts' }, human: false, meta: { chatId: CHAT, direct: false, mentioned: true } })
    expect(setup(settings).policy.gate(mention, thread(), [])).toMatchObject({ admissible: true, strength: 'inferred',
      basis: { via: 'bot', addressed: 'mention', row: CHAT } })
  })
})

describe('policy effects', () => {
  const scope = () => ({ scope: () => ({ listened: true as const, observed: true }) })
  const base = SettingsSchema.parse({ policy: { rules: [{ id: 'copy', name: 'Copy', enabled: true, instruction: 'Fix typos.' },
    { id: 'visual', name: 'Visual', enabled: true, instruction: 'Fix colors.' }],
    sources: { chat: { allowed: [{ id: MEMBER }] } } } })
  const ticket = (id: string, mandate: object) => ({ id, mandate } as unknown as Ticket)
  const inferred = ticket('t1', { strength: 'inferred', actor: { source: 'chat', id: 'ou_guest' }, basis: { via: 'listed', rules: ['copy'] } })
  const explicit = ticket('t2', { strength: 'explicit', actor: { source: 'chat', id: MEMBER }, basis: { via: 'listed', source: 'chat' } })
  it('tells a ticket how a change bears on it, and leaves the others alone', () => {
    const rules = (copy: object, visual: object = {}) => ({ ...base, policy: { ...base.policy, rules: [{ ...base.policy.rules[0]!, ...copy }, { ...base.policy.rules[1]!, ...visual }] } })
    expect(policyEffects([inferred, explicit], base, rules({}, { enabled: false }), scope).size).toBe(0)
    expect(policyEffects([inferred], base, rules({ instruction: 'Fix typos only.' }), scope).get('t1'))
      .toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'changed', instruction: 'Fix typos only.' }] })
    expect(policyEffects([inferred], base, rules({ enabled: false }), scope).get('t1')).toEqual({ rules: [{ id: 'copy', name: 'Copy', change: 'disabled' }] })
    const allowed = (list: { id: string }[]) => ({ ...base, policy: { ...base.policy, sources: { ...base.policy.sources, chat: { ...base.policy.sources.chat!, allowed: list } } } })
    expect(policyEffects([inferred, explicit], base, allowed([{ id: MEMBER }, { id: 'ou_bob' }]), scope).size).toBe(0)
    expect(policyEffects([explicit], base, allowed([]), scope).get('t2')).toEqual({ requesterAllowed: false, requester: { source: 'chat', id: MEMBER } })
  })
  it('tells an inferred ticket that inferred work is no longer accepted when the accept mode leaves auto', () => {
    const auto = { ...base, eval: { ...base.eval, mode: 'auto' as const } }
    const observe = { ...base, eval: { ...base.eval, mode: 'observe' as const } }
    const rule = ticket('t3', { strength: 'inferred', actor: { source: 'chat', id: MEMBER },
      basis: { via: 'listed', source: 'chat', rules: ['copy'], observation: {} } })
    const effects = policyEffects([rule, explicit], auto, observe, scope)
    expect(effects.get('t3')).toEqual({ proactive: false })
    expect(effects.has('t2')).toBe(false)
  })
})

describe('settings migration', () => {
  const feishuSource = (config: { chats: { chatId: string; listen: 'mentions' | 'all' }[]; directMessages: boolean }, enabled = true) => ({ enabled, config })
  it('moves each member\'s identity into each Source\'s part of the Policy and drops the fields prompts and the execution environment replaced', () => {
    const saved = SettingsSchema.parse(migrateSettings({
      policy: { members: [{ name: 'Alice', feishuId: MEMBER, github: 'alice' }, { name: 'Bob', feishuId: 'ou_bob', github: '' }, { name: 'Carol', feishuId: '', github: 'carol' }], memberChat: CHAT, autoMergeLineLimit: 300,
        rules: [{ id: 'visual', name: 'V', enabled: true, visual: true, instruction: 'x' }] },
      executor: { maxWorkers: 2, reviewer: 'dave', visualReviewer: 'carol', branchPrefix: 'bot/' },
      sources: { feishu: { enabled: true, config: { chats: [], directMessages: true }, authority: { chats: [] } } },
    }))
    expect(saved.policy).toEqual({
      rules: [{ id: 'visual', name: 'V', enabled: true, instruction: 'x' }],
      sources: { feishu: { allowed: [{ id: MEMBER, name: 'Alice' }, { id: 'ou_bob', name: 'Bob' }], syncChat: CHAT, admission: {} }, github: { allowed: [{ id: 'alice' }, { id: 'carol' }], admission: {} } },
    })
    expect(saved).toMatchObject({ paused: false, executor: { model: null, maxWorkers: 2, directory: '', prepare: '', blockedCommands: [] } })
    expect(saved.sources.feishu).toEqual({ enabled: true, config: { chats: [], directMessages: true } })
    expect(SettingsSchema.parse(migrateSettings(saved))).toEqual(saved)
    expect(SettingsSchema.parse(migrateSettings({ executor: { maxWorkers: 2, paused: true } }))).toMatchObject({ paused: true, executor: { maxWorkers: 2 } })
  })
  it('moves pre-domain chat lists into the Feishu Source, the pause into a setting of its own, and members into the Sources\' parts', () => {
    const migrated = SettingsSchema.parse(migrateSettings({ paused: true, allowedChats: [CHAT, OBSERVED], allowDirectMessages: false, pollSeconds: 120, maxWorkers: 5, members: [{ name: 'A', feishuId: MEMBER, github: 'a' }],
      models: { orchestrator: { provider: 'p', model: 'm' }, worker: null, admission: null }, admission: { mode: 'auto', chats: [OBSERVED], maxEvaluators: 1, timeoutSeconds: 90, rules: [] } }))
    expect(migrated.sources).toMatchObject({ feishu: feishuSource({ chats: [{ chatId: CHAT, listen: 'mentions' }, { chatId: OBSERVED, listen: 'all' }], directMessages: false }), github: { enabled: true, config: { pollSeconds: 120 } } })
    expect(migrated.policy.sources).toMatchObject({ feishu: { allowed: [{ id: MEMBER, name: 'A' }] }, github: { allowed: [{ id: 'a' }] } })
    expect(migrateSettings(migrated)).toEqual(migrated)
  })
})
