import type { ChatMessage, ToolCall } from './types'
import { readStoredMedia } from '../utils/localMedia'
import { uploadWavespeedFile } from '../utils/wavespeed'
import { agentEnv } from './env'
import { hasLlmImages, isLlmImageSizeError, LLM_IMAGE_BUDGET, LLM_IMAGE_RETRY_BUDGET } from './llmImageBudget'
import { budgetLlmImages } from './llmImageCopies'

/** Strip layer-selection bbox coordinates before the LLM sees tool results. Server session keeps full regions. */
function messagesForLlm(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ historyId: _historyId, internal: _internal, ...message }) => {
    if (message.role !== 'tool' || typeof message.content !== 'string')
      return message
    try {
      const parsed = JSON.parse(message.content) as {
        ok?: boolean
        answers?: Array<Record<string, unknown>>
        [key: string]: unknown
      }
      if (!Array.isArray(parsed.answers))
        return message
      let changed = false
      const answers = parsed.answers.map((answer) => {
        if (answer.questionId !== 'layer_selection_method' || answer.optionId !== 'draw_boxes')
          return answer
        const next: Record<string, unknown> = { ...answer }
        if ('regions' in next) {
          const regions = Array.isArray(next.regions) ? next.regions : []
          next.boxCount = regions.length
          delete next.regions
          changed = true
        }
        if (Array.isArray(next.imageSelections)) {
          next.imageSelections = (next.imageSelections as Array<Record<string, unknown>>).map((selection) => {
            const row: Record<string, unknown> = {
              imageUrl: selection.imageUrl,
              boxCount: Array.isArray(selection.regions) ? selection.regions.length : (selection.boxCount || 0),
            }
            if (typeof selection.boxedImageUrl === 'string' && selection.boxedImageUrl)
              row.boxedImageUrl = selection.boxedImageUrl
            changed = true
            return row
          })
        }
        return next
      })
      if (!changed)
        return message
      return {
        ...message,
        content: JSON.stringify({ ...parsed, answers }),
      }
    }
    catch {
      return message
    }
  })
}

const WAVESPEED_URL = 'https://llm.wavespeed.ai/v1/chat/completions'

export interface StreamDelta {
  content?: string
  reasoning?: string
  toolCalls?: Array<{
    index: number
    id?: string
    name?: string
    arguments?: string
  }>
  finishReason?: string | null
}

interface WaveSpeedChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

async function providerMessages(messages: ChatMessage[]) {
  const imageUrls = new Map<string, Promise<string>>()
  const providerImageUrl = (source: string) => {
    let pending = imageUrls.get(source)
    if (!pending) {
      pending = (async () => {
        const local = await readStoredMedia(source, 200 * 1024 * 1024)
        return local ? uploadWavespeedFile(local.bytes, local.mime, new URL(source).pathname.split('/').pop() || 'image.png') : source
      })()
      imageUrls.set(source, pending)
    }
    return pending
  }
  // Older sessions may contain synthetic results for uploads, which have no tool call.
  const pendingCalls = new Set<string>()
  const pairedMessages = messages.filter((message) => {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || [])
        pendingCalls.add(call.id)
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id || !pendingCalls.delete(message.tool_call_id))
        return false
    }
    return true
  })
  return Promise.all(pairedMessages.map(async ({ historyId: _historyId, internal: _internal, ...message }) => {
    if (!Array.isArray(message.content))
      return message
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== 'image_url')
        return part
      if (agentEnv.model === 'deepseek/deepseek-v4-flash')
        throw new Error('DeepSeek V4 Flash does not support image input. Send a text-only message or choose a vision-capable model in Service connection.')
      const url = await providerImageUrl(part.image_url.url)
      return { ...part, image_url: { ...part.image_url, url } }
    }))
    return { ...message, content }
  }))
}

/**
 * POST with the image budget applied to a copy of the messages (stored sessions are never
 * rewritten). Local images are downscaled and uploaded to WaveSpeed first. If the
 * provider still rejects the images by size (413 / "cannot exceed 30MB"), retry once
 * keeping only the latest turn's images under a stricter budget; other failures are
 * thrown as before.
 */
async function postWithImageBudget(messages: ChatMessage[], body: (messages: ChatMessage[]) => Record<string, unknown>, signal?: AbortSignal, strict = false) {
  const send = async (budget: typeof LLM_IMAGE_BUDGET) => {
    // Budget before messagesForLlm: the latest-turn retry needs the `internal` flag.
    const prepared = await budgetLlmImages(messages, budget)
    return fetch(WAVESPEED_URL, {
      method: 'POST',
      signal,
      headers: {
        'Authorization': `Bearer ${agentEnv.wavespeedApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body(await providerMessages(messagesForLlm(prepared.messages)))),
    })
  }
  let response = await send(strict ? LLM_IMAGE_RETRY_BUDGET : LLM_IMAGE_BUDGET)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (!strict && hasLlmImages(messages) && isLlmImageSizeError(response.status, text)) {
      console.error('[agent llm] image size rejected; retrying with latest-turn images only', response.status, text.slice(0, 300))
      response = await send(LLM_IMAGE_RETRY_BUDGET)
      if (response.ok)
        return response
      const retryText = await response.text().catch(() => '')
      console.error('[agent llm] retry failed', response.status, retryText.slice(0, 500))
      throw new Error(retryText || `WaveSpeed request failed (${response.status})`)
    }
    console.error('[agent llm] request failed', response.status, text.slice(0, 500))
    throw new Error(text || `WaveSpeed request failed (${response.status})`)
  }
  return response
}

export async function completeText(options: {
  signal?: AbortSignal
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}) {
  const response = await postWithImageBudget(options.messages, messages => ({
    model: agentEnv.model,
    temperature: options.temperature ?? 0.2,
    stream: false,
    max_tokens: options.maxTokens ?? 32,
    messages,
  }), options.signal)

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
    error?: { message?: string }
  }
  if (payload.error?.message)
    throw new Error(payload.error.message)
  return String(payload.choices?.[0]?.message?.content || '').trim()
}

export async function streamChat(options: {
  messages: ChatMessage[]
  tools: unknown[]
  requiredTool?: string
  disableTools?: boolean
  signal?: AbortSignal
  onDelta: (delta: StreamDelta) => void
}) {
  try {
    await streamChatOnce(options, false)
  }
  catch (error) {
    // Size errors can also arrive as the first SSE error chunk (before any delta).
    if (!(error instanceof StreamImageSizeError))
      throw error
    console.error('[agent llm] image size rejected in stream; retrying with latest-turn images only', error.message.slice(0, 300))
    await streamChatOnce(options, true)
  }
}

class StreamImageSizeError extends Error {}

async function streamChatOnce(options: Parameters<typeof streamChat>[0], strict: boolean) {
  let emitted = false
  const response = await postWithImageBudget(options.messages, messages => ({
    model: agentEnv.model,
    temperature: 0.4,
    stream: true,
    messages,
    tools: options.tools,
    tool_choice: options.disableTools ? 'none' : options.requiredTool ? { type: 'function', function: { name: options.requiredTool } } : 'auto',
    parallel_tool_calls: !options.requiredTool,
  }), options.signal, strict)

  if (!response.body)
    throw new Error('WaveSpeed returned an empty stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:'))
        continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]')
        continue
      let chunk: WaveSpeedChunk
      try {
        chunk = JSON.parse(data) as WaveSpeedChunk
      }
      catch {
        continue
      }
      if (chunk.error?.message) {
        if (!strict && !emitted && hasLlmImages(options.messages) && isLlmImageSizeError(0, chunk.error.message))
          throw new StreamImageSizeError(chunk.error.message)
        console.error('[agent llm] stream error', chunk.error.message.slice(0, 500))
        throw new Error(chunk.error.message)
      }
      const choice = chunk.choices?.[0]
      if (!choice)
        continue
      const delta = choice.delta || {}
      emitted = true
      options.onDelta({
        content: delta.content || undefined,
        reasoning: delta.reasoning || delta.reasoning_content || undefined,
        toolCalls: (delta.tool_calls || []).map(item => ({
          index: item.index ?? 0,
          id: item.id,
          name: item.function?.name,
          arguments: item.function?.arguments,
        })),
        finishReason: choice.finish_reason,
      })
    }
  }
}

export function assembleToolCalls(parts: Array<{ index: number, id?: string, name?: string, arguments?: string }>): ToolCall[] {
  const byIndex = new Map<number, { id: string, name: string, arguments: string }>()
  for (const part of parts) {
    const current = byIndex.get(part.index) || { id: '', name: '', arguments: '' }
    if (part.id)
      current.id = part.id
    if (part.name)
      current.name = part.name
    if (part.arguments)
      current.arguments += part.arguments
    byIndex.set(part.index, current)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => ({
      id: value.id || crypto.randomUUID(),
      type: 'function' as const,
      function: {
        name: value.name,
        arguments: value.arguments || '{}',
      },
    }))
}
