/** A generic chat Source kind and Trigger builder for tests; it exercises the Source framework without shipping in the bundle. */
import { z } from 'zod'
import type { OutboundMessage, Trigger } from '../../src/core/index.ts'
import { AllowedSchema } from '../../src/policy.ts'
import type { SourceKind } from '../../src/sources/kind.ts'

const ChatConfigSchema = z.object({
  chats: z.array(z.object({ chatId: z.string(), name: z.string().trim().max(60).optional(), listen: z.enum(['mentions', 'all']) }).strict())
    .refine(chats => new Set(chats.map(chat => chat.chatId)).size === chats.length, 'Duplicate chat IDs').default([]),
  directMessages: z.boolean().default(true),
  otherChats: z.enum(['none', 'mentions']).default('none'),
}).strict()
export type ChatConfig = z.infer<typeof ChatConfigSchema>
export const SOURCE = 'chat'
export const MEMBER = 'ou_alice'
export const CHAT = 'oc_team'
export const chatTriggerId = (messageId: string): string => `${SOURCE}:${messageId}`
export const chatChannel = (chatId: string, messageId: string, direct = false) =>
  ({ source: SOURCE, thread: `${chatId}:${messageId}`, address: { chatId, messageId, ...(direct ? { direct: 'true' } : {}) } })
/** Test-controlled delivery result; tests replace `send` to simulate failures or a gone conversation. */
export const chatChannelState: { send: (message: OutboundMessage) => Promise<'sent' | 'gone'> } = { send: async () => 'sent' }

/** A chat Source with the same scope, policy rows and channel shape as the removed external Sources, for generic tests. */
export const chatKind: SourceKind<ChatConfig> = {
  kind: SOURCE,
  title: { zh: '聊天', en: 'Chat' },
  description: { zh: '', en: '' },
  schema: ChatConfigSchema,
  fields: [],
  health: ['chat'],
  scope({ meta }, config) {
    if (meta.direct === true) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    const chat = config.chats.find(item => item.chatId === meta.chatId)
    if (chat) return { listened: true, observed: chat.listen === 'all', row: chat.chatId }
    return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' } : { listened: false, reason: 'chat_not_allowed' }
  },
  channel: {
    allowed: (address, config) => chatKind.scope!({ meta: { chatId: address.chatId ?? '', direct: address.direct === 'true' } }, config).listened,
    send: (_host, message) => chatChannelState.send(message),
    link: address => ({ url: `https://chat.example/${address.chatId ?? ''}/${address.messageId ?? ''}`, label: { zh: '聊天', en: 'Chat' } }),
  },
  find: query => ({ threads: [], terms: [...new Set(query.match(/om_[A-Za-z0-9_-]+/g) ?? [])] }),
  repliesTo: trigger => typeof trigger.meta.parentId === 'string' ? chatTriggerId(trigger.meta.parentId) : undefined,
  policy: {
    unnamed: { person: { zh: '聊天用户', en: 'Chat user' }, bot: { zh: '聊天机器人', en: 'Chat bot' } },
    schema: z.object({ allowed: z.array(AllowedSchema).default([]), syncChat: z.string().default(''), bots: z.array(AllowedSchema).optional() }).strict(),
    fields: [],
    explicit: { zh: '名单内的人 @ 机器人或私聊机器人。', en: 'Someone on the list who mentions the bot or messages it directly.' },
    rows(stored) {
      const config = ChatConfigSchema.parse(stored)
      const mentions = { zh: '仅 @', en: '@ only' }
      return [
        ...config.chats.map(chat => ({ id: chat.chatId, label: chat.name || chat.chatId, note: chat.listen === 'all' ? { zh: '全部消息', en: 'All' } : mentions,
          cells: { listedUnaddressed: chat.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: chat.listen === 'all' } })),
        { id: 'other', label: { zh: '其他群', en: 'Other chats' }, note: config.otherChats === 'mentions' ? mentions : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.otherChats === 'mentions', unlistedUnaddressed: false } },
        { id: 'direct', label: { zh: '私聊', en: 'Direct messages' }, note: config.directMessages ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false } },
      ]
    },
  },
}

/** Build a chat Trigger; `id` provides a stable timestamp offset and message suffix, as the removed Source fixtures did. */
export function chat(id: string, text: string, overrides: Record<string, unknown> = {}): Trigger {
  const event = overrides as { meta?: Record<string, unknown>; actor?: Trigger['actor']; addressed?: Trigger['addressed']; human?: boolean
    url?: string; root_id?: string; parent_id?: string; chat_type?: string; mentions?: unknown[]; channel?: Trigger['channel'] }
  const at = String(Date.parse('2026-09-09T00:00:00Z') + Number(id.replace(/\D/g, '') || 0) * 1000)
  const direct = event.chat_type === 'p2p' || event.meta?.direct === true
  const mentioned = Array.isArray(event.mentions) ? event.mentions.length > 0 : event.meta?.mentioned !== false
  const root = typeof event.root_id === 'string' ? event.root_id : `om_${id}`
  const meta = { chatId: CHAT, direct, mentioned, messageId: `om_${id}`,
    ...(typeof event.parent_id === 'string' ? { parentId: event.parent_id } : {}), ...event.meta }
  const addressed = event.addressed ?? (direct ? 'direct' : mentioned ? 'mention' : undefined)
  return {
    id: chatTriggerId(`om_${id}`), source: SOURCE, threads: [{ source: SOURCE, id: `${CHAT}:${root}` }],
    actor: event.actor ?? { source: SOURCE, id: MEMBER }, human: event.human ?? true, at, text,
    ...addressed ? { addressed } : {},
    channel: event.channel ?? chatChannel(CHAT, `om_${id}`, direct),
    ...event.url ? { url: event.url } : {},
    meta,
  }
}
