import { expect, it } from 'vitest'
import { admissionContext, threadWindow } from '../src/sources/admission-context.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { ContextMessage, ContextPart, TriggerContext } from '../src/sources/kind.ts'

const message = (index: number): ContextMessage => ({ id: `om_${index}`, from: 'ou_user', at: String(index), text: `Message ${index}` })
const part = (messages: ContextMessage[], next?: string, status?: string): ContextPart =>
  ({ messages, body: {}, ...next ? { next } : {}, ...status ? { status } : {} })
const context = (pages: Record<string, ContextPart>, messageId = 'om_9'): TriggerContext => ({
  messageId,
  read: async (_commands, _part, cursor) => pages[cursor ?? 'first']!,
  images: () => [],
  image: async () => { throw new Error('No image support') },
})
const commands = {} as Commands

it('returns the thread opening and trigger neighbors with exact internal and trailing gaps', () => {
  const result = threadWindow(Array.from({ length: 40 }, (_, i) => message(i)), 'om_25')
  expect(result.entries.map((item: { position: number }) => item.position)).toEqual([1, 2, 3, 4, 5, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
  expect(result.entries[5]?.omitted_before).toBe(15)
  expect(result.omitted_after).toBe(9)
  expect(result.source_found).toBe(true)
})
it('deduplicates overlapping windows and reports an absent source without inventing neighbors', () => {
  const messages = Array.from({ length: 12 }, (_, i) => message(i))
  expect(threadWindow(messages, 'om_3').entries.map((item: { position: number }) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(threadWindow(messages, 'om_absent')).toMatchObject({ source_found: false, loaded_messages: 12, omitted_after: 7 })
})
it('retains pagination limits and exact loaded counts rather than claiming complete history', async () => {
  const pages = { first: part([message(0), message(1)], 'next', 'chat_neighbours') }
  const result = await admissionContext(context(pages), commands, 1)
  expect(result).toMatchObject({ complete: false, next: 'next', status: 'chat_neighbours', window: { loaded_messages: 2, source_found: false } })
})
it('reads every page it is allowed and completes when no next cursor remains', async () => {
  const pages = {
    first: part([message(0), message(1)], 'next'),
    next: part([message(1), message(2)]),
  }
  const result = await admissionContext(context(pages), commands, 3)
  expect(result).toMatchObject({ complete: true, next: null, window: { loaded_messages: 3, source_found: false } })
  expect(result.messages.map(item => item.id)).toEqual(['om_0', 'om_1', 'om_2'])
})
it('refuses a repeated cursor instead of reporting incomplete context as complete', async () => {
  const pages = { first: part([message(0)], 'same'), same: part([message(1)], 'same') }
  await expect(admissionContext(context(pages), commands, 3)).rejects.toThrow('repeated a cursor')
})
