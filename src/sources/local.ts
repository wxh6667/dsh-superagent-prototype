/** The local Source: requests a person makes in the DSH main Session, executed in a local repository. */
import { z } from 'zod'
import { LocalRepoSchema, type LocalRepoConfig } from '../deployment.ts'
import { AllowedSchema } from '../policy.ts'
import type { SourceKind } from './kind.ts'

export type LocalConfig = LocalRepoConfig

/**
 * A Source with no polling loop. The main Session's local dispatch tool creates its Triggers; this kind only supplies
 * configuration, admission, environment variables and display facts. Replies are delivered by `Outbox` to the main Session.
 */
export const localKind: SourceKind<LocalConfig> = {
  kind: 'local',
  enabledByDefault: false,
  title: { zh: '本地', en: 'Local' },
  description: {
    zh: '在本地仓库中执行你在 DSH 主 Session 里确认的请求；每个工单在独立 worktree 中运行。',
    en: 'Run requests you confirm in the DSH main Session against a local repository; each ticket runs in its own worktree.',
  },
  schema: LocalRepoSchema,
  fields: [
    { key: 'repository', label: { zh: '本地仓库', en: 'Local repository' }, type: 'text',
      hint: { zh: '目标仓库的绝对路径，必须已初始化 Trellis。', en: 'Absolute path of the target repository; it must already be initialized with Trellis.' } },
    { key: 'baseBranch', label: { zh: '基础分支', en: 'Base branch' }, type: 'text',
      hint: { zh: '创建工单 worktree 时使用的分支。', en: 'Branch the ticket worktree is created from.' } },
    { key: 'verify', label: { zh: '验证命令', en: 'Verification command' }, type: 'text',
      hint: { zh: 'worker 在 worktree 中运行的验证入口，默认 scripts/verify.sh。', en: 'Verification entrypoint the worker runs in its worktree; defaults to scripts/verify.sh.' } },
    { key: 'actor', label: { zh: '本地用户 id', en: 'Local actor id' }, type: 'text',
      hint: { zh: '本地请求的发起人标识；需要同时加入下方 Policy 的允许列表。', en: 'Identity of the local requester; it must also be in the Policy allow list below.' } },
    { key: 'actorName', label: { zh: '本地用户名称', en: 'Local actor name' }, type: 'text' },
  ],
  health: ['local'],
  policy: {
    schema: z.object({ allowed: z.array(AllowedSchema).default([]) }).strict(),
    fields: [{ key: 'allowed', label: { zh: '允许发起本地请求的人', en: 'People who may start local requests' }, type: 'rows',
      columns: [{ key: 'id', label: { zh: 'id', en: 'id' }, type: 'text' },
        { key: 'name', label: { zh: '名称', en: 'Name' }, type: 'text', optional: true }] }],
    explicit: {
      zh: '本地用户在 DSH 主 Session 中明确提出的请求；请求文本和确认后的计划一起进入工单。',
      en: 'A request the local user makes explicitly in the DSH main Session; its text and confirmed plan enter the ticket together.',
    },
  },
  scope: () => ({ listened: true, observed: false }),
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_LOCAL_REPO', description: { zh: '本地目标仓库的绝对路径；worker 的 worktree 从它创建', en: 'Absolute path of the local target repository; the worker worktree is created from it' } },
      { key: 'DSH_SUPERAGENT_BASE_BRANCH', description: { zh: '创建工单 worktree 的基础分支', en: 'Base branch for the ticket worktree' } },
      { key: 'DSH_SUPERAGENT_VERIFY', description: { zh: 'worker 在 worktree 中运行的验证入口', en: 'Verification entrypoint the worker runs in its worktree' } },
    ],
    values: ({ config }) => ({
      DSH_SUPERAGENT_LOCAL_REPO: config.repository,
      DSH_SUPERAGENT_BASE_BRANCH: config.baseBranch,
      DSH_SUPERAGENT_VERIFY: config.verify,
    }),
  },
  facts: (deployment): Record<string, string> => deployment?.local ? {
    repository: deployment.local.repository,
    baseBranch: deployment.local.baseBranch,
    verify: deployment.local.verify,
  } : {},
}
