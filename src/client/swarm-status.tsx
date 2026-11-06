/**
 * The task status of the Swarm whose master Session the Conversation shows, registered into the conversation header.
 *
 * DSH's conversation plugin declares `conversation.session.header.actions` as an additive list slot beside the Session
 * title and creates it at runtime; the `@deepseek-ai/dsh-client-ui-conversation` package is not a dependency of this
 * bundle, so this module restates the small part of that contract it registers into. A session-scoped slot also carries
 * the Session identity (`sessionId`), which `@deepseek-ai/dsh-client-ui-session` supplies the same way.
 */
import { useMemo } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { caller, usePoll } from './api.ts'
import { Dot } from './controls.tsx'
import { apiMessages } from './provider.tsx'
import { valueLabel, type T } from './text.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Title-adjacent Session actions in ascending order; this bundle adds the Swarm's task status to it. */
    'conversation.session.header.actions': { kind: 'list'; scope: 'session'; owner: { children?: never } }
  }
  interface SessionStandardProps {
    /** Current Session identity, supplied by DSH's session UI. */
    sessionId: SessionId
  }
}

/** The Swarm's task counts and latest change in the header; nothing renders for a Session that owns no active Swarm. */
export function SwarmStatus({ sessionId, t }: { sessionId: string; t: T }) {
  // Read the current translator through the memo so a locale change rebuilds the caller instead of leaving stale copy.
  const call = useMemo(() => caller(() => apiMessages(t)), [t])
  const { data } = usePoll(() => call('GET swarms'), [call])
  const swarm = data?.items.find(item => item.masterSessionId === sessionId && item.status === 'active' && !item.legacy)
  if (!swarm) return null
  const { running, pending, ended, latest } = swarm.tasks
  const counts = t('swarmStatusSummary', { running, pending, ended })
  const change = latest ? `${latest.title} · ${valueLabel(t, 'stage', latest.stage.stage)}` : ''
  return <span className="dt-swarm-status" title={t('swarmStatusHint')} aria-label={counts}>
    <Dot state={running ? 'ongoing' : 'idle'} />
    <span className="dt-swarm-status-counts">{counts}</span>
    {change && <span className="dt-swarm-status-latest">{change}</span>}
  </span>
}
