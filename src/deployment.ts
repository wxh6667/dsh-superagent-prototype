/** Plugin configuration and startup verification for the local repository a local-only deployment works on. */
import { LIMITS } from './limits.ts'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { SetupError } from './setup.ts'

const absolute = (description: string) => s.string().pattern(/^\//).description(`${description} Absolute path.`)
/** Plugin configuration of the dsh-superagent entry. Volatile fields apply without a restart because dsh-superagent reads them on each use; changing `stateDir` remounts the plugin. */
export const Config = s.object({
  stateDir: absolute('Directory for the database, locks, worker shims, the agent\'s git configuration and, by default, the ticket directories.').required(),
  promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(100000)
    .description('Largest saved prompt configuration, in characters.').volatile(),
  admissionContextMaxPages: s.number().min(LIMITS.admissionContextMaxPages.min).max(LIMITS.admissionContextMaxPages.max).step(1).default(10)
    .description('Pages of thread context one assessment may read.').volatile(),
  admissionContextTimeoutMs: s.number().min(LIMITS.admissionContextTimeoutMs.min).max(LIMITS.admissionContextTimeoutMs.max).step(1)
    .default(15000).description('Time limit of one context read during an assessment, in milliseconds.').volatile(),
  managementOrigins: s.array(s.string().pattern(/^https?:\/\/[^\s]+$/)).default([])
    .description('Origins of a reverse proxy that serves the management panel, such as https://dsh.example.com. Each still needs the panel\'s x-orchestrator-request header.'),
})
export type DeploymentConfig = ReturnType<typeof Config>
export interface Machine {
  stateDir: string
  promptMaxChars: Volatile<number>
  admissionContextMaxPages: Volatile<number>
  admissionContextTimeoutMs: Volatile<number>
  managementOrigins: string[]
}
const MOVED: Record<string, string> = {
  branchPrefix: 'in the prepare command of the Execution settings', author: 'prompt text',
  repositoryPath: 'in the prepare command of the Execution settings',
  worktreeRoot: 'the ticket directory of the Execution settings', blockedCommands: 'in the Execution settings',
}

/** Read machine settings and reject unknown configuration keys (naming where deprecated keys moved). */
export function machineOf(config: DeploymentConfig): Machine {
  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))
  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)
  const { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs, managementOrigins } = config
  return { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs, managementOrigins }
}

/** Configuration of the local repository a local-only deployment works on. */
export const LocalRepoSchema = z.object({
  repository: z.string().trim().default(''),
  baseBranch: z.string().trim().default('main'),
  verify: z.string().trim().default('scripts/verify.sh'),
  actor: z.string().trim().default('local-user'),
  actorName: z.string().trim().default('Local user'),
})
export type LocalRepoConfig = z.infer<typeof LocalRepoSchema>
/** Source configuration keys that affect deployment setup and trigger a restart when changed. */
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { local: Object.keys(LocalRepoSchema.shape) }

export interface Deployment extends Machine {
  local: LocalRepo
}
export interface LocalRepo { repository: string; baseBranch: string; verify: string; actor: string; actorName: string }

/**
 * Validate a local repository configuration. An empty path means the local Source is not configured; a non-empty path
 * must be an absolute git repository with a `.trellis` directory. The path is not initialized here.
 */
export function resolveLocalRepository(value: unknown): LocalRepo | undefined {
  const config = LocalRepoSchema.parse(value ?? {})
  const repository = config.repository
  if (!repository) return undefined
  if (!isAbsolute(repository)) throw new SetupError('localRepositoryInvalid', { path: repository })
  let info
  try { info = statSync(repository) } catch { throw new SetupError('localRepositoryMissing', { path: repository }) }
  if (!info.isDirectory()) throw new SetupError('localRepositoryInvalid', { path: repository })
  try { statSync(join(repository, '.git')) } catch { throw new SetupError('localRepositoryNotGit', { path: repository }) }
  try { if (!statSync(join(repository, '.trellis')).isDirectory()) throw new SetupError('localRepositoryNoTrellis', { path: repository }) }
  catch (error) { if (error instanceof SetupError) throw error; throw new SetupError('localRepositoryNoTrellis', { path: repository }) }
  return { repository, baseBranch: config.baseBranch, verify: config.verify, actor: config.actor, actorName: config.actorName }
}

/**
 * Resolve the local repository this local-only deployment works on. A deployment without one is refused, because the
 * local Source is the only way work enters dsh-superagent.
 */
export function resolveDeployment(machine: Machine, local: unknown): Deployment {
  const localRepo = resolveLocalRepository(local)
  if (!localRepo) throw new SetupError('localRepositoryUnset')
  return { ...machine, local: localRepo }
}
