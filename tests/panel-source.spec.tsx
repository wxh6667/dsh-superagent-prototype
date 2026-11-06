// @vitest-environment jsdom
// The Local Source status and settings.
import { act } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, find, tab, click, type, text, field, at } from './fixtures/panel.tsx'
import { server, problemOf, droppedReply } from './fixtures/panel-server.ts'

usePanel()
it('shows the Local Source on the Source status, with its health and counts, and opens its settings from a setup problem', async () => {
  server.health = { local: { state: 'error', detail: 'repository vanished' } }
  await mount()
  await click(zh['tab.source'])
  expect(document.querySelector('.dt-status-title')?.textContent).toBe(zh.statusTitle)
  expect(all('.dt-form > .dt-list > .dt-row .dt-row-name').map(title => title.textContent)).toEqual(['本地'])
  expect(all('.dt-form > .dt-list > .dt-row')[0]!.querySelector('.dt-row-meta')?.textContent).toBe('24 小时到达 12被过滤 2最近 '
    + document.querySelector('.dt-row-meta time, .dt-row-meta .dt-lv:last-child .dt-lv-value')?.textContent)
  expect(text()).toContain(zh['sourceState.error'])
  expect(text()).toContain('repository vanished')
  expect(all('.dt-card')).toHaveLength(0)
  server.setup = { ...server.setup, problem: problemOf('localRepositoryMissing', { path: '/srv/repo' }) }
  await remount()
  await click(zh['tab.source'])
  await click(zh.sourceOpenSettings)
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['term.source'])
  expect(document.getElementById('dt-source-local')!.textContent).toContain('部署检查未通过：本地仓库不存在：/srv/repo。')
})

it('shows the Local Source waiting for the deployment check', async () => {
  server.setup = { ...server.setup, problem: problemOf('gitTooOld'), accounts: null }
  await mount()
  await click(zh['tab.source'])
  const rows = all('.dt-form > .dt-list > .dt-row')
  expect(rows.map(row => row.querySelector('.dt-status-text')?.textContent)).toEqual(['等待部署检查'])
  expect(text()).not.toContain('Waiting for setup')
})

it('shows the Local Source health in the interface language, and a diagnostic as reported', async () => {
  server.health = { local: { state: 'error', detail: '3 consecutive failed polls; last: EOF', code: 'pollFailures', values: { count: '3',
    error: 'EOF' } } }
  await mount()
  await click(zh['tab.source'])
  const local = all('.dt-form > .dt-list > .dt-row')[0]!
  expect(local.textContent).toContain('本地来源：连续 3 次轮询失败，最近一次：EOF')
  expect(local.textContent).not.toContain('consecutive')
})

it('lists the Triggers the Local Source filtered in the last day, with why', async () => {
  await mount()
  await click(zh['tab.source'])
  const local = all('.dt-form > .dt-list > .dt-row')[0]!
  const disclosure = [...local.querySelectorAll<HTMLElement>('[data-disclosure-row]')]
    .find(row => row.textContent?.includes(zh.sourceFilteredTitle))!
  await click(disclosure)
  const rows = [...local.querySelectorAll('.dt-disclosure-body .dt-row')].map(row => [row.querySelector('.dt-row-title')?.textContent,
    row.querySelector('.dt-tag')?.textContent])
  expect(rows).toEqual([['本地用户：looks wrong', zh['reason.source_disabled']]])
})

it('lists the replies the Local Source did not send in the last day, newest first, with why and where they belong', async () => {
  // Include a drop older than 24h (m0) and one of another Source (g0), which is not on the local status.
  server.dropped = [droppedReply('m2', 1, 'local', 'channelGone', { ticket: { id: 't1', title: '修复回归' } }),
    droppedReply('m1', 3, 'local', 'channelIgnored'), droppedReply('m0', 30, 'local', 'channelGone'),
    droppedReply('g0', 2, 'github', 'channelGone')]
  await mount()
  await click(zh['tab.source'])
  const local = all('.dt-form > .dt-list > .dt-row')[0]!
  const disclosure = [...local.querySelectorAll<HTMLElement>('[data-disclosure-row]')]
    .find(row => row.textContent?.includes(zh.sourceDroppedTitle))!
  await click(disclosure)
  const rows = [...local.querySelectorAll('.dt-disclosure-body .dt-row')].map(row => [row.querySelector('.dt-row-title')?.textContent,
    row.querySelector('.dt-tag')?.textContent, row.querySelector('button')?.textContent])
  expect(rows).toEqual([['Reply m2', zh['reason.channelGone'], '修复回归'], ['Reply m1', zh['reason.channelIgnored'], zh['term.thread']]])
  expect(text()).not.toContain('Reply g0')
  await click(find('修复回归', '.dt-disclosure-body button'))
  expect(tab(zh['tab.execution']).getAttribute('aria-selected')).toBe('true')
})

it('takes no space for messages that were all sent', async () => {
  await mount()
  await click(zh['tab.source'])
  expect(text()).not.toContain(zh.sourceDroppedTitle)
})

it('renders the Local Source settings from its kind\'s fields and saves them against their own revision', async () => {
  await mount()
  await click(zh['tab.source'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  const card = all('.dt-card').find(card => card.id === 'dt-source-local')!
  expect(card.querySelector('.dt-card-title')?.textContent).toBe('本地')
  expect(card.textContent).toContain('本地仓库')
  expect(field<HTMLInputElement>('本地仓库').value).toBe('/srv/repo')
  expect(field<HTMLInputElement>('基础分支').value).toBe('main')
  expect(field<HTMLInputElement>('验证命令').value).toBe('scripts/verify.sh')
  await type(field<HTMLInputElement>('本地仓库'), '/srv/other')
  // Every local field is read by setup, so the save warns that it restarts dsh-superagent.
  expect(card.textContent).toContain('保存会重启 dsh-superagent：2 个进行中的派工会中断，并带恢复说明重新开始。')
  await act(async () => { card.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle()
  expect(server.requests.find(request => request.path === 'settings/source:local')).toMatchObject({ method: 'PUT', body: { revision: 0,
    value: { enabled: true, config: expect.objectContaining({ repository: '/srv/other' }) } } })
  expect(server.settings.sources.local!.config).toMatchObject({ repository: '/srv/other' })
})

it('shows a setup problem on the Local Source card within one read of the settings, which the settings groups share', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => { vi.useRealTimers() })
  at({ page: 'settings', query: { group: 'source' } })
  await mount()
  const card = () => document.getElementById('dt-source-local')!
  expect(card().textContent).not.toContain('本地仓库不存在：/srv/repo。')
  server.setup = { ...server.setup, problem: problemOf('localRepositoryMissing', { path: '/srv/repo' }) }
  // The settings are read every five seconds, as the state is; the Source settings do not read the Source status.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) }); await settle()
  expect(server.requests.filter(request => request.path === 'settings')).toHaveLength(2)
  expect(server.requests.some(request => request.path === 'sources')).toBe(false)
  expect(card().textContent).toContain('本地仓库不存在：/srv/repo。')
})
