// @vitest-environment jsdom
// The Eval status and settings.
import { act } from 'react'
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, find, tab, click, type, text, field } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
it('opens the Decisions under Policy from the flow line with their reasons, Decisions that start work first, filterable by kind',
  async () => {
  await mount()
  await click(all('.dt-stat button')[1]!)
  expect(tab(zh['tab.eval']).getAttribute('aria-selected')).toBe('true')
  expect(server.requests.some(request => request.path === 'decisions?limit=30&kind=accept,reopen&window=24h')).toBe(true)
  expect(text()).toContain(zh['reason.explicitRouted'])
  await click(zh.stop)
  expect(server.requests.some(request => request.path === 'decisions?limit=30&kind=stop&window=24h')).toBe(true)
  expect(text()).toContain('修一下')
  await click(zh['decision.ignore'])
  expect(server.requests.some(request => request.path === 'decisions?limit=30&kind=ignore&window=24h')).toBe(true)
  expect(text()).toContain(zh.none)
  await click(zh.lastDayOnly)
  expect(server.requests.some(request => request.path === 'decisions?limit=30&kind=ignore')).toBe(true)
})

it('keeps a Policy draft across remounts, and merges another save into it sender by sender and rule by rule', async () => {
  const addUser = async () => {
    await click(all('.dt-part button').find(button => button.textContent === '添加')!)
    const row = all('.dt-part .dt-rows-item').at(-1)!
    await type(row.querySelector<HTMLInputElement>('input[aria-label="id"]')!, 'local-newperson')
    await type(row.querySelector<HTMLInputElement>('input[aria-label="名称"]')!, '新人')
  }
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(all('.dt-subtab')).toEqual([])
  await addUser()
  expect(text()).toContain(zh.draftKept)
  await remount()
  expect(text()).toContain(zh.draftRestored)
  expect(all('.dt-part .dt-rows-item')).toHaveLength(2)
  // Someone else renames a rule and allows another sender meanwhile: the draft keeps its own sender and takes both of theirs.
  const { policy } = server.settings
  server.settings = { ...server.settings, policy: { ...policy, rules: [{ ...policy.rules[0]!, name: '文案' }],
    sources: { ...policy.sources, local: { ...policy.sources.local!, allowed: [...policy.sources.local!.allowed, { id: 'local-bob',
      name: 'Bob' }] } } } }
  server.revisions.policy = 4
  await click(zh.save)
  expect(text()).toContain(zh.saveMerged)
  await type(all('.dt-part input[aria-label="名称"]').at(-2) as HTMLInputElement, '新同事')
  expect(text()).not.toContain(zh.saveMerged)
  await click(zh.save)
  expect(server.settings.policy.sources.local!.allowed).toEqual([{ id: 'local-user', name: 'Local user' }, { id: 'local-newperson',
    name: '新同事' }, { id: 'local-bob', name: 'Bob' }])
  expect(server.settings.policy.rules.map(rule => rule.name)).toEqual(['文案'])
  expect(sessionStorage.getItem('dsh-superagent/draft/master/policy')).toBeNull()
})

it('keeps the Policy to its rules and the local Source\'s allowed list', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['term.eval'], '.dt-settings-link'))
  // No dormant remote Source settings or admission table remain in the Policy.
  for (const gone of ['自动合并', '行数阈值', '成员', '在各来源上', '接收范围']) expect(text()).not.toContain(gone)
  expect(all('.dt-lv').map(item => item.textContent)[0]).toBe('策略版本 abcdef12')
  expect(text()).toContain('本地用户在 DSH 主 Session 中明确提出的请求')
  expect(text()).toContain('允许发起本地请求的人')
  // A saved account shows as its id; only a row being added is a field.
  expect(all('.dt-part .dt-rows-item .dt-row-label').map(label => label.textContent)).toEqual(['local-user'])
})

it('opens the rule list for an invalid field inside it only', async () => {
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  const openRows = () => all('.dt-disclosure[data-open]').length
  await act(async () => { field(zh.evalTimeout).dispatchEvent(new Event('invalid', { bubbles: false })) })
  expect(openRows()).toBe(0)
  await click(all('.dt-rule [data-disclosure-row]')[0]!)
  await act(async () => { all('.dt-rule input')[0]!.dispatchEvent(new Event('invalid')) })
  expect(openRows()).toBe(all('.dt-rule').length)
})

it('adds, copies, renames, disables and deletes rules in Policy without touching Eval', async () => {
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await click(zh.addRule)
  await type(field<HTMLInputElement>(zh.ruleName), '文档')
  await type(field<HTMLTextAreaElement>(zh.ruleInstruction), '修复失效链接')
  await click(zh.duplicate)
  expect(all('.dt-rule').map(rule => rule.querySelector('[data-disclosure-row]')!.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('文档 副本')]))
  await click('启用规则：文案修改')
  const removeButtons = all('button').filter(button => button.textContent === '删除')
  await click(removeButtons.at(-1)!)
  await click(zh.save)
  expect(server.settings.policy.rules.map(rule => [rule.name, rule.enabled])).toEqual([['文案修改', false], ['文档', true]])
  expect(server.requests.filter(request => request.method === 'PUT').map(request => request.path)).toEqual(['settings/policy'])
})

it('shows the current Policy version once, explains what makes it up, and opens a Mandate\'s version in the Policy history', async () => {
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await settle()
  expect(all('.dt-lv')[0]!.textContent).toBe('策略版本 abcdef12')
  expect(all('.dt-info').map(tip => tip.getAttribute('aria-label')).join('\n')).toContain('策略版本由接单规则、本地来源上的策略和评估的接单模式决定')
  expect(all('.dt-tag').filter(tag => tag.textContent === '计入策略版本')).toHaveLength(0)
  await click(tab(zh['tab.execution']))
  await click('修复回归')
  await click('abcdef12')
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['term.eval'])
  await settle()
  // The history opens at the save that made the version, and lists versions that Source saves made too.
  expect(document.querySelector('.dt-highlight')?.textContent).toContain('生成策略版本 abcdef12')
  expect(text()).toContain('生成策略版本 98765432')
})

it('shows the local Policy in English', async () => {
  await mount(en)
  await click(tab(en['tab.settings']))
  await click(find(en['term.eval'], '.dt-settings-link'))
  expect(text()).toContain(en.policyLocal)
  expect(text()).toContain('People who may start local requests')
  expect(all('.dt-info').map(tip => tip.getAttribute('aria-label')).join('\n')).toContain(en.policyLocalHint)
})
