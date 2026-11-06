import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GIT_LOCATION, agentVariables, applyEnvironment, runAsWorker, verifyDirectory, withoutDirectory, workerBin, workerGitConfig,
  writeEnvironment } from '../src/infra/environment.ts'
import { CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'orchestrator-env-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const deployment = () => testDeployment({ stateDir: dir })

describe('worker shims', () => {
  it('writes blocked command shims, removes ones it no longer needs, and leaves git unblocked', async () => {
    await writeEnvironment(deployment(), ['personal-cli', 'old-cli'])
    expect(readdirSync(workerBin(dir)).sort()).toEqual(['old-cli', 'personal-cli'])
    await writeEnvironment(deployment(), ['personal-cli'])
    expect(readdirSync(workerBin(dir))).toEqual(['personal-cli'])
    expect(readFileSync(join(workerBin(dir), 'personal-cli'), 'utf8')).toContain('personal-cli is blocked in this installation.')
    // git is a worker command and cannot be blocked.
    await writeEnvironment(deployment(), ['git'])
    expect(readdirSync(workerBin(dir))).toEqual([])
  })
  it('refuses files it did not write', async () => {
    mkdirSync(workerBin(dir), { recursive: true })
    writeFileSync(join(workerBin(dir), 'notes'), 'mine\n')
    await expect(writeEnvironment(deployment(), [])).rejects.toThrow(`${join(workerBin(dir), 'notes')} was not written by dsh-superagent`)
    rmSync(join(workerBin(dir), 'notes'))
    writeFileSync(workerGitConfig(dir), '[user]\n\tname = someone\n')
    await expect(writeEnvironment(deployment(), [])).rejects.toThrow(`${workerGitConfig(dir)} was not written by dsh-superagent`)
    expect(readFileSync(workerGitConfig(dir), 'utf8')).toBe('[user]\n\tname = someone\n')
  })
  it('adopts files written by the project\'s earlier names and refuses symlinks', async () => {
    mkdirSync(workerBin(dir), { recursive: true })
    writeFileSync(join(workerBin(dir), 'shim'), '#!/bin/sh\n# Written by dsh-tag on every start; edits are lost.\n')
    await writeEnvironment(deployment(), [])
    expect(readdirSync(workerBin(dir))).toEqual([])
    const outside = join(dir, 'outside'); writeFileSync(outside, '')
    symlinkSync(outside, join(workerBin(dir), 'link'))
    await expect(writeEnvironment(deployment(), [])).rejects.toThrow('link was not written by dsh-superagent')
  })
})

describe('agent git configuration', () => {
  it('writes an isolated configuration without a credential helper and with LFS filters', async () => {
    await writeEnvironment(deployment(), [])
    const text = readFileSync(workerGitConfig(dir), 'utf8')
    expect(text).toContain('[user]\n\tuseConfigOnly = true')
    expect(text).toContain('[credential]\n\thelper =')
    expect(text).not.toContain('github.com')
    expect(text).toContain('[filter "lfs"]')
  })
  it('clears the repository, identity and prompt variables a host passes to workers', () => {
    const variables = agentVariables(dir)
    for (const name of GIT_LOCATION) expect(variables[name]).toBeUndefined()
    expect(variables).toMatchObject({ GIT_CONFIG_GLOBAL: workerGitConfig(dir), GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: '', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: undefined, GIT_COMMITTER_NAME: undefined })
  })
  it('removes every spelling of a directory from PATH and keeps the other entries', () => {
    const target = join(dir, 'bin'); mkdirSync(target)
    expect(withoutDirectory([target, join(target, '.'), '/usr/bin', 'relative'].join(':'), target)).toBe('/usr/bin:relative')
  })
  it('applies variables and prepends the shims, then restores them', () => {
    const before = process.env.DSH_PROBE
    const restore = applyEnvironment({ DSH_PROBE: 'yes' }, dir, '/usr/bin')
    expect(process.env.DSH_PROBE).toBe('yes')
    expect(process.env.PATH?.split(':')[0]).toBe(workerBin(dir))
    restore()
    expect(process.env.DSH_PROBE).toBe(before)
  })
})

describe('ticket directory check', () => {
  const subprocess = (text: string, exitCode = 0, stderr = '') => ({ spawn: () => ({
    done: Promise.resolve({ exitCode, signal: null }),
    collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) } },
  }) }) as never
  it('refuses a repository configuration that would supply credentials', async () => {
    await expect(verifyDirectory('/w', subprocess('local\0credential.helper\n'), AbortSignal.timeout(1000))).rejects.toThrow('credential.helper')
    await expect(verifyDirectory('/w', subprocess('global\0credential.helper\n'), AbortSignal.timeout(1000))).resolves.toBeUndefined()
  })
  it('reports a subprocess failure with its stderr', async () => {
    await expect(runAsWorker(subprocess('', 2, 'boom'), ['git'], '/w', AbortSignal.timeout(1000))).rejects.toBeInstanceOf(CliError)
  })
})
