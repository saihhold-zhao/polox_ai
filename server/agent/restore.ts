import type { AgentSession } from './session'
import type { AgentImage, AgentImageKind, ChatMessage, VideoFamily } from './types'
import { getAgentChat } from '../utils/agentChats'
import { refreshSessionPrompt, touch } from './session'

const MAX_HISTORY = 36
const MAX_IMAGES = 48
const MAX_CONTENT = 4000
function clip(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max)
}
function httpUrl(value: unknown) {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, 2000) : ''
}
function httpUrls(value: unknown, max = 16) {
  if (!Array.isArray(value))
    return []
  const out: string[] = []
  for (const item of value) {
    const url = httpUrl(item)
    if (url && !out.includes(url))
      out.push(url)
    if (out.length >= max)
      break
  }
  return out
}
function flattenContent(content: ChatMessage['content']) {
  if (typeof content === 'string')
    return content.trim()
  if (!Array.isArray(content))
    return ''
  return content
    .map(part => part.type === 'text' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}
function transcriptTurns(messages: ChatMessage[]) {
  return messages.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant')
      return false
    if (message.tool_calls?.length && !flattenContent(message.content))
      return false
    return Boolean(flattenContent(message.content))
  })
}
function hasToolTranscript(session: AgentSession) {
  return session.messages.some(message => message.role === 'tool' || Boolean(message.tool_calls?.length))
}
function messageText(row: Record<string, unknown>) {
  if (row.kind === 'error')
    return ''
  const content = clip(row.content, MAX_CONTENT)
  const confirmation = row.confirmation && typeof row.confirmation === 'object'
    ? row.confirmation as Record<string, unknown>
    : null
  const params = confirmation?.params && typeof confirmation.params === 'object'
    ? confirmation.params as Record<string, unknown>
    : null
  const reason = clip(confirmation?.reason || row.confirmationReason, 500)
  const prompt = clip(params?.prompt, 800)
  const urls = httpUrls(confirmation?.inputUrls)
  const extras = [
    reason && reason !== content ? `Plan: ${reason}` : '',
    prompt && prompt !== content && prompt !== reason ? `Prompt: ${prompt}` : '',
    urls.length ? `Reference URLs:\n${urls.join('\n')}` : '',
  ].filter(Boolean)
  return [content, ...extras].join('\n\n').trim().slice(0, MAX_CONTENT)
}
export function parseClientHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw))
    return []
  const items: ChatMessage[] = []
  for (const entry of raw.slice(-MAX_HISTORY)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const role = row.role === 'user' || row.role === 'assistant' ? row.role : null
    if (!role)
      continue
    const content = messageText(row)
    if (!content)
      continue
    items.push({ role, content })
  }
  return items
}
export function parseClientImages(raw: unknown): AgentImage[] {
  if (!Array.isArray(raw))
    return []
  const items: AgentImage[] = []
  const seen = new Set<string>()
  for (const entry of raw.slice(0, MAX_IMAGES * 2)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const id = clip(row.id, 120)
    if (!id || seen.has(id))
      continue
    const kind = row.kind === 'video' || row.kind === 'cutout' || row.kind === 'upload' || row.kind === 'still'
      ? row.kind as AgentImageKind
      : 'still'
    const status = row.status === 'generating' || row.status === 'fail' || row.status === 'success'
      ? row.status
      : 'success'
    const videoFamily: VideoFamily | undefined = row.videoFamily === 'seedance-2-5'
      ? 'seedance-2-5'
      : row.videoFamily === 'wan-3'
        ? 'wan-3'
        : row.videoFamily === 'seedance-2'
          ? 'seedance-2'
          : undefined
    const videoMode = row.videoMode === 'text'
      || row.videoMode === 'image'
      || row.videoMode === 'reference'
      || row.videoMode === 'concat'
      ? row.videoMode
      : undefined
    seen.add(id)
    items.push({
      id,
      kind,
      status,
      name: clip(row.name, 100),
      prompt: clip(row.prompt, MAX_CONTENT),
      aspectRatio: clip(row.aspectRatio, 32),
      resolution: clip(row.resolution, 32),
      url: httpUrl(row.url),
      error: clip(row.error, 500),
      sourceUrl: httpUrl(row.sourceUrl) || undefined,
      inputUrls: httpUrls(row.inputUrls),
      referenceVideoUrls: httpUrls(row.referenceVideoUrls),
      duration: Math.max(0, Math.floor(Number(row.duration) || 0)) || undefined,
      videoMode,
      videoFamily,
      modelId: typeof row.modelId === 'string' ? row.modelId : undefined,
      modelInput: row.modelInput && typeof row.modelInput === 'object' ? row.modelInput as Record<string, unknown> : undefined,
    })
    if (items.length >= MAX_IMAGES)
      break
  }
  return items
}
function dropCurrentUserTurn(history: ChatMessage[], currentText: string) {
  const text = currentText.trim()
  if (!text)
    return history
  const last = history[history.length - 1]
  if (last?.role !== 'user')
    return history
  const content = flattenContent(last.content)
  if (content === text || content.startsWith(`${text}\n`) || content.startsWith(`${text}\n\n`))
    return history.slice(0, -1)
  return history
}
function mergeImages(existing: AgentImage[], incoming: AgentImage[]) {
  const map = new Map<string, AgentImage>()
  for (const item of incoming)
    map.set(item.id, item)
  for (const item of existing) {
    const previous = map.get(item.id)
    map.set(item.id, previous ? { ...previous, ...item, url: item.url || previous.url } : item)
  }
  return [...map.values()].slice(0, MAX_IMAGES)
}
function applySnapshot(session: AgentSession, history: ChatMessage[], images: AgentImage[], replaceTranscript: boolean) {
  if (images.length)
    session.images = mergeImages(session.images, images)
  if (replaceTranscript && history.length) {
    const system = session.messages.find(message => message.role === 'system')
      || { role: 'system' as const, content: '' }
    session.messages = [system, ...history]
  }
  refreshSessionPrompt(session)
  touch(session)
}
async function fetchStoredChat(session: AgentSession) {
  try {
    const doc = await getAgentChat(session.id)
    if (!doc)
      return null
    return {
      messages: parseClientHistory(doc.messages),
      images: parseClientImages(doc.images),
    }
  }
  catch {
    return null
  }
}
export async function restoreSessionContext(session: AgentSession, history: unknown, images: unknown, currentText = '') {
  const restoredImages = parseClientImages(images)
  if (hasToolTranscript(session)) {
    if (restoredImages.length > session.images.length) {
      session.images = mergeImages(session.images, restoredImages)
      refreshSessionPrompt(session)
      touch(session)
    }
    return
  }
  let restoredHistory = dropCurrentUserTurn(parseClientHistory(history), currentText)
  let nextImages = restoredImages
  const existingTurns = transcriptTurns(session.messages).length
  const needsTranscript = restoredHistory.length > existingTurns
  const needsImages = nextImages.length > session.images.length
  if (!needsTranscript && !needsImages) {
    if (existingTurns > 0 || session.images.length)
      return
    const stored = await fetchStoredChat(session)
    if (!stored)
      return
    restoredHistory = dropCurrentUserTurn(stored.messages, currentText)
    nextImages = stored.images
    if (restoredHistory.length <= existingTurns && nextImages.length <= session.images.length)
      return
  }
  applySnapshot(session, restoredHistory, nextImages, restoredHistory.length > existingTurns)
}
