// @vitest-environment jsdom
// The Swarm launcher, the New swarm brief, and Open and Finish.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, settle, all, tab, click, type, text, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
const launcher = async () => { at({ page: 'swarms' }); await mount() }

it('lists active and completed swarms with their mission, workspace, status and master, marking legacy records read-only', async () => {
  await launcher()
  expect(tab(zh['tab.swarms']).getAttribute('aria-selected')).toBe('true')
  expect(server.requests.some(request => request.path === 'swarms' && request.method === 'GET')).toBe(true)
  expect(text()).toContain('登录回归')
  expect(text()).toContain('修好登录页的回归')
  expect(text()).toContain('/srv/repo')
  expect(text()).toContain('orchestrator-swarm-active')
  expect(text()).toContain(zh.swarmsActive)
  expect(text()).toContain(zh.swarmsCompleted)
  expect(text()).toContain(zh.swarmLegacy)
  expect(text()).toContain(zh.swarmReadOnly)
  // Only the active swarm offers Open and Finish; completed and legacy records are read-only.
  expect(all('.dt-row-buttons button').map(button => button.textContent)).toEqual([zh.swarmOpen, zh.swarmFinish])
})

it('posts the brief, opens the new swarm and leaves the form ready for the next one', async () => {
  await launcher()
  expect(field<HTMLInputElement>(zh.swarmWorkspace).value).toBe('/srv/repo')
  await type(field<HTMLInputElement>(zh.swarmTitle), '导航修复')
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '修好导航栏')
  await type(field<HTMLTextAreaElement>(zh.swarmAcceptance), '回归通过')
  await type(field<HTMLInputElement>(zh.swarmMaxTasks), '8')
  await type(field<HTMLInputElement>(zh.swarmWorkspace), '/srv/other')
  await click(zh.swarmCreate)
  expect(server.requests.find(request => request.path === 'swarms' && request.method === 'POST')?.body).toMatchObject({
    title: '导航修复', mission: '修好导航栏', acceptance: '回归通过', workspace: '/srv/other', verify: 'scripts/verify.sh', prepare: '',
    budget: { maxTasks: 8, maxWorkers: 2, maxRounds: 3 },
  })
  expect(server.requests.filter(request => request.method === 'POST' && /^swarms\/.+\/open$/.test(request.path))).toHaveLength(1)
  expect(server.opened).toEqual(['orchestrator-swarm-4'])
  expect(field<HTMLInputElement>(zh.swarmTitle).value).toBe('')
  expect(field<HTMLTextAreaElement>(zh.swarmMission).value).toBe('')
  expect(field<HTMLInputElement>(zh.swarmWorkspace).value).toBe('/srv/other')
})

it('opens an active swarm master through the panel', async () => {
  await launcher()
  await click(all('.dt-row-buttons button').find(button => button.textContent === zh.swarmOpen)!)
  expect(server.requests.some(request => request.path === 'swarms/swarm-active/open' && request.method === 'POST')).toBe(true)
  expect(server.opened).toEqual(['orchestrator-swarm-active'])
})

it('finishes an active swarm after confirmation and refreshes the list', async () => {
  await launcher()
  const reads = () => server.requests.filter(request => request.path === 'swarms' && request.method === 'GET').length
  const before = reads()
  await click(all('.dt-row-buttons button').find(button => button.textContent === zh.swarmFinish)!)
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'swarms/swarm-active/finish' && request.method === 'POST')).toBe(true)
  expect(server.swarms.find(swarm => swarm.id === 'swarm-active')).toMatchObject({ status: 'completed' })
  expect(reads()).toBeGreaterThan(before)
  expect(all('.dt-row-buttons button')).toHaveLength(0)
})

it('reports a refused action in the interface language without dropping the active swarm', async () => {
  server.swarmError = 'Swarm swarm-active still has 1 open ticket'
  await launcher()
  await click(all('.dt-row-buttons button').find(button => button.textContent === zh.swarmFinish)!)
  await click(zh.confirm)
  await settle()
  expect(document.querySelector('.dt-toast')?.textContent).toBe('Swarm swarm-active still has 1 open ticket')
  expect(server.swarms.find(swarm => swarm.id === 'swarm-active')).toMatchObject({ status: 'active' })
})
