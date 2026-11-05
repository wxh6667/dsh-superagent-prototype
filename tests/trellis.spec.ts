/** The thin Trellis adapter: task creation, artifacts, session-scoped start, archive and path validation. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainTools, type MainToolsHost } from '../src/app/tools/main.ts'
import { workerCommitGuard } from '../src/app/sessions.ts'
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

describe('main Session local tools', () => {
  function tools() {
    const host = {
      context: { logger: { warn: vi.fn() } },
      engine: { decide: vi.fn(() => ({ kind: 'accept', ticketId: 't1', reason: { code: 'explicitRouted' } })) },
      store: { tickets: { get: () => undefined } }, prompts: {}, sessions: {}, settings: {}, assessor: {}, resources: {},
      local: () => ({ repository: repo, baseBranch: 'main', verify: 'scripts/verify.sh', actor: 'local-user', actorName: 'Local user' }),
      trellis: { plan: vi.fn(async () => ({ parent: { dir: '/p', title: 'Parent' }, children: [] })), archive: vi.fn() },
      masterId: 'session-1', receive: vi.fn(() => 'stored'), requestPass: vi.fn(), sendReplies: vi.fn(), quietly: (run: () => unknown) => run(),
    } as unknown as MainToolsHost
    return { host, tools: mainTools(host, { id: 'master' } as never) }
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
    expect(host.receive).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: 'local', human: true, addressed: 'direct',
      threads: [{ source: 'local', id: 'local:session-1:11-05-local-work' }], channel: expect.objectContaining({ source: 'local' }) }))
    expect(host.receive).toHaveBeenNthCalledWith(2, expect.objectContaining({ threads: [{ source: 'local', id: 'local:session-1:11-05-other-work' }] }))
    expect(host.engine.decide).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ kind: 'accept', title: 'Local work',
      name: 'local-work', reason: { code: 'explicitRouted' } }))
    expect(host.engine.decide).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ title: 'Other work', name: 'other-work' }))
    expect(result).toMatchObject({ results: [{ decision: 'accept' }, { decision: 'accept' }] })
    expect(host.requestPass).toHaveBeenCalled()
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
