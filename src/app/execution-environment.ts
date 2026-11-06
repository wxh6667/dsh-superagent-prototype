/** Execution environment variables exposed to prepare commands and documented in worker Session instructions; never contains credentials. */
import { join } from 'node:path'
import type { Swarm, Ticket, Trigger } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { Settings } from '../policy.ts'
import type { Localized, VariableSpec } from '../sources/kind.ts'
import type { SourceRegistry } from '../sources/registry.ts'

/** Variables registered by the Executor; `ticket` entries are populated only when a ticket is present. */
export const EXECUTOR_VARIABLES: readonly (VariableSpec & { ticket?: true })[] = [
  { key: 'DSH_SUPERAGENT_DIR', ticket: true, description: { zh: '这个工单的执行目录；执行器 Session 在其中工作', en: 'This ticket\'s directory; the executor Session works in it' } },
  { key: 'DSH_SUPERAGENT_NAME', ticket: true, description: { zh: '工单的短名，也是执行目录的名字', en: 'The ticket\'s short name, also its directory\'s name' } },
  { key: 'DSH_SUPERAGENT_TICKET', ticket: true, description: { zh: '工单 id', en: 'The ticket id' } },
  { key: 'DSH_SUPERAGENT_BLOCKED_COMMANDS', description: { zh: '这个执行环境禁止调用的命令，以空格分隔；不要运行它们', en: 'Commands blocked in this execution environment, separated by spaces; never run them' } },
]
export interface Variable { key: string; value: string; description: Localized; owner: string }

export const executionRoot = (settings: Settings, stateDir: string): string => settings.executor.directory || join(stateDir, 'work')

/** Lists all declared variables grouped by owner; `enabled` is false for Sources that are currently switched off. */
export function declaredVariables(sources: SourceRegistry, settings?: Settings): { owner: string; enabled: boolean; variables: readonly VariableSpec[] }[] {
  const on = new Set(sources.environments(settings).map(item => item.kind.kind))
  return [{ owner: 'executor', enabled: true, variables: EXECUTOR_VARIABLES },
    ...sources.declarations().map(({ kind, variables }) => ({ owner: kind, enabled: on.has(kind), variables }))]
}

/**
 * Rebind, for a swarm's ticket, the repository, verify entrypoint and base branch to the swarm's own values: update the
 * value in place when a local Source declared it, else add it under owner `swarm`. Every other variable is left alone.
 */
function swarmOverrides(result: Variable[], swarm: Swarm, deployment: Deployment): void {
  const overrides: readonly Variable[] = [
    { key: 'DSH_SUPERAGENT_LOCAL_REPO', value: swarm.workspace, owner: 'swarm',
      description: { zh: '这个 swarm 绑定的本地仓库绝对路径；worker 的 worktree 从它创建', en: 'Absolute path of the repository this swarm is bound to; a worker worktree is created from it' } },
    { key: 'DSH_SUPERAGENT_VERIFY', value: swarm.verify, owner: 'swarm',
      description: { zh: '这个 swarm 的 worker 在 worktree 中运行的验证入口', en: 'Verification entrypoint this swarm\'s workers run in their worktree' } },
    { key: 'DSH_SUPERAGENT_BASE_BRANCH', value: deployment.local?.baseBranch ?? 'main', owner: 'swarm',
      description: { zh: '创建这个 swarm 工单 worktree 的基础分支', en: 'Base branch for this swarm\'s ticket worktrees' } },
  ]
  for (const override of overrides) {
    const existing = result.find(variable => variable.key === override.key)
    if (existing) existing.value = override.value
    else result.push(override)
  }
}

export function environmentOf(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket?: { id: string; name: string; directory: string }; trigger?: Trigger; swarm?: Swarm }): Variable[] {
  const { deployment, sources, settings, ticket, trigger, swarm } = input
  const executor: Record<string, string> = { DSH_SUPERAGENT_BLOCKED_COMMANDS: settings.executor.blockedCommands.join(' '), ...ticket ? { DSH_SUPERAGENT_DIR: ticket.directory, DSH_SUPERAGENT_NAME: ticket.name, DSH_SUPERAGENT_TICKET: ticket.id } : {} }
  const result: Variable[] = EXECUTOR_VARIABLES.filter(spec => !spec.ticket || ticket).map(spec => ({ key: spec.key, value: executor[spec.key] ?? '', description: spec.description, owner: 'executor' }))
  for (const { kind, environment, config } of sources.environments(settings)) {
    const values = environment.values({ deployment, config, ...trigger ? { trigger } : {} })
    for (const spec of environment.variables) result.push({ key: spec.key, value: values[spec.key] ?? '', description: spec.description, owner: kind.kind })
  }
  // A swarm's ticket names the swarm's own repository, verify entrypoint and base branch; a legacy ticket keeps the global ones.
  if (swarm && !swarm.legacy) swarmOverrides(result, swarm, deployment)
  return result
}

/** Combines a ticket's fixed directory, name, and origin trigger with the deployment's current settings, and its swarm when it has one. */
export function ticketEnvironment(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket: Ticket; trigger?: Trigger; swarm?: Swarm }) {
  const { ticket, trigger, ...rest } = input
  const values = { id: ticket.id, name: ticket.execution?.name ?? '', directory: ticket.execution?.directory ?? '' }
  return environmentOf({ ...rest, ticket: values, ...trigger ? { trigger } : {} })
}
export function environmentLines(variables: Variable[]): string {
  return variables.map(variable => `- ${variable.key} = ${JSON.stringify(variable.value)}: ${variable.description.en}.`).join('\n')
}
