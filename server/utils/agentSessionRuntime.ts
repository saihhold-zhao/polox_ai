import type { IAgentChat } from '../models/agentChat'
import type { IGenerationJob } from '../models/generationJob'
import { completedLayerResults } from '../../shared/utils/agentLayerResults'
import { AgentChat } from '../models/agentChat'
import { isAgentSessionId } from './agentChats'
import { toPublicJob } from './generationResults'
import { connectDatabase } from './sqlite'

const MAX_RUNTIME_MESSAGES = 80
const MAX_RUNTIME_IMAGES = 80
const MAX_CONTENT = 8000
const MAX_ARGS = 8000
const MAX_URL = 2000
const MAX_IDS = 30
export interface AgentRuntimeSnapshot {
  sessionId: string
  projectId: string
  title: string
  quality: 'high' | 'economy' | 'hobby' | 'custom'
  confirmPolicy: 'auto' | 'when_needed' | 'always'
  messages: unknown[]
  images: unknown[]
  pendingConfirmation: unknown
  pendingChoice: unknown
  updatedAt: number
}
function clip(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max)
}
function httpUrl(value: unknown) {
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, MAX_URL) : ''
}
function httpUrls(value: unknown, max = MAX_IDS) {
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
function sanitizeContent(raw: unknown) {
  if (typeof raw === 'string')
    return clip(raw, MAX_CONTENT)
  if (!Array.isArray(raw))
    return ''
  const parts: Array<{
    type: 'text'
    text: string
  } | {
    type: 'image_url'
    image_url: {
      url: string
    }
  }> = []
  for (const entry of raw.slice(0, 16)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    if (row.type === 'image_url' && row.image_url && typeof row.image_url === 'object') {
      const url = httpUrl((row.image_url as Record<string, unknown>).url)
      if (url)
        parts.push({ type: 'image_url', image_url: { url } })
      continue
    }
    if (row.type === 'text' || typeof row.text === 'string') {
      const text = clip(row.text, MAX_CONTENT)
      if (text)
        parts.push({ type: 'text', text })
    }
  }
  return parts
}
function sanitizeToolCalls(raw: unknown) {
  if (!Array.isArray(raw))
    return undefined
  const items: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }> = []
  for (const entry of raw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const fn = row.function && typeof row.function === 'object'
      ? row.function as Record<string, unknown>
      : null
    const id = clip(row.id, 120)
    const name = clip(fn?.name, 80)
    if (!id || !name)
      continue
    items.push({
      id,
      type: 'function',
      function: {
        name,
        arguments: clip(fn?.arguments, MAX_ARGS),
      },
    })
  }
  return items.length ? items : undefined
}
function sanitizeMessages(raw: unknown) {
  if (!Array.isArray(raw))
    return []
  const items: Record<string, unknown>[] = []
  for (const entry of raw.slice(-MAX_RUNTIME_MESSAGES)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const role = row.role === 'system' || row.role === 'user' || row.role === 'assistant' || row.role === 'tool'
      ? row.role
      : null
    if (!role)
      continue
    const message: Record<string, unknown> = { role }
    if (row.historyId)
      message.historyId = clip(row.historyId, 100)
    if (row.internal)
      message.internal = true
    const content = sanitizeContent(row.content)
    if (content)
      message.content = content
    const toolCalls = sanitizeToolCalls(row.tool_calls)
    if (toolCalls)
      message.tool_calls = toolCalls
    const toolCallId = clip(row.tool_call_id, 120)
    if (toolCallId)
      message.tool_call_id = toolCallId
    items.push(message)
  }
  return items
}
function sanitizeImages(raw: unknown) {
  if (!Array.isArray(raw))
    return []
  const items: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const entry of raw.slice(0, MAX_RUNTIME_IMAGES * 2)) {
    if (!entry || typeof entry !== 'object')
      continue
    const row = entry as Record<string, unknown>
    const id = clip(row.id, 120)
    if (!id || seen.has(id))
      continue
    const status = row.status === 'generating' || row.status === 'fail' || row.status === 'success'
      ? row.status
      : 'success'
    const kind = clip(row.kind || 'still', 32) || 'still'
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
      sourceUrl: httpUrl(row.sourceUrl),
      inputUrls: httpUrls(row.inputUrls),
      referenceVideoUrls: httpUrls(row.referenceVideoUrls),
      duration: Math.max(0, Math.floor(Number(row.duration) || 0)),
      videoMode: clip(row.videoMode, 32),
      videoFamily: clip(row.videoFamily, 32),
      providerTaskId: clip(row.providerTaskId, 160),
      modelId: clip(row.modelId, 160),
      modelInput: row.modelInput && typeof row.modelInput === 'object' ? row.modelInput : undefined,
    })
    if (items.length >= MAX_RUNTIME_IMAGES)
      break
  }
  return items
}
function sanitizePending(raw: unknown) {
  if (!raw || typeof raw !== 'object')
    return null
  try {
    const text = JSON.stringify(raw)
    if (text.length > 80000)
      return null
    return JSON.parse(text) as Record<string, unknown>
  }
  catch {
    return null
  }
}
function mergePreservingSuccess(existing: Record<string, unknown>[], incoming: Record<string, unknown>[]) {
  const prevById = new Map(existing.map(item => [String(item.id || ''), item]))
  const seen = new Set<string>()
  const merged: Record<string, unknown>[] = []
  for (const item of incoming) {
    const id = String(item.id || '')
    if (!id || seen.has(id))
      continue
    seen.add(id)
    const prev = prevById.get(id)
    if (prev?.status === 'success' && prev.url && item.status !== 'success')
      merged.push(prev)
    else
      merged.push(item)
  }
  for (const prev of existing) {
    const id = String(prev.id || '')
    if (!id || seen.has(id))
      continue
    seen.add(id)
    merged.push(prev)
  }
  return merged.slice(0, MAX_RUNTIME_IMAGES)
}
function parseQuality(value: unknown): 'high' | 'economy' | 'hobby' | 'custom' {
  if (value === 'high' || value === 'hobby' || value === 'custom')
    return value
    // Legacy preference id from before the Hobby rename.
  if (value === 'draft')
    return 'hobby'
  return 'economy'
}
function parseConfirmPolicy(value: unknown): 'auto' | 'when_needed' | 'always' {
  return value === 'auto' || value === 'when_needed' ? value : 'always'
}
export function runtimeFromDoc(doc: IAgentChat): AgentRuntimeSnapshot | null {
  const runtime = doc.runtime && typeof doc.runtime === 'object'
    ? doc.runtime as Record<string, unknown>
    : null
  if (!runtime)
    return null
  const messages = sanitizeMessages(runtime.messages)
  const images = sanitizeImages(runtime.images)
  if (!messages.length && !images.length)
    return null
  return {
    sessionId: doc.sessionId,
    projectId: clip(doc.projectId, 80),
    title: clip(runtime.title || doc.title, 80),
    quality: parseQuality(runtime.quality || doc.quality),
    confirmPolicy: parseConfirmPolicy(runtime.confirmPolicy || doc.confirmPolicy),
    messages,
    images,
    pendingConfirmation: sanitizePending(runtime.pendingConfirmation),
    pendingChoice: sanitizePending(runtime.pendingChoice),
    updatedAt: Number(runtime.updatedAt) || new Date(doc.lastEventAt || doc.updatedAt).getTime(),
  }
}
export async function getAgentRuntime(sessionId: string) {
  const sid = String(sessionId || '').trim()
  if (!isAgentSessionId(sid))
    return null
  await connectDatabase()
  const doc = await AgentChat.findOne({ sessionId: sid })
  if (!doc)
    return null
  return runtimeFromDoc(doc)
}
export async function listAgentRuntimes(projectId = '') {
  await connectDatabase()
  const filter: Record<string, unknown> = {
    runtime: { $type: 'object' },
  }
  const scoped = String(projectId || '').trim()
  if (scoped) {
    filter.$or = [
      { projectId: scoped },
      { projectId: '' },
      { projectId: { $exists: false } },
    ]
  }
  const docs = await AgentChat.find(filter)
    .sort({ lastEventAt: -1 })
    .limit(20)
  return docs.map(runtimeFromDoc).filter((item): item is AgentRuntimeSnapshot => Boolean(item))
}
export async function upsertAgentRuntime(input: {
  sessionId: string
  projectId?: string
  title?: unknown
  quality?: unknown
  confirmPolicy?: unknown
  messages?: unknown
  images?: unknown
  pendingConfirmation?: unknown
  pendingChoice?: unknown
  updatedAt?: unknown
}) {
  const sessionId = String(input.sessionId || '').trim()
  if (!isAgentSessionId(sessionId))
    return null
  await connectDatabase()
  const existing = await AgentChat.findOne({ sessionId })
  const projectId = clip(input.projectId, 80)
  const title = clip(input.title, 80)
  const quality = parseQuality(input.quality)
  const confirmPolicy = parseConfirmPolicy(input.confirmPolicy)
  const messages = sanitizeMessages(input.messages)
  const pendingConfirmation = sanitizePending(input.pendingConfirmation)
  const pendingChoice = sanitizePending(input.pendingChoice)
  const updatedAt = Number(input.updatedAt) || Date.now()
  const existingRuntime = existing?.runtime && typeof existing.runtime === 'object'
    ? existing.runtime as Record<string, unknown>
    : null
  const existingImages = sanitizeImages(existingRuntime?.images)
  const images = mergePreservingSuccess(existingImages, sanitizeImages(input.images))
  const existingUpdatedAt = Number(existingRuntime?.updatedAt) || 0
  if (existing && existingUpdatedAt > updatedAt)
    return existing
  const runtime = {
    title,
    quality,
    confirmPolicy,
    messages,
    images,
    pendingConfirmation,
    pendingChoice,
    updatedAt,
  }
  const update: Record<string, unknown> = {
    title,
    quality,
    confirmPolicy,
    runtime,
    lastEventAt: new Date(updatedAt),
  }
  if (projectId) {
    update.projectId = projectId
  }
  if (images.length) {
    update.images = images.map(item => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      name: item.name,
      prompt: item.prompt,
      url: item.url,
      sourceUrl: item.sourceUrl,
      error: item.error,
      aspectRatio: item.aspectRatio,
      resolution: item.resolution,
      duration: item.duration,
    }))
  }
  return AgentChat.findOneAndUpdate({ sessionId }, {
    $set: update,
    $setOnInsert: {
      sessionId,

      messages: existing?.messages || [],
    },
  }, { upsert: true, returnDocument: 'after' })
}
export async function listInflightAgentRuntimes(limit = 40) {
  await connectDatabase()
  const docs = await AgentChat.find({
    'runtime.images': {
      $elemMatch: {
        status: 'generating',
        providerTaskId: { $type: 'string', $nin: ['', null] },
      },
    },
  })
    .sort({ lastEventAt: -1 })
    .limit(Math.max(1, Math.min(80, limit)))
  return docs.map(runtimeFromDoc).filter((item): item is AgentRuntimeSnapshot => Boolean(item))
}
/** Sessions parked on a confirmation card (e.g. browser closed before Automatic continue). */
export async function listPendingConfirmAgentRuntimes(limit = 40) {
  await connectDatabase()
  const docs = await AgentChat.find({
    'runtime.pendingConfirmation': { $type: 'object' },
  })
    .sort({ lastEventAt: -1 })
    .limit(Math.max(1, Math.min(80, limit)))
  return docs.map(runtimeFromDoc).filter((item): item is AgentRuntimeSnapshot => Boolean(item))
}
/** Recent Automatic sessions that may need loop continuation after a deploy. */
export async function listRecentAutoAgentRuntimes(limit = 40) {
  await connectDatabase()
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000)
  const docs = await AgentChat.find({
    runtime: { $type: 'object' },
    lastEventAt: { $gte: since },
    $or: [
      { 'runtime.confirmPolicy': 'auto' },
      { confirmPolicy: 'auto' },
      { 'runtime.confirmPolicy': 'when_needed' },
      { confirmPolicy: 'when_needed' },
    ],
  })
    .sort({ lastEventAt: -1 })
    .limit(Math.max(1, Math.min(80, limit)))
  return docs.map(runtimeFromDoc).filter((item): item is AgentRuntimeSnapshot => Boolean(item))
}
export async function syncAgentRuntimeFromJob(job: IGenerationJob) {
  const original = job.originalRequest && typeof job.originalRequest === 'object'
    ? job.originalRequest as Record<string, unknown>
    : {}
  const taskId = String(job.taskId || '').trim()
  if (String(original.source || '') !== 'agent' && !taskId.startsWith('agent_')) {
    return
  }
  const imageId = String(original.imageId || '').trim()
    || (taskId.startsWith('agent_') ? taskId.slice('agent_'.length) : '')
  if (!imageId) {
    return
  }
  const preview = toPublicJob(job)
  const url = preview.resultUrls[0] || ''
  const failed = job.state === 'fail'
  const ready = Boolean(url) && (job.state === 'success'
    || job.state === 'archiving'
    || job.state === 'moderating')
  if (!failed && !ready) {
    return
  }
  await connectDatabase()
  const sessionId = String(original.sessionId || '').trim()
  const doc = sessionId && isAgentSessionId(sessionId)
    ? await AgentChat.findOne({ sessionId })
    : await AgentChat.findOne({
        'runtime.images.id': imageId,
      })
  if (!doc?.runtime || typeof doc.runtime !== 'object') {
    return
  }
  const runtime = { ...(doc.runtime as Record<string, unknown>) }
  const images = sanitizeImages(runtime.images)
  const index = images.findIndex(item => String(item.id || '') === imageId)
  if (index < 0) {
    return
  }
  const current = images[index]
  if (!current) {
    return
  }
  if (failed && current.status === 'success' && current.url)
    return
  images[index] = {
    ...current,
    status: failed ? 'fail' : 'success',
    url: failed ? '' : url,
    error: failed ? String(job.failMsg || current.error || 'Generation failed') : '',
  }
  for (const layer of completedLayerResults({ ...images[index]!, id: imageId }, preview)) {
    const existing = images.findIndex(item => item.id === layer.id)
    if (existing >= 0)
      images[existing] = layer
    else
      images.push(layer)
  }
  runtime.images = images
  doc.runtime = runtime
  doc.markModified('runtime')
  if (Array.isArray(doc.images) && doc.images.length) {
    doc.images = doc.images.map((item) => {
      if (item.id !== imageId)
        return item
      return {
        ...item,
        status: failed ? 'fail' : 'success',
        url: failed ? '' : url,
        error: failed ? String(job.failMsg || item.error || 'Generation failed') : '',
      }
    })
  }
  await doc.save()
}
