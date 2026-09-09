/** Patterns for agent-protocol text that must not appear in the chat UI. */

const INSPECT_STILLS_MARKER = 'Inspect these generated stills from the last tool results'
const ATTACHED_STILLS_MARKER = '\n\nAttached stills:'
const TOOL_URL_HINT_MARKER = 'Use these URLs as generate_image input_urls'
const ATTACH_ONLY_FALLBACK = 'Use the attached still(s).'

export function isInternalAgentChatText(text: string) {
  const value = String(text || '').trim()
  if (!value)
    return false
  if (value.startsWith(INSPECT_STILLS_MARKER) || value.includes(INSPECT_STILLS_MARKER))
    return true
  // Entire turn is only the attach protocol (no human prompt left after strip).
  const publicText = publicAgentChatText(value)
  if (!publicText && (value.includes('Attached stills:') || value.includes(TOOL_URL_HINT_MARKER)))
    return true
  return false
}

/** Strip LLM-only attachment protocol from a user turn, keeping the human prompt. */
export function publicAgentChatText(text: string) {
  let value = String(text || '')
  const attachedAt = value.indexOf(ATTACHED_STILLS_MARKER)
  if (attachedAt >= 0)
    value = value.slice(0, attachedAt)
  else {
    const hintAt = value.indexOf(TOOL_URL_HINT_MARKER)
    if (hintAt >= 0)
      value = value.slice(0, hintAt).replace(/\n+Attached stills:\s*(?:https?:\/\/\S+\s*)*$/i, '')
  }
  const trimmed = value.trim()
  if (trimmed === ATTACH_ONLY_FALLBACK)
    return ''
  return trimmed
}
