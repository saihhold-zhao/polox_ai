// Request contention and throttling are transient UI state, not conversation turns.
// "No matching confirmation" is a stale confirm race (card already started/processed).
export const AGENT_TRANSIENT_ERROR_RE = /(?:this (?:agent lab )?session is already running|too many agent lab requests|no matching confirmation)/i

export function isAgentTransientMessage(message: { kind?: unknown, content?: unknown }) {
  return message.kind === 'error' && AGENT_TRANSIENT_ERROR_RE.test(String(message.content || ''))
}
