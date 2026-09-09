import type { AgentHistoryImage, AgentHistoryMessage, AgentHistoryPage } from '../../shared/types/agentHistory'
import { AGENT_TRANSIENT_ERROR_RE, isAgentTransientMessage } from '../../shared/utils/agentHistoryVisibility'
import { AgentChat } from '../models/agentChat'
import { AgentHistory } from '../models/agentHistory'
import { connectDatabase } from './sqlite'

const PAGE_SIZE = 30
const historyContent = (content: string) => content.replace(/<\/?think(?:ing)?\s*>/gi, '')
const pendingArchives = new Map<string, Promise<void>>()
export function archiveAgentHistory(sessionId: string, messages: AgentHistoryMessage[], images: AgentHistoryImage[]) {
  return withArchiveLock(sessionId, () => archiveBatch(sessionId, messages, images))
}
async function withArchiveLock(sessionId: string, work: () => Promise<void>) {
  const key = sessionId
  const previous = pendingArchives.get(key) || Promise.resolve()
  const task = previous.catch(() => { }).then(work)
  pendingArchives.set(key, task)
  try {
    await task
  }
  finally {
    if (pendingArchives.get(key) === task)
      pendingArchives.delete(key)
  }
}
/** Archive public turns separately from the bounded LLM context and UI cache. */
async function archiveBatch(sessionId: string, messages: AgentHistoryMessage[], images: AgentHistoryImage[]) {
  if (!messages.length)
    return
  await connectDatabase()
  // Preserve the part of an old browser snapshot preceding the runtime transcript.
  const exists = await AgentHistory.exists({ sessionId })
  if (!exists) {
    const legacy = await AgentChat.findOne({ sessionId }).select('messages images')
    if (legacy?.messages?.length) {
      const overlap = legacy.messages.findIndex(row => messages.some(item => item.role === row.role && historyContent(item.content) === historyContent(row.content) && row.content))
      const storedMessages = legacy.toObject().messages
      const older = overlap >= 0 ? storedMessages.slice(0, overlap) : storedMessages
      await writeHistory(sessionId, older, legacy.toObject().images)
    }
  }
  const legacyRows = await AgentHistory.find({ sessionId, 'messageId': { $not: /^history:/ }, 'message.kind': { $ne: 'error' } }).sort({ _id: 1 }).limit(120)
  let cursor = 0
  for (const message of messages) {
    if (!message.id.startsWith('history:'))
      continue
    const index = legacyRows.findIndex((row, i) => i >= cursor && row.message.role === message.role && historyContent(row.message.content) === historyContent(message.content) && message.content)
    if (index < 0)
      continue
    const row = legacyRows[index]!
    if (!await AgentHistory.exists({ sessionId, messageId: message.id }))
      await AgentHistory.updateOne({ _id: row._id, messageId: row.messageId }, { $set: { messageId: message.id } })
    else
      await AgentHistory.deleteOne({ _id: row._id, sessionId })
    cursor = index + 1
  }
  await writeHistory(sessionId, messages, images)
}
/** Retain browser-only cards/errors as well as richer metadata for recovered turns. */
export async function archiveAgentUiHistory(sessionId: string, messages: AgentHistoryMessage[], images: AgentHistoryImage[]) {
  return withArchiveLock(sessionId, async () => {
    await connectDatabase()
    const canonical = await AgentHistory.find({
      sessionId,
      'messageId': /^history:/,
      'message.content': { $in: messages.filter(message => message.content && !message.kind).flatMap(message => [message.content, historyContent(message.content), `<think>${historyContent(message.content)}</think>`]) },
    }).sort({ _id: 1 }).lean()
    const rows = messages.map((message) => {
      const match = !message.kind && !message.id.startsWith('history:')
        ? canonical.findIndex(row => row.message.role === message.role && historyContent(row.message.content) === historyContent(message.content))
        : -1
      const existing = (match >= 0 ? canonical.splice(match, 1)[0] : canonical.find(row => row.messageId === message.id)) as {
        messageId: string
        message: AgentHistoryMessage
      } | undefined
      const canonicalId = existing?.messageId
      return {
        ...message,
        content: existing && /^<think(?:ing)?>/i.test(existing.message.content) && historyContent(existing.message.content) === historyContent(message.content)
          ? existing.message.content
          : message.content,
        id: canonicalId || (message.id.startsWith('history:') || message.id.startsWith('ui:') ? message.id : `ui:${message.id}`),
      }
    })
    await archiveBatch(sessionId, rows, images)
  })
}
async function writeHistory(sessionId: string, messages: AgentHistoryMessage[], images: AgentHistoryImage[]) {
  if (!messages.length)
    return
  const operations = messages.filter(message => !isAgentTransientMessage(message)).map((message) => {
    const linked = images.filter(image => message.imageIds?.includes(image.id) || (image.url && message.content.includes(image.url))).slice(0, 16)
    return {
      updateOne: {
        filter: { sessionId, messageId: message.id },
        update: {
          $set: { ...Object.fromEntries(Object.entries({ ...message, imageIds: linked.map(image => image.id) }).filter(([, value]) => value !== undefined).map(([key, value]) => [`message.${key}`, value])), images: linked },
          $setOnInsert: { sessionId, messageId: message.id },
        },
        upsert: true,
      },
    }
  })
  if (operations.length)
    await AgentHistory.bulkWrite(operations, { ordered: true })
}
export async function readAgentHistory(sessionId: string, query: {
  before?: unknown
  after?: unknown
  beforeId?: unknown
}): Promise<AgentHistoryPage> {
  let before = String(query.before || '')
  const after = String(query.after || '')
  if ((before && !/^[a-f\d]{24}$/i.test(before)) || (after && !/^[a-f\d]{24}$/i.test(after)) || (before && after))
    throw createError({ statusCode: 400, statusMessage: 'Invalid history cursor' })
  await connectDatabase()
  // Lazily import surviving legacy snapshots; never replace an existing archive.
  if (!await AgentHistory.exists({ sessionId })) {
    await withArchiveLock(sessionId, async () => {
      if (await AgentHistory.exists({ sessionId }))
        return
      const chat = await AgentChat.findOne({ sessionId }).select('messages images')
      if (chat?.messages?.length)
        await writeHistory(sessionId, chat.toObject().messages, chat.toObject().images)
    })
  }
  if (!before && !after && query.beforeId) {
    const anchor = await AgentHistory.findOne({ sessionId, messageId: { $in: [String(query.beforeId).slice(0, 120), `ui:${String(query.beforeId).slice(0, 120)}`] } }).select('_id')
    // An unknown live boundary must not replay the latest history page.
    if (!anchor)
      return { messages: [], images: [], olderCursor: null, newerCursor: null }
    before = String(anchor._id)
  }
  const visible = { sessionId, $nor: [{ 'message.kind': 'error', 'message.content': AGENT_TRANSIENT_ERROR_RE }] }
  const filter = {
    ...visible,
    ...(before ? { _id: { $lt: before } } : {}),
    ...(after ? { _id: { $gt: after } } : {}),
  }
  const rows = await AgentHistory.find(filter).sort({ _id: after ? 1 : -1 }).limit(PAGE_SIZE).lean()
  if (!after)
    rows.reverse()
  const first = rows[0]?._id
  const last = rows.at(-1)?._id
  const [older, newer] = await Promise.all([
    first ? AgentHistory.exists({ ...visible, _id: { $lt: first } }) : null,
    last ? AgentHistory.exists({ ...visible, _id: { $gt: last } }) : null,
  ])
  const media = new Map<string, AgentHistoryImage>()
  for (const row of rows) {
    for (const image of row.images as AgentHistoryImage[])
      media.set(image.id, image)
  }
  return {
    messages: rows.map(row => ({ ...row.message, id: row.messageId }) as AgentHistoryMessage),
    images: [...media.values()],
    olderCursor: older ? String(first) : null,
    newerCursor: newer ? String(last) : null,
  }
}
