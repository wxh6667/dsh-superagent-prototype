// @vitest-environment jsdom
// The Swarm launcher: a goal and a workspace up front, the rest under Advanced, and the active and completed swarms.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { modelOf } from '../src/client/swarms.tsx'
import { usePanel, mount, settle, all, tab, click, type, text, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
const launcher = async () => { at({ page: 'swarms' }); await mount() }
const posted = () => server.requests.find(request => request.path === 'swarms' && request.method === 'POST')?.body as Record<string, unknown>

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

it('asks for only a goal and a workspace, and keeps the rest of the brief under Advanced', async () => {
  await launcher()
  expect(field<HTMLTextAreaElement>(zh.swarmMission).required).toBe(true)
  // The workspace is a dropdown of registered workspaces, with the local repository selected by default.
  expect(field<HTMLSelectElement>(zh.swarmWorkspace).value).toBe('/srv/repo')
  expect(all('select.dt-select option').map(option => option.textContent)).toEqual([zh.swarmWorkspaceChoose,
    'Local repository — /srv/repo', 'Other repository — /srv/other'])
  // Acceptance, the title and the budget stay folded away until Advanced is opened.
  expect(text()).not.toContain(zh.swarmAcceptance)
  expect(text()).not.toContain(zh.swarmTitle)
  await click(zh.swarmAdvanced)
  expect(text()).toContain(zh.swarmAcceptance)
  expect(text()).toContain(zh.swarmTitle)
  expect(text()).toContain(zh.swarmMaxTasks)
})

it('posts the goal with the chosen workspace, derives the title and leaves the form ready for the next swarm', async () => {
  await launcher()
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '修好导航栏\n第二行也忽略')
  await click(zh.swarmCreate)
  // The title comes from the mission's first line, truncated to the stored limit.
  expect(posted()).toMatchObject({ title: '修好导航栏', mission: '修好导航栏\n第二行也忽略', workspace: '/srv/repo',
    verify: 'scripts/verify.sh', prepare: '', budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 } })
  expect(server.requests.filter(request => request.method === 'POST' && /^swarms\/.+\/open$/.test(request.path))).toHaveLength(1)
  expect(server.opened).toEqual(['orchestrator-swarm-4'])
  expect(field<HTMLTextAreaElement>(zh.swarmMission).value).toBe('')
  expect(field<HTMLSelectElement>(zh.swarmWorkspace).value).toBe('/srv/repo')
})

it('chooses a registered workspace, and types an unregistered one after switching to manual entry', async () => {
  await launcher()
  await type(field<HTMLSelectElement>(zh.swarmWorkspace), '/srv/other')
  expect(field<HTMLSelectElement>(zh.swarmWorkspace).value).toBe('/srv/other')
  await click(zh.swarmWorkspaceManual)
  expect(field<HTMLInputElement>(zh.swarmWorkspace).value).toBe('/srv/other')
  await type(field<HTMLInputElement>(zh.swarmWorkspace), '/srv/unregistered')
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '任意目标')
  await click(zh.swarmCreate)
  expect(posted()).toMatchObject({ workspace: '/srv/unregistered' })
})

it('edits the derived title and the rest of the brief under Advanced', async () => {
  await launcher()
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '目标首行\n更多细节')
  await click(zh.swarmAdvanced)
  expect(field<HTMLInputElement>(zh.swarmTitle).getAttribute('placeholder')).toBe('目标首行')
  await type(field<HTMLInputElement>(zh.swarmTitle), '自定义标题')
  await type(field<HTMLTextAreaElement>(zh.swarmAcceptance), '回归通过')
  await type(field<HTMLInputElement>(zh.swarmMaxTasks), '8')
  await click(zh.swarmCreate)
  expect(posted()).toMatchObject({ title: '自定义标题', acceptance: '回归通过', budget: { maxTasks: 8, maxWorkers: 2, maxRounds: 3 } })
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

it('pins a model per role from the catalog, defaults to inherit, and shows the choice on the row', async () => {
  await launcher()
  await click(zh.swarmAdvanced)
  // Both dropdowns start at inherit and offer every catalog provider's models.
  const master = field<HTMLSelectElement>(zh.swarmMasterModel), worker = field<HTMLSelectElement>(zh.swarmWorkerModel)
  expect(master.value).toBe('')
  expect(worker.value).toBe('')
  expect([...master.options].map(option => option.textContent)).toEqual([zh.swarmModelInherit, 'Worker model'])
  // Pin the worker model only; the master keeps inheriting the global setting.
  const choice = [...worker.options].find(option => option.textContent === 'Worker model')!
  await type(worker, choice.value)
  expect(choice.selected).toBe(true)
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '按 Swarm 选模型')
  await click(zh.swarmCreate)
  expect(posted()).toMatchObject({ workerModel: { provider: 'worker-provider', model: 'worker-model' } })
  expect(posted()).not.toHaveProperty('masterModel')
  // The new row shows the pin, and the role left unset as inheriting.
  expect(text()).toContain('worker-provider / worker-model')
  expect(text()).toContain(zh.swarmModelInherit)
})

it('says the catalog is unavailable instead of offering or saving a model when it cannot be read', async () => {
  server.modelsError = 'catalog is down'
  await launcher()
  await click(zh.swarmAdvanced)
  expect(text()).toContain('catalog is down')
  // Only inherit remains selectable, so creating a swarm cannot save an unreadable model.
  const worker = field<HTMLSelectElement>(zh.swarmWorkerModel)
  expect([...worker.options].map(option => option.textContent)).toEqual([zh.swarmModelInherit])
  await type(field<HTMLTextAreaElement>(zh.swarmMission), '没有模型目录')
  await click(zh.swarmCreate)
  expect(posted()).not.toHaveProperty('masterModel')
  expect(posted()).not.toHaveProperty('workerModel')
})

it('reads only the model values the launcher wrote, never turning an unreadable one into inherit', () => {
  expect(modelOf('')).toBeUndefined()
  expect(modelOf(JSON.stringify(['provider-a', 'model-a']))).toEqual({ provider: 'provider-a', model: 'model-a' })
  for (const value of ['provider-a/model-a', '[]', JSON.stringify(['provider-a', '']), JSON.stringify(['', 'model-a']),
    JSON.stringify([1, 2]), JSON.stringify(['a', 'b', 'c'])]) expect(modelOf(value)).toBe(false)
})
