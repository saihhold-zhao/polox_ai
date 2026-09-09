import type { ChatMessage } from './types'
import { completeText } from './llm'

export const DEFAULT_AGENT_TITLE = 'New agent'
const TITLE_MAX = 48

function messageText(message: ChatMessage) {
  if (typeof message.content === 'string')
    return message.content.trim()
  if (!Array.isArray(message.content))
    return ''
  return message.content
    .map(part => part.type === 'text' ? part.text : '')
    .join(' ')
    .trim()
}

export function fallbackTitle(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned)
    return DEFAULT_AGENT_TITLE
  if (cleaned.length <= TITLE_MAX)
    return cleaned
  return `${cleaned.slice(0, TITLE_MAX).trim()}…`
}

export function sanitizeTitle(raw: string) {
  const cleaned = raw
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .replace(/[.。!！?？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned)
    return ''
  if (cleaned.length <= TITLE_MAX)
    return cleaned
  return `${cleaned.slice(0, TITLE_MAX).trim()}…`
}

export async function summarizeSessionTitle(messages: ChatMessage[]) {
  const lines = messages
    .filter(item => item.role === 'user' || item.role === 'assistant')
    .slice(0, 8)
    .map((item) => {
      const text = messageText(item).slice(0, 240)
      return text ? `${item.role}: ${text}` : ''
    })
    .filter(Boolean)

  const firstUser = messages.find(item => item.role === 'user')
  const fallback = fallbackTitle(firstUser ? messageText(firstUser) : '')
  if (!lines.length)
    return fallback

  try {
    const title = await completeText({
      messages: [
        {
          role: 'system',
          content: 'Write a short chat title from this conversation. 2 to 8 words. Use the user\'s preferred language: follow their latest explicit language preference, otherwise use the language of their messages. No quotes, no trailing punctuation, no explanation.',
        },
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 32,
    })
    return sanitizeTitle(title) || fallback
  }
  catch {
    return fallback
  }
}
