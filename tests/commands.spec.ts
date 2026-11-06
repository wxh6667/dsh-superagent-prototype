import { describe, expect, it, vi } from 'vitest'
import { CliError, Commands, commandError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'

const commands = (environment: Record<string, string | undefined> = {}, signal = new AbortController().signal) =>
  new Commands(() => testDeployment(), environment, signal)

describe('command errors', () => {
  it('reports a structured CLI failure with its code and without echoing arguments', () => {
    const error = commandError({ stderr: '\n' + JSON.stringify({ error: { code: 232011, message: 'operator is not in the chat' } }), code: 1 })
    expect(error).toBeInstanceOf(CliError)
    expect(error.message).toBe('operator is not in the chat (232011)')
    expect((error as CliError).code).toBe(232011)
    expect((error as CliError).exitCode).toBe(1)
    expect(error.message).not.toContain('lark')
  })
  it('keeps the HTTP status an unstructured CLI message names', () => {
    const error = commandError({ stderr: 'gh: Not Found (HTTP 404)', code: 1 }, 'gh')
    expect(error.message).toBe('gh: Not Found (HTTP 404)')
    expect((error as CliError).code).toBe(404)
  })
  it('names only the program and how it ended when a command prints no diagnostics', () => {
    expect(commandError({ code: 7 }, '/usr/bin/tool').message).toBe('tool exited with code 7')
    expect(commandError({ killed: true, signal: 'SIGTERM' }, 'tool').message).toBe('tool timed out after 90 s')
    expect(commandError({ code: 'ENOENT' }, 'git').message).toBe('git could not run: ENOENT')
  })
  it('passes an abort through unchanged', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(commandError(aborted)).toBe(aborted)
  })
})

describe('commands', () => {
  it('runs a program with the deployment environment and returns its output', async () => {
    expect(await commands({ DSH_PROBE: 'yes' }).run('sh', ['-c', 'printf %s "$DSH_PROBE"'])).toBe('yes')
  })
  it('runs git through the same environment', async () => {
    const value = commands()
    const run = vi.spyOn(value, 'run').mockResolvedValue('')
    await value.git(['status'], '/w')
    expect(run).toHaveBeenCalledWith('git', ['status'], '/w')
  })
  it('stops a running command when its signal aborts', async () => {
    const controller = new AbortController()
    const running = commands({}, controller.signal).run('sleep', ['5'])
    controller.abort()
    await expect(running).rejects.toThrow()
  })
  it('combines its lifetime with a per-call signal', async () => {
    const value = commands()
    const inner = new AbortController()
    const scoped = value.withSignal(inner.signal)
    expect(scoped).not.toBe(value)
    const running = scoped.run('sleep', ['5'])
    inner.abort()
    await expect(running).rejects.toThrow()
  })
})
