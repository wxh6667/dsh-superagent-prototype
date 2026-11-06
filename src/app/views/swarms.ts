/** Swarms with their current task status, computed from the Tickets they own. */
import { ticketStage, type Swarm, type Ticket, type TicketStage } from '../../core/index.ts'

/** How long after its end a Ticket still counts as just ended in a swarm's task status. */
export const JUST_ENDED_MS = 15 * 60_000

/** A swarm's tasks: how many work now, wait for a worker slot, or ended just now, and the latest change. */
export interface SwarmTaskSummary {
  /** Open Tickets whose worker is working now. */
  running: number
  /** Open Tickets queued for a worker slot. */
  pending: number
  /** Tickets that ended within `JUST_ENDED_MS`. */
  ended: number
  /** The most recently changed Ticket of the swarm, with its current stage. */
  latest?: { ticketId: string; title: string; at: string; stage: TicketStage }
}
/** A swarm row with its task status, as the management API returns it. */
export type SwarmView = Swarm & { tasks: SwarmTaskSummary }

/** Counts a swarm's Tickets by their stage, and names the one that changed last. */
export function swarmTasks(tickets: readonly Ticket[], now = Date.now()): SwarmTaskSummary {
  const since = now - JUST_ENDED_MS
  let running = 0, pending = 0, ended = 0, latest: Ticket | undefined
  for (const ticket of tickets) {
    const stage = ticketStage(ticket)
    if (stage.stage === 'ended') {
      if (ticket.ended && Date.parse(ticket.ended.at) >= since) ended += 1
    } else if (stage.stage === 'working') {
      if (stage.action === 'queued') pending += 1
      else running += 1
    }
    // The newest change wins; an equal timestamp resolves by id so a row does not change between equal reads.
    if (!latest || ticket.updatedAt > latest.updatedAt || (ticket.updatedAt === latest.updatedAt && ticket.id > latest.id)) latest = ticket
  }
  return { running, pending, ended, ...latest
    ? { latest: { ticketId: latest.id, title: latest.title, at: latest.updatedAt, stage: ticketStage(latest) } }
    : {} }
}

/** The swarms in their stored order, each with the task status of the Tickets that name it. */
export function swarmsView(swarms: readonly Swarm[], tickets: readonly Ticket[], now = Date.now()): SwarmView[] {
  const bySwarm = new Map<string, Ticket[]>()
  for (const ticket of tickets) {
    if (!ticket.swarmId) continue
    const owned = bySwarm.get(ticket.swarmId)
    if (owned) owned.push(ticket)
    else bySwarm.set(ticket.swarmId, [ticket])
  }
  return swarms.map(swarm => ({ ...swarm, tasks: swarmTasks(bySwarm.get(swarm.id) ?? [], now) }))
}
