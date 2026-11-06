// @vitest-environment jsdom
// The Swarm's task status in the conversation header, shown only for the master Session of an active Swarm.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { SwarmStatus } from '../src/client/swarm-status.tsx'
import { settle, translator } from './fixtures/panel.tsx'
import { server, usePanelServer } from './fixtures/panel-server.ts'

let root: Root | undefined
let container: HTMLElement | undefined
const unmount = () => {
  if (root) act(() => { root!.unmount() })
  root = undefined
  container?.remove()
  container = undefined
}
usePanelServer(unmount)

async function render(sessionId: string) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<SwarmStatus sessionId={sessionId} t={translator(zh)} />) })
  await settle()
}

it('shows the owning Swarm\'s running, waiting and just-ended counts with its latest change', async () => {
  server.swarms[0] = { ...server.swarms[0]!, tasks: { running: 2, pending: 1, ended: 3,
    latest: { ticketId: 't1', title: '修好登录页', at: '2026-11-06T00:00:00Z', stage: { stage: 'working' } } } }
  await render('orchestrator-swarm-active')
  const status = document.querySelector('.dt-swarm-status')
  expect(status?.textContent).toContain('在跑 2 · 待跑 1 · 刚结束 3')
  expect(status?.textContent).toContain('修好登录页')
  expect(status?.textContent).toContain(zh['stage.working'])
  expect(status?.getAttribute('title')).toBe(zh.swarmStatusHint)
})

it('renders nothing when the Session owns no active Swarm, so non-swarm Sessions keep a bare header', async () => {
  await render('orchestrator-unknown')
  expect(document.querySelector('.dt-swarm-status')).toBeNull()
  // A completed Swarm's archived master shows nothing either.
  await render('orchestrator-swarm-done')
  expect(document.querySelector('.dt-swarm-status')).toBeNull()
})
