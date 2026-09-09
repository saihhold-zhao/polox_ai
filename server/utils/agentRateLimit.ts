const WINDOW_MS = 60000
const MAX_HITS = { read: 240, write: 40 }
const hits = new Map<string, number[]>()
export function assertAgentRateLimit(method = 'POST') {
  const bucket = /^(?:GET|HEAD)$/i.test(method) ? 'read' : 'write'
  const key = bucket
  const now = Date.now()
  const recent = (hits.get(key) || []).filter(time => now - time < WINDOW_MS)
  if (recent.length >= MAX_HITS[bucket]) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many Agent Lab requests. Wait a moment and try again.',
    })
  }
  recent.push(now)
  hits.set(key, recent)
}
const inflightTurns = new Set<string>()
export function beginAgentTurn(sessionKey?: string) {
  const key = String(sessionKey || '').trim() || crypto.randomUUID()
  if (inflightTurns.has(key)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This Agent Lab session is already running',
    })
  }
  inflightTurns.add(key)
  return () => {
    inflightTurns.delete(key)
  }
}
const idempotency = new Map<string, {
  at: number
  status: 'inflight' | 'done'
}>()
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000
export function beginAgentIdempotency(key: string | undefined) {
  const id = String(key || '').trim().slice(0, 80)
  if (!id) {
    return {
      finish() { },
      release() { },
    }
  }
  const mapKey = id
  const now = Date.now()
  for (const [storedKey, value] of idempotency) {
    if (now - value.at > IDEMPOTENCY_TTL_MS)
      idempotency.delete(storedKey)
  }
  const existing = idempotency.get(mapKey)
  if (existing && now - existing.at < IDEMPOTENCY_TTL_MS) {
    throw createError({
      statusCode: 409,
      statusMessage: existing.status === 'inflight'
        ? 'This request is already in progress'
        : 'This request was already processed',
    })
  }
  idempotency.set(mapKey, { at: now, status: 'inflight' })
  return {
    finish() {
      idempotency.set(mapKey, { at: Date.now(), status: 'done' })
    },
    release() {
      idempotency.delete(mapKey)
    },
  }
}
