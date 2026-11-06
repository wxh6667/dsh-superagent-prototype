/** Probes the local repository, configures the worker execution environment and command shims, and tracks setup readiness. */
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, resolveDeployment, resolveLocalRepository, type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, applyEnvironment, withoutDirectory, workerBin, writeEnvironment } from '../infra/environment.ts'
import { allowedSender, type Settings, type SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'

export interface SetupHost {
  readonly machine: Machine
  restart(): void
}

const setupFields = (settings: Settings) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => keys.map(key => settings.sources[id]?.config[key] ?? '')))
export const setupChanged = (before: Settings, after: Settings): boolean => setupFields(before) !== setupFields(after)

/**
 * Resolves the local repository, then writes and applies the isolated git and shim environment used by worker processes.
 * `Runtime` runs it at startup to gate orchestration readiness, while `Settings` uses it to validate local repository changes, update blocked command shims, and schedule restarts.
 */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  /** PATH with the worker shim directory removed so the host's own CLI calls invoke the real binaries. */
  private readonly path: string
  /** Environment variables pointing agent subprocesses at the isolated git config and command shims. */
  private readonly variables: Record<string, string | undefined>
  private restoreEnvironment?: () => void
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
    this.variables = agentVariables(host.machine.stateDir)
  }
  /** Host command environment with agent git variables applied and the worker shim directory excluded from PATH. */
  get commandEnvironment(): Record<string, string | undefined> { return { ...this.variables, PATH: this.path } }
  get deployment(): Deployment {
    if (!this.resolved) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    return this.resolved
  }
  configured(): boolean { return this.resolved !== undefined }
  /** Resolve the local repository and apply the worker environment, recording `SetupError` failures in `problem` and rethrowing unexpected errors. */
  async run(settings: Settings): Promise<boolean> {
    try { this.resolved = await this.resolve(settings); return true }
    catch (error) {
      if (!(error instanceof SetupError)) throw error
      this.problem = error.problem
      return false
    }
  }
  /** Trigger a restart to re-run setup, refusing if setup is already healthy so running assignments are not interrupted. */
  check(): void {
    if (this.configured()) throw new UserError('setupComplete')
    this.restart()
  }
  /** Defer the restart to the next macrotask so the current HTTP or tool caller receives its response first. */
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Validate the local repository a modified source block names before saving it. */
  async checkAccounts(block: SettingsBlock, settings: Settings): Promise<void> {
    if (block === 'source:local') resolveLocalRepository(settings.sources.local?.config)
  }
  async blockCommands(blocked: readonly string[]): Promise<void> {
    if (this.resolved) await writeEnvironment(this.resolved, blocked)
  }
  restore(): void { this.restoreEnvironment?.(); this.restoreEnvironment = undefined }
  private async resolve(settings: Settings): Promise<Deployment> {
    const { machine } = this.host
    const local = settings.sources.local?.enabled === true ? settings.sources.local?.config : undefined
    const deployment = resolveDeployment(machine, local)
    // The local Source is usable only when its configured actor is in the Policy's allowed list.
    if (!allowedSender(settings, { source: 'local', id: deployment.local.actor })) {
      throw new SetupError('localActorNotAllowed', { actor: deployment.local.actor })
    }
    const machineProblem = (error: unknown): never => {
      if (error instanceof SetupError) throw error
      throw new SetupError('environmentFailed', { output: error instanceof Error ? error.message : String(error) })
    }
    await writeEnvironment(deployment, settings.executor.blockedCommands).catch(machineProblem)
    this.restoreEnvironment = applyEnvironment(this.variables, machine.stateDir, this.path)
    return deployment
  }
}
