import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Config, LocalRepoSchema, SETUP_FIELDS, machineOf, resolveDeployment, resolveLocalRepository } from '../src/deployment.ts'
import { Setup } from '../src/app/setup.ts'
import { SettingsSchema } from '../src/policy.ts'
import { workerBin, workerGitConfig } from '../src/infra/environment.ts'
import { testMachine } from './fixtures/deployment.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'orchestrator-deployment-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const machine = () => testMachine({ stateDir: join(dir, 'state') })
const repo = () => {
  const path = join(dir, 'repo')
  mkdirSync(join(path, '.trellis'), { recursive: true })
  mkdirSync(join(path, '.git'), { recursive: true })
  return path
}
const refusal = (work: () => unknown): { code?: string; place?: string } | undefined => {
  try { work(); return undefined } catch (error) { return error as { code?: string; place?: string } }
}

describe('configuration schema', () => {
  it('requires only the state directory and reads the editable fields through references', () => {
    expect(() => Config({})).toThrow('stateDir')
    const read = machineOf(Config({ stateDir: join(dir, 'state') }))
    expect({ ...read, promptMaxChars: read.promptMaxChars.get(), admissionContextMaxPages: read.admissionContextMaxPages.get(),
      admissionContextTimeoutMs: read.admissionContextTimeoutMs.get() })
      .toEqual({ stateDir: join(dir, 'state'), promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000, managementOrigins: [] })
    expect(() => Config({ stateDir: 'relative/dir' })).toThrow()
  })
  it('names keys the configuration does not define, and where the values of older keys live now', () => {
    expect(() => machineOf(Config({ stateDir: join(dir, 'state'), repositoryPath: '/srv/widgets', blockedCommands: [], author: { name: 'Alice' }, extra: 1 } as never)))
      .toThrow('keys it does not use: repositoryPath (now in the prepare command of the Execution settings), blockedCommands (now in the Execution settings), author (now prompt text), extra;')
  })
})

describe('local repository', () => {
  it('accepts an absolute git repository with a .trellis directory and keeps its settings', () => {
    const path = repo()
    expect(resolveLocalRepository({ repository: path, baseBranch: 'dev', verify: 'check.sh', actor: 'me', actorName: 'Me' }))
      .toEqual({ repository: path, baseBranch: 'dev', verify: 'check.sh', actor: 'me', actorName: 'Me' })
    expect(resolveLocalRepository({})).toBeUndefined()
  })
  it('names each unusable path', () => {
    expect(refusal(() => resolveLocalRepository({ repository: 'relative/repo' }))?.code).toBe('localRepositoryInvalid')
    expect(refusal(() => resolveLocalRepository({ repository: join(dir, 'missing') }))?.code).toBe('localRepositoryMissing')
    const file = join(dir, 'file'); writeFileSync(file, '')
    expect(refusal(() => resolveLocalRepository({ repository: file }))?.code).toBe('localRepositoryInvalid')
    const plain = join(dir, 'plain'); mkdirSync(plain)
    expect(refusal(() => resolveLocalRepository({ repository: plain }))?.code).toBe('localRepositoryNotGit')
    mkdirSync(join(plain, '.git'))
    expect(refusal(() => resolveLocalRepository({ repository: plain }))?.code).toBe('localRepositoryNoTrellis')
  })
  it('requires a local repository and derives the deployment from it', () => {
    expect(refusal(() => resolveDeployment(machine(), undefined))).toMatchObject({ code: 'localRepositoryUnset', place: 'local' })
    const path = repo()
    expect(resolveDeployment(machine(), { repository: path })).toMatchObject({ local: { repository: path, baseBranch: 'main', verify: 'scripts/verify.sh' } })
    expect(SETUP_FIELDS.local).toEqual(Object.keys(LocalRepoSchema.shape))
  })
})

describe('setup', () => {
  it('resolves the local repository, writes the worker environment and records a refused actor', async () => {
    const path = repo()
    const settings = (allowed: boolean) => SettingsSchema.parse({
      sources: { local: { enabled: true, config: { repository: path } } },
      policy: { sources: { local: { allowed: allowed ? [{ id: 'local-user' }] : [] } } },
    })
    const setup = new Setup({ machine: machine(), restart: vi.fn() })
    expect(await setup.run(settings(false))).toBe(false)
    expect(setup.problem).toMatchObject({ place: 'local', code: 'localActorNotAllowed' })
    expect(await setup.run(settings(true))).toBe(true)
    expect(setup.deployment.local.repository).toBe(path)
    expect(readdirSync(workerBin(machine().stateDir))).toEqual([])
    expect(readdirSync(machine().stateDir)).toContain('worker-gitconfig')
    expect(readFileSync(workerGitConfig(machine().stateDir), 'utf8')).toContain('[user]')
    expect(() => setup.check()).toThrow()
    setup.restore()
  })
  it('waits for a local repository and schedules a check again', async () => {
    const restart = vi.fn()
    const setup = new Setup({ machine: machine(), restart })
    const settings = SettingsSchema.parse({ sources: { local: { enabled: true, config: {} } } })
    expect(await setup.run(settings)).toBe(false)
    expect(setup.problem).toMatchObject({ place: 'local', code: 'localRepositoryUnset' })
    setup.check()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(restart).toHaveBeenCalledOnce()
  })
})
