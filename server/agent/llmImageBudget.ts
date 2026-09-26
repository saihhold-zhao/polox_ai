/**
 * Image budget for LLM requests (pure; no network). LLM providers reject a
 * request whose image_url parts download to more than ~30MB in total (e.g. "Downloaded
 * image content cannot exceed 30MB"), and a long chat accumulates uploads plus the
 * auto-attached generated stills. Applied to a copy of the messages right before each
 * call, so stored sessions are never rewritten and stuck sessions recover on their own.
 */
import type { ChatMessage, UserContentPart } from './types'

export interface LlmImageBudgetOptions {
  maxImages: number
  maxBytes: number
  /** Assumed size when nothing better is known (conservative for full-res PNGs). */
  unknownBytes: number
  /** Only keep images from the latest real user turn onward (retry after a size error). */
  latestTurnOnly?: boolean
}

export const LLM_IMAGE_BUDGET: LlmImageBudgetOptions = {
  maxImages: 8,
  maxBytes: 18 * 1024 * 1024,
  unknownBytes: 4 * 1024 * 1024,
}

/** Stricter budget for the single automatic retry after a provider size error. */
export const LLM_IMAGE_RETRY_BUDGET: LlmImageBudgetOptions = {
  maxImages: 4,
  maxBytes: 8 * 1024 * 1024,
  unknownBytes: 4 * 1024 * 1024,
  latestTurnOnly: true,
}

export function llmImagePlaceholder(url: string) {
  return `[image omitted: ${url}]`
}

/** Exact decoded size of a base64 data URL, else undefined. */
export function dataUrlBytes(url: string) {
  if (!url.startsWith('data:'))
    return undefined
  const comma = url.indexOf(',')
  if (comma < 0)
    return url.length
  const body = url.slice(comma + 1)
  return /;base64$/i.test(url.slice(0, comma)) ? Math.floor(body.length * 3 / 4) : body.length
}

export function hasLlmImages(messages: readonly ChatMessage[]) {
  return messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))
}

/** Image URLs newest first (latest message first; within a message, in order), unique. */
export function llmImageUrlsNewestFirst(messages: readonly ChatMessage[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]!.content
    if (!Array.isArray(content))
      continue
    for (const part of content) {
      if (part.type !== 'image_url')
        continue
      const url = part.image_url?.url || ''
      if (url && !seen.has(url)) {
        seen.add(url)
        out.push(url)
      }
    }
  }
  return out
}

/** Index of the latest real (non-internal) user message; images before it are "older turns". */
function latestUserTurnIndex(messages: readonly ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role === 'user' && !message.internal)
      return index
  }
  return 0
}

export interface LlmImageBudgetResult {
  messages: ChatMessage[]
  kept: number
  omitted: number
  bytes: number
}

/**
 * Keep the newest images while they fit (count and bytes); once one does not fit,
 * every older image is replaced by a text placeholder carrying its original URL so
 * tools can still use it. `copyFor` may map an original URL to a smaller LLM copy
 * (e.g. a downscaled WaveSpeed upload of a local file); `sizeOf` returns known byte sizes.
 */
export function applyLlmImageBudget(
  messages: readonly ChatMessage[],
  options: LlmImageBudgetOptions & {
    sizeOf?: (url: string) => number | undefined
    copyFor?: (url: string) => string | undefined
  },
): LlmImageBudgetResult {
  const minIndex = options.latestTurnOnly ? latestUserTurnIndex(messages) : 0
  const decision = new Map<string, string | null>()
  let kept = 0
  let bytes = 0
  let closed = false
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]!.content
    if (!Array.isArray(content))
      continue
    for (const part of content) {
      if (part.type !== 'image_url')
        continue
      const url = part.image_url?.url || ''
      if (!url || decision.has(url))
        continue
      const sendUrl = options.copyFor?.(url) || url
      const size = dataUrlBytes(sendUrl) ?? options.sizeOf?.(sendUrl) ?? options.unknownBytes
      if (!closed && index >= minIndex && kept < options.maxImages && bytes + size <= options.maxBytes) {
        decision.set(url, sendUrl)
        kept++
        bytes += size
      }
      else {
        decision.set(url, null)
        closed = true
      }
    }
  }
  let omitted = 0
  const emitted = new Set<string>()
  const out = messages.map((message) => {
    if (!Array.isArray(message.content) || !message.content.some(part => part.type === 'image_url'))
      return message
    const content: UserContentPart[] = []
    for (const part of message.content) {
      if (part.type !== 'image_url') {
        content.push(part)
        continue
      }
      const url = part.image_url?.url || ''
      const sendUrl = decision.get(url)
      // The same URL attached twice is sent once (latest occurrence wins the slot).
      if (sendUrl && !emitted.has(url) && isLatestOccurrence(messages, message, url)) {
        emitted.add(url)
        content.push({ type: 'image_url', image_url: { url: sendUrl } })
      }
      else {
        omitted++
        content.push({ type: 'text', text: llmImagePlaceholder(url) })
      }
    }
    return { ...message, content }
  })
  return { messages: out, kept, omitted, bytes }
}

function isLatestOccurrence(messages: readonly ChatMessage[], target: ChatMessage, url: string) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]!.content
    if (Array.isArray(content) && content.some(part => part.type === 'image_url' && part.image_url?.url === url))
      return messages[index] === target
  }
  return false
}

/** Provider rejected the request because of image size/volume. */
export function isLlmImageSizeError(status: number, text: string) {
  return status === 413 || /cannot exceed \d+\s*mb|image[^.]{0,80}(?:too large|exceed)|payload too large|request entity too large/i.test(text)
}
