import type { ChatMessage, ToolCall } from './types'
import { falReadableUrl } from '../utils/falFiles'
import { agentEnv } from './env'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

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

interface OpenRouterChunk {
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
  return Promise.all(messages.map(async ({ historyId: _historyId, internal: _internal, ...message }) => {
    if (!Array.isArray(message.content)) return message
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== 'image_url') return part
      return { ...part, image_url: { ...part.image_url, url: await falReadableUrl(part.image_url.url) } }
    }))
    return { ...message, content }
  }))
}

export async function completeText(options: {
  signal?: AbortSignal
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal: options.signal,
    headers: {
      'Authorization': `Bearer ${agentEnv.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://polox.ai',
      'X-Title': 'PoloX Agent Lab',
    },
    body: JSON.stringify({
      model: agentEnv.model,
      temperature: options.temperature ?? 0.2,
      stream: false,
      reasoning: { enabled: false },
      max_tokens: options.maxTokens ?? 32,
      messages: await providerMessages(options.messages),
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `OpenRouter request failed (${response.status})`)
  }

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
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentEnv.openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://polox.ai',
      'X-Title': 'PoloX Agent Lab',
    },
    body: JSON.stringify({
      model: agentEnv.model,
      temperature: 0.4,
      stream: true,
      reasoning: { enabled: false },
      messages: await providerMessages(options.messages),
      tools: options.tools,
      tool_choice: options.disableTools ? 'none' : options.requiredTool ? { type: 'function', function: { name: options.requiredTool } } : 'auto',
      parallel_tool_calls: !options.requiredTool,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `OpenRouter request failed (${response.status})`)
  }

  if (!response.body)
    throw new Error('OpenRouter returned an empty stream')

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
      let chunk: OpenRouterChunk
      try {
        chunk = JSON.parse(data) as OpenRouterChunk
      }
      catch {
        continue
      }
      if (chunk.error?.message)
        throw new Error(chunk.error.message)
      const choice = chunk.choices?.[0]
      if (!choice)
        continue
      const delta = choice.delta || {}
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
