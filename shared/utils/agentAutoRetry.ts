/**
 * Guards for the hidden automatic shot-retry turn (INTERNAL_AUTO_RETRY_MARKER).
 *
 * An auto retry is only legitimate for a failure that just happened while the
 * user is watching. Old failures reloaded from history (e.g. a shot interrupted
 * by a deploy days ago, already refunded and regenerated) must never trigger a
 * new paid generation.
 */

/** Hidden line appended to auto-retry instructions so the server can verify the target images. */
export const AUTO_RETRY_IDS_PREFIX = '<<<AUTO_RETRY_IDS:'
const AUTO_RETRY_IDS_SUFFIX = '>>>'

/**
 * Server ignores auto-retry requests for failures older than this. The client only
 * settles a batch after every sibling finishes (long video batches can take >10 min),
 * so this is generous; `autoRetryHandled` is the once-per-failure guard.
 */
export const AUTO_RETRY_MAX_FAIL_AGE_MS = 60 * 60 * 1000

export interface AutoRetryImageLike {
  id: string
  kind?: string
  status: 'generating' | 'success' | 'fail'
  prompt?: string
  modelId?: string
  /** Epoch ms when the server first saw this image fail. */
  failedAt?: number
  /** Set once an auto retry was issued for this failure; never retry it again. */
  autoRetryHandled?: boolean
}

export function formatAutoRetryIds(ids: string[]) {
  const clean = [...new Set(ids.map(id => String(id || '').trim()).filter(id => /^[\w:.-]{1,120}$/.test(id)))]
  return clean.length ? `${AUTO_RETRY_IDS_PREFIX}${clean.join(',')}${AUTO_RETRY_IDS_SUFFIX}` : ''
}

export function parseAutoRetryIds(text: string) {
  const value = String(text || '')
  const at = value.indexOf(AUTO_RETRY_IDS_PREFIX)
  if (at < 0)
    return []
  const end = value.indexOf(AUTO_RETRY_IDS_SUFFIX, at + AUTO_RETRY_IDS_PREFIX.length)
  if (end < 0)
    return []
  return value.slice(at + AUTO_RETRY_IDS_PREFIX.length, end)
    .split(',')
    .map(id => id.trim())
    .filter(id => /^[\w:.-]{1,120}$/.test(id))
}

/** Remove the machine-only id line before the text reaches the LLM / transcript. */
export function stripAutoRetryIds(text: string) {
  return String(text || '')
    .replace(/\n?<<<AUTO_RETRY_IDS:[^>\n]*>>>/g, '')
    .trim()
}

function normalizePrompt(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A failed shot is superseded when another output of the same kind with the
 * same prompt succeeded or is still generating (the agent/user already retried it).
 * `excludeIds` lets callers ignore siblings from the same batch.
 */
export function isFailSuperseded(
  fail: AutoRetryImageLike,
  images: AutoRetryImageLike[],
  excludeIds?: Set<string>,
) {
  const prompt = normalizePrompt(fail.prompt)
  if (!prompt)
    return false
  const kind = fail.kind || 'still'
  return images.some(item =>
    item.id !== fail.id
    && !excludeIds?.has(item.id)
    && (item.status === 'success' || item.status === 'generating')
    && (item.kind || 'still') === kind
    && normalizePrompt(item.prompt) === prompt,
  )
}

/**
 * Server-side check: which of the referenced fails may still be auto-retried.
 * Missing `failedAt` means the fail predates this guard (or was restored from an
 * old snapshot) and is treated as old.
 */
export function eligibleAutoRetryFails(
  images: AutoRetryImageLike[],
  input: { ids: string[], text: string, now: number, maxAgeMs?: number },
) {
  const maxAge = input.maxAgeMs ?? AUTO_RETRY_MAX_FAIL_AGE_MS
  const text = String(input.text || '')
  const ids = new Set(input.ids)
  // Legacy clients (no id line) only name the failed prompts.
  const referenced = images.filter(item => item.status === 'fail' && (ids.size
    ? ids.has(item.id)
    : Boolean(item.prompt?.trim()) && text.includes(item.prompt!.trim())))
  // Supersession is judged on the client, which knows confirmation batches
  // (same-prompt variations in one batch are siblings, not replacements).
  return referenced.filter(item =>
    !item.autoRetryHandled
    && Boolean(item.failedAt)
    && input.now - Number(item.failedAt) <= maxAge,
  )
}
