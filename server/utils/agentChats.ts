import type { IAgentChat, IAgentChatImage, IAgentChatMessage } from '../models/agentChat'
import { isAgentTransientMessage } from '../../shared/utils/agentHistoryVisibility'
import { AgentChat } from '../models/agentChat'
import { archiveAgentUiHistory } from './agentHistory'
import { connectDatabase } from './sqlite'

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGES = 120
const MAX_IMAGES = 60
const MAX_CONTENT = 4000
const MAX_PREVIEW = 240
const MAX_IDS = 16
export interface AgentChatUpsertInput {
  sessionId: string
  projectId?: string
  messages?: unknown
  images?: unknown
  replaceMessages?: boolean
  replaceImages?: boolean
}
function clip(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max)
}
function httpUrl(value: unknown) {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, 2000) : ''
}
export function isAgentSessionId(value: string) {
  return SESSION_ID_RE.test(value)
}
function cardRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return null
  const json = JSON.stringify(value)
  return json.length <= 50000 ? JSON.parse(json) : null
}
function sanitizeMessages(raw: unknown): IAgentChatMessage[] {
  if (!Array.isArray(raw))
    return []
  const items: IAgentChatMessage[] = []
  for (const entry of raw.slice(-MAX_MESSAGES)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const role = row.role === 'user' || row.role === 'assistant' ? row.role : null
    if (!role || isAgentTransientMessage(row))
      continue
    const confirmation = row.confirmation && typeof row.confirmation === 'object'
      ? row.confirmation as Record<string, unknown>
      : null
    const state = row.confirmationState === 'pending'
      || row.confirmationState === 'confirmed'
      || row.confirmationState === 'cancelled'
      || row.confirmationState === 'blocked'
      ? row.confirmationState
      : ''
    const imageIds = Array.isArray(row.imageIds)
      ? row.imageIds.map(id => clip(id, 120)).filter(Boolean).slice(0, MAX_IDS)
      : []
    items.push({
      id: clip(row.id, 120) || crypto.randomUUID(),
      role,
      kind: row.kind === 'error' ? 'error' : '',
      content: clip(row.content, MAX_CONTENT),
      imageIds,
      confirmationState: state,
      confirmation: cardRecord(row.confirmation),
      resolvedParams: cardRecord(row.resolvedParams),
      choice: cardRecord(row.choice),
      choiceState: row.choiceState === 'pending' || row.choiceState === 'answered' || row.choiceState === 'skipped' ? row.choiceState : '',
      choiceAnswers: Array.isArray(row.choiceAnswers)
        ? row.choiceAnswers.slice(0, 20).map(cardRecord).filter((item): item is Record<string, unknown> => Boolean(item))
        : [],
      confirmationReason: clip(confirmation?.reason || row.confirmationReason, 500),

    })
  }
  return items
}
function sanitizeImages(raw: unknown): IAgentChatImage[] {
  if (!Array.isArray(raw))
    return []
  const items: IAgentChatImage[] = []
  for (const entry of raw.slice(0, MAX_IMAGES)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const id = clip(row.id, 120)
    if (!id)
      continue
    const status = row.status === 'generating' || row.status === 'fail' || row.status === 'success'
      ? row.status
      : 'success'
    items.push({
      id,
      kind: clip(row.kind || 'still', 32) || 'still',
      status,
      name: clip(row.name, 100),
      prompt: clip(row.prompt, MAX_CONTENT),
      url: httpUrl(row.url),
      sourceUrl: httpUrl(row.sourceUrl),
      error: clip(row.error, 500),
      aspectRatio: clip(row.aspectRatio, 32),
      resolution: clip(row.resolution, 32),
      duration: Math.max(0, Math.floor(Number(row.duration) || 0)),
    })
  }
  return items
}
function mergeImages(existing: IAgentChatImage[], incoming: IAgentChatImage[]) {
  const map = new Map(existing.map(item => [item.id, item]))
  for (const item of incoming)
    map.set(item.id, item)
  return [...map.values()].slice(0, MAX_IMAGES)
}
function statsFrom(messages: IAgentChatMessage[], images: IAgentChatImage[]) {
  const generated = images.filter(item => item.kind !== 'upload')
  const lastUser = [...messages].reverse().find(item => item.role === 'user' && item.content)
  return {
    preview: clip(lastUser?.content, MAX_PREVIEW),
    messageCount: messages.length,
    userTurnCount: messages.filter(item => item.role === 'user').length,
    assistantTurnCount: messages.filter(item => item.role === 'assistant' && item.kind !== 'error').length,
    imageCount: generated.filter(item => item.kind !== 'video' && item.kind !== 'cutout').length,
    videoCount: generated.filter(item => item.kind === 'video').length,
    cutoutCount: generated.filter(item => item.kind === 'cutout').length,
    successCount: generated.filter(item => item.status === 'success' && item.url).length,
    failCount: generated.filter(item => item.status === 'fail').length,
  }
}
export async function upsertAgentChat(input: AgentChatUpsertInput) {
  const sessionId = String(input.sessionId || '').trim()
  if (!isAgentSessionId(sessionId))
    return null
  await connectDatabase()
  const existing = await AgentChat.findOne({ sessionId })
  const projectId = clip(input.projectId, 80)
  const messages = input.messages !== undefined
    ? sanitizeMessages(input.messages)
    : existing?.messages || []
  const images = input.images !== undefined
    ? sanitizeImages(input.images)
    : existing?.images || []
  const replaceMessages = input.replaceMessages !== false
  const nextMessages = replaceMessages || !existing?.messages?.length
    ? messages
    : existing.messages
  const nextImages = input.replaceImages === false && existing?.images?.length
    ? mergeImages(existing.images, images)
    : images
  await archiveAgentUiHistory(sessionId, messages, images)
  const stats = statsFrom(nextMessages, nextImages)
  const update: Record<string, unknown> = {
    lastEventAt: new Date(),
    messages: nextMessages,
    images: nextImages,
    ...stats,
  }
  if (projectId)
    update.projectId = projectId
  return AgentChat.findOneAndUpdate({ sessionId }, {
    $set: update,
    $setOnInsert: {
      sessionId,

    },
  }, { upsert: true, returnDocument: 'after' })
}
async function loadServiceSession(sessionId: string) {
  const { loadSession, publicSession } = await import('../agent/session')
  const session = await loadSession(sessionId)
  if (!session)
    return null
  return publicSession(session) as {
    sessionId?: string
    images?: unknown
    messages?: Array<{
      role?: string
      content?: string
      imageIds?: string[]
    }>
  }
}
export async function snapshotAgentChatFromService(input: {
  sessionId: string
  projectId?: string

}) {
  const sessionId = String(input.sessionId || '').trim()
  if (!isAgentSessionId(sessionId))
    return
  try {
    const payload = await loadServiceSession(sessionId)
    const serviceMessages = Array.isArray(payload?.messages)
      ? payload.messages.map((item, index) => ({
          id: `${sessionId}:${index}`,
          role: item.role,
          content: item.content,
          imageIds: item.imageIds,
        }))
      : undefined
    await upsertAgentChat({
      sessionId,
      projectId: input.projectId,
      images: payload?.images,
      messages: serviceMessages,
      replaceMessages: false,
      replaceImages: false,
    })
  }
  catch (error) {
    console.error('[agent chat snapshot]', sessionId, error)
  }
}
export function toWorkspaceAgentChat(doc: IAgentChat) {
  return {
    sessionId: doc.sessionId,
    projectId: doc.projectId || '',
    preview: doc.preview || '',
    updatedAt: new Date(doc.lastEventAt || doc.updatedAt).getTime(),
    messages: doc.messages || [],
    images: doc.images || [],
  }
}
export async function getAgentChat(sessionId: string) {
  const sid = String(sessionId || '').trim()
  if (!isAgentSessionId(sid))
    return null
  await connectDatabase()
  return AgentChat.findOne({ sessionId: sid })
}
export async function listAgentChats(projectId = '') {
  await connectDatabase()
  const filter: Record<string, unknown> = {}
  const scoped = String(projectId || '').trim()
  if (scoped) {
    filter.projectId = scoped
  }
  return AgentChat.find(filter)
    .sort({ lastEventAt: -1 })
    .limit(20)
}
