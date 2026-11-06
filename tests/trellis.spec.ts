/** The thin Trellis adapter: task creation, artifacts, session-scoped start, archive and path validation. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainTools, type MainToolsHost } from '../src/app/tools/main.ts'
import { workerCommitGuard } from '../src/app/sessions.ts'
import type { Swarm, Ticket } from '../src/core/index.ts'
import { Trellis, slugify, trellisCommitGuard } from '../src/infra/trellis.ts'

let dir: string
let repo: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trellis-'))
  repo = join(dir, 'repo')
  mkdirSync(join(repo, '.trellis', 'scripts'), { recursive: true })
  mkdirSync(join(repo, '.trellis', 'tasks'), { recursive: true })
  writeFileSync(join(repo, '.trellis', 'scripts', 'task.py'), '')
  writeFileSync(join(repo, '.trellis', '.developer'), 'name=project-agent\n')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function adapter() {
  const calls: { argv: string[]; cwd: string; env: Record<string, string | undefined> }[] = []
  const run = vi.fn(async (argv: string[], cwd: string, env: Record<string, string | undefined>) => {
    calls.push({ argv, cwd, env })
    if (argv[2] === 'create') {
      const slug = argv[argv.indexOf('--slug') + 1]!
      mkdirSync(join(repo, '.trellis', 'tasks', `11-05-${slug}`), { recursive: true })
    }
    if (argv[2] === 'current') return JSON.stringify({ current_task: { dir: '.trellis/tasks/11-05-work', status: 'in_progress' } })
    return ''
  })
  return { calls, run, trellis: new Trellis({ repository: () => repo, sessionId: 'session-1', run }) }
}

describe('Trellis adapter', () => {
  it('creates a parent and children with artifacts, and starts the parent for the main Session', async () => {
    const { calls, trellis } = adapter()
    const plan = await trellis.plan({
      parent: { title: 'Local work', description: 'Parent', prd: '# Parent', design: '# Design', implement: '# Implement' },
      children: [{ title: 'First child', description: 'First', prd: '# Child' }],
    })
    expect(plan.parent.dir).toBe(join(repo, '.trellis', 'tasks', '11-05-local-work'))
    expect(plan.children[0]!.dir).toBe(join(repo, '.trellis', 'tasks', '11-05-first-child'))
    expect(readFileSync(join(plan.parent.dir, 'prd.md'), 'utf8')).toBe('# Parent')
    expect(readFileSync(join(plan.parent.dir, 'design.md'), 'utf8')).toBe('# Design')
    expect(readFileSync(join(plan.parent.dir, 'implement.md'), 'utf8')).toBe('# Implement')
    expect(readFileSync(join(plan.children[0]!.dir, 'prd.md'), 'utf8')).toBe('# Child')
    const childCreate = calls.find(call => call.argv[2] === 'create' && call.argv[3] === 'First child')!
    expect(childCreate.argv).toContain('--parent')
    expect(childCreate.argv[childCreate.argv.indexOf('--parent') + 1]).toBe(plan.parent.dir)
    const start = calls.find(call => call.argv[2] === 'start')!
    expect(start.argv).toContain('--allow-empty-context')
    expect(start.env.DSH_SESSION_ID).toBe('session-1')
    expect(start.argv.at(-1)).toBe('.trellis/tasks/11-05-local-work')
  })

  it('archives a task and reads the current task, refusing paths outside the task tree', async () => {
    const { calls, trellis } = adapter()
    const plan = await trellis.plan({ parent: { title: 'Work', description: 'Parent', prd: '# P' }, children: [] })
    await trellis.archive(plan.parent.dir)
    expect(calls.some(call => call.argv[2] === 'archive' && call.argv.includes('.trellis/tasks/11-05-work'))).toBe(true)
    await expect(trellis.current()).resolves.toEqual({ dir: '.trellis/tasks/11-05-work', status: 'in_progress' })
    await expect(trellis.archive(join(repo, 'outside'))).rejects.toThrow('Not a task directory')
  })

  it('refuses a repository without Trellis, and derives safe slugs', async () => {
    const plain = join(dir, 'plain'); mkdirSync(plain)
    const trellis = new Trellis({ repository: () => plain, sessionId: 's', run: vi.fn() })
    await expect(trellis.plan({ parent: { title: 'Work', description: 'Parent', prd: '# P' }, children: [] })).rejects.toThrow('no Trellis task script')
    expect(slugify('Fix the plan color!')).toBe('fix-the-plan-color')
    expect(slugify('中文')).toBe('task')
  })
})

const swarmFixture = (workspace: string): Swarm => ({
  id: 'swarm-1', title: 'Swarm', mission: 'Mission', workspace, verify: 'scripts/verify.sh', prepare: '',
  budget: { maxTasks: 20, maxWorkers: 2, maxRounds: 3 }, status: 'active', masterSessionId: 'orchestrator-swarm-1',
  createdAt: '2026-10-01T00:00:00.000Z',
})
describe('main Session local tools', () => {
  const ownedTicket = (id: string, swarmId: string, ended = false): Ticket => ({
    id, swarmId, ...ended ? { ended: { at: '2026-10-02T00:00:00.000Z', by: 'executor', outcome: 'completed' } } : {},
  } as Ticket)
  function tools(swarm?: Swarm, existing: Ticket[] = []) {
    const trellis = { plan: vi.fn(async () => ({ parent: { dir: '/p', title: 'Parent' }, children: [] })), archive: vi.fn() }
    const swarmTrellis = { plan: vi.fn(async () => ({ parent: { dir: '/s', title: 'Swarm parent' }, children: [] })), archive: vi.fn() }
    const trellisFor = vi.fn(() => swarmTrellis)
    const host = {
      context: { logger: { warn: vi.fn() } },
      engine: { decide: vi.fn(() => ({ kind: 'accept', ticketId: 't1', reason: { code: 'explicitRouted' } })) },
      store: { tickets: { get: (id: string) => existing.find(ticket => ticket.id === id), list: () => existing } },
      prompts: {}, sessions: {}, settings: {}, assessor: {}, resources: {},
      local: () => ({ repository: repo, baseBranch: 'main', verify: 'scripts/verify.sh', actor: 'local-user', actorName: 'Local user' }),
      trellis, trellisFor,
      masterId: 'session-1', receive: vi.fn(() => 'stored'), requestPass: vi.fn(), sendReplies: vi.fn(), quietly: (run: () => unknown) => run(),
    } as unknown as MainToolsHost
    return { host, tools: mainTools(host, { id: 'master' } as never, swarm), trellis, swarmTrellis, trellisFor }
  }
  it('creates a plan without creating Tickets', async () => {
    const { host, tools: list } = tools()
    const plan = list.find(tool => tool.name === 'orchestrator_trellis_plan')!
    const result = await plan.execute({ parent: { title: 'Parent', description: 'Parent', prd: '# P' }, children: [] }, new AbortController().signal)
    expect(host.trellis.plan).toHaveBeenCalledWith({ parent: { title: 'Parent', description: 'Parent', prd: '# P' }, children: [] })
    expect(result).toMatchObject({ parent: { dir: '/p', title: 'Parent' }, children: [] })
    expect(host.engine.decide).not.toHaveBeenCalled()
  })
  it('dispatches one local Trigger and Ticket per task, with separate threads', async () => {
    const { host, tools: list } = tools()
    const dispatch = list.find(tool => tool.name === 'orchestrator_local_dispatch')!
    const first = join(repo, '.trellis', 'tasks', '11-05-local-work')
    const second = join(repo, '.trellis', 'tasks', '11-05-other-work')
    const result = await dispatch.execute({ tasks: [
      { task_dir: first, title: 'Local work', acknowledgement: 'On it' },
      { task_dir: second, title: 'Other work', acknowledgement: 'On it too' },
    ] }, new AbortController().signal)
    expect(host.receive).toHaveBeenCalledTimes(2)
    expect(host.engine.decide).toHaveBeenCalledTimes(2)
    // The dispatching Session owns the thread and the Ticket's reports when no Swarm does.
    expect(host.receive).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: 'local', human: true, addressed: 'direct',
      threads: [{ source: 'local', id: 'local:master:11-05-local-work' }], channel: expect.objectContaining({ source: 'local' }),
      meta: { task_dir: first, repository: repo, originSessionId: 'master' } }))
    expect(host.receive).toHaveBeenNthCalledWith(2, expect.objectContaining({ threads: [{ source: 'local', id: 'local:master:11-05-other-work' }],
      meta: { task_dir: second, repository: repo, originSessionId: 'master' } }))
    expect(host.engine.decide).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ kind: 'accept', title: 'Local work',
      name: 'local-work', reason: { code: 'explicitRouted' } }))
    expect(host.engine.decide).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ title: 'Other work', name: 'other-work' }))
    expect(result).toMatchObject({ results: [{ decision: 'accept' }, { decision: 'accept' }] })
    expect(host.requestPass).toHaveBeenCalled()
  })
  it('uses the calling swarm\'s Trellis for plan and archive instead of the legacy one', async () => {
    const workspace = join(dir, 'swarm-workspace')
    mkdirSync(join(workspace, '.trellis', 'tasks'), { recursive: true })
    const swarm = swarmFixture(workspace)
    const { host, tools: list, trellis, swarmTrellis, trellisFor } = tools(swarm)
    const plan = list.find(tool => tool.name === 'orchestrator_trellis_plan')!
    const planned = await plan.execute({ parent: { title: 'Parent', description: 'Parent', prd: '# P' }, children: [] }, new AbortController().signal)
    expect(trellisFor).toHaveBeenCalledWith(swarm)
    expect(swarmTrellis.plan).toHaveBeenCalledWith({ parent: { title: 'Parent', description: 'Parent', prd: '# P' }, children: [] })
    expect(trellis.plan).not.toHaveBeenCalled()
    expect(planned).toMatchObject({ parent: { dir: '/s', title: 'Swarm parent' }, repository: workspace })
    const taskDir = join(workspace, '.trellis', 'tasks', '11-05-swarm-work')
    const archive = list.find(tool => tool.name === 'orchestrator_trellis_archive')!
    await expect(archive.execute({ task_dir: taskDir }, new AbortController().signal)).resolves.toEqual({ archived: taskDir })
    expect(swarmTrellis.archive).toHaveBeenCalledWith(taskDir)
    expect(trellis.archive).not.toHaveBeenCalled()
  })
  it('dispatches a swarm\'s tasks into its workspace with the swarm thread key and metadata, refusing tasks outside it', async () => {
    const workspace = join(dir, 'swarm-workspace')
    mkdirSync(join(workspace, '.trellis', 'tasks'), { recursive: true })
    const swarm = swarmFixture(workspace)
    const { host, tools: list } = tools(swarm)
    const dispatch = list.find(tool => tool.name === 'orchestrator_local_dispatch')!
    const taskDir = join(workspace, '.trellis', 'tasks', '11-05-swarm-work')
    const outside = join(repo, '.trellis', 'tasks', '11-05-outside')
    const result = await dispatch.execute({ tasks: [
      { task_dir: taskDir, title: 'Swarm work', acknowledgement: 'On it' },
      { task_dir: outside, title: 'Outside work', acknowledgement: 'On it too' },
    ] }, new AbortController().signal)
    expect(host.receive).toHaveBeenCalledTimes(1)
    expect(host.receive).toHaveBeenCalledWith(expect.objectContaining({
      source: 'local', human: true, addressed: 'direct',
      threads: [{ source: 'local', id: 'local:swarm-1:11-05-swarm-work' }],
      channel: expect.objectContaining({ source: 'local', thread: 'local:swarm-1:11-05-swarm-work' }),
      meta: { task_dir: taskDir, repository: workspace, swarmId: 'swarm-1', originSessionId: 'master' },
    }))
    expect(host.engine.decide).toHaveBeenCalledTimes(1)
    expect(host.engine.decide).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ kind: 'accept', title: 'Swarm work', name: 'swarm-work' }))
    expect(result).toMatchObject({ results: [
      { task_dir: taskDir, decision: 'accept' },
      { task_dir: outside, refused: expect.stringContaining('Not a Trellis task') },
    ] })
  })
  it('refuses a swarm dispatch that would exceed maxTasks before creating any Ticket', async () => {
    const workspace = join(dir, 'swarm-workspace')
    mkdirSync(join(workspace, '.trellis', 'tasks'), { recursive: true })
    const swarm = { ...swarmFixture(workspace), budget: { maxTasks: 2, maxWorkers: 2, maxRounds: 3 } }
    // Ended tickets count too; another swarm's ticket does not.
    const { host, tools: list } = tools(swarm, [ownedTicket('t-old', swarm.id, true), ownedTicket('t-other', 'other')])
    const dispatch = list.find(tool => tool.name === 'orchestrator_local_dispatch')!
    const first = join(workspace, '.trellis', 'tasks', '11-05-one')
    const second = join(workspace, '.trellis', 'tasks', '11-05-two')
    await expect(dispatch.execute({ tasks: [
      { task_dir: first, title: 'One', acknowledgement: 'On it' },
      { task_dir: second, title: 'Two', acknowledgement: 'On it too' },
    ] }, new AbortController().signal)).rejects.toThrow('at most 2 tasks')
    expect(host.receive).not.toHaveBeenCalled()
    expect(host.engine.decide).not.toHaveBeenCalled()
    expect(host.requestPass).not.toHaveBeenCalled()
  })
  it('dispatches a swarm batch that fits its maxTasks budget', async () => {
    const workspace = join(dir, 'swarm-workspace')
    mkdirSync(join(workspace, '.trellis', 'tasks'), { recursive: true })
    const swarm = { ...swarmFixture(workspace), budget: { maxTasks: 2, maxWorkers: 2, maxRounds: 3 } }
    const { host, tools: list } = tools(swarm, [ownedTicket('t-old', swarm.id, true)])
    const dispatch = list.find(tool => tool.name === 'orchestrator_local_dispatch')!
    const taskDir = join(workspace, '.trellis', 'tasks', '11-05-one')
    const result = await dispatch.execute({ tasks: [
      { task_dir: taskDir, title: 'One', acknowledgement: 'On it' },
    ] }, new AbortController().signal)
    expect(host.receive).toHaveBeenCalledTimes(1)
    expect(host.engine.decide).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ results: [{ task_dir: taskDir, decision: 'accept' }] })
  })
  it('keeps a legacy dispatch free of swarm budget checks', async () => {
    const { host, tools: list } = tools(undefined, ['a', 'b', 'c', 'd'].map(id => ownedTicket(id, 'some-swarm', true)))
    const dispatch = list.find(tool => tool.name === 'orchestrator_local_dispatch')!
    const first = join(repo, '.trellis', 'tasks', '11-05-one')
    const second = join(repo, '.trellis', 'tasks', '11-05-two')
    const result = await dispatch.execute({ tasks: [
      { task_dir: first, title: 'One', acknowledgement: 'On it' },
      { task_dir: second, title: 'Two', acknowledgement: 'On it too' },
    ] }, new AbortController().signal)
    expect(host.receive).toHaveBeenCalledTimes(2)
    expect(host.engine.decide).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ results: [{ decision: 'accept' }, { decision: 'accept' }] })
  })
})

describe('commit gates', () => {
  it('requires an in-progress Trellis task for a main-Session git commit', () => {
    expect(trellisCommitGuard('git status', undefined)).toBeUndefined()
    expect(trellisCommitGuard('git commit -m work', undefined)).toContain('No active Trellis task')
    expect(trellisCommitGuard('git commit -m work', { dir: 'task', status: 'planning' })).toContain('planning')
    expect(trellisCommitGuard('git commit -m work', { dir: 'task', status: 'in_progress' })).toBeUndefined()
    expect(trellisCommitGuard('WXH_TRELLIS_BYPASS=1 git commit -m work', undefined)).toBeUndefined()
    expect(trellisCommitGuard('git -C repo commit -m work', undefined)).toContain('No active Trellis task')
  })
  it('refuses commit and push in a local worker', () => {
    expect(workerCommitGuard('git status')).toBeUndefined()
    expect(workerCommitGuard('git commit -m work')).toContain('do not commit or push')
    expect(workerCommitGuard('git -C repo push origin branch')).toContain('do not commit or push')
  })
  it('reads the active task synchronously for the guard', () => {
    const trellis = new Trellis({ repository: () => repo, sessionId: 'session-1',
      runSync: () => JSON.stringify({ current_task: { dir: '.trellis/tasks/11-05-work', status: 'in_progress' } }) })
    expect(trellis.currentSync()).toEqual({ dir: '.trellis/tasks/11-05-work', status: 'in_progress' })
  })
})
