const GENERIC_ERROR_MESSAGES = new Set([
  'bad gateway',
  'error',
  'failed to fetch',
  'false',
  'fetcherror',
  'gateway timeout',
  'internal server error',
  'network error',
  'server error',
  'service unavailable',
  'true',
])

export function isGenericErrorMessage(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.!]+$/, '')
  if (!normalized)
    return true
  if (GENERIC_ERROR_MESSAGES.has(normalized))
    return true
  if (/^\[(?:GET|POST|PUT|PATCH|DELETE)\]\s+"/i.test(value)) {
    const extracted = value.replace(/^.*?:\s*\d{3}\s*/, '').trim()
    return !extracted || isGenericErrorMessage(extracted)
  }
  return false
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringifyDetail(value: unknown, depth = 0): string {
  if (depth > 4 || value == null)
    return ''
  if (typeof value === 'string') {
    const text = value.trim()
    return text && !isGenericErrorMessage(text) ? text : ''
  }
  if (typeof value === 'number')
    return String(value)
  if (Array.isArray(value)) {
    return value
      .map(item => stringifyDetail(item, depth + 1))
      .filter(Boolean)
      .join('; ')
  }

  const record = asRecord(value)
  if (!record)
    return ''

  const locParts = Array.isArray(record.loc)
    ? record.loc.filter((part): part is string | number => {
        return (typeof part === 'string' && part !== 'body') || typeof part === 'number'
      })
    : []
  const loc = locParts.join('.')
  const nested = [record.msg, record.message, record.error, record.detail, record.reason]
    .map(item => stringifyDetail(item, depth + 1))
    .find(Boolean) || ''
  const typed = !nested && typeof record.type === 'string' && record.type !== 'error'
    ? record.type
    : nested

  if (typed && loc)
    return `${loc}: ${typed}`
  return typed
}

function unwrapOfetchMessage(value: string) {
  const prefix = value.match(/^\[(?:GET|POST|PUT|PATCH|DELETE)\] "[^"]+": \d{3} /i)
  if (!prefix)
    return value.trim()
  return value.slice(prefix[0].length).trim() || value.trim()
}

function pushCandidate(candidates: string[], value: unknown) {
  if (typeof value === 'string') {
    const text = unwrapOfetchMessage(value)
    if (text && !isGenericErrorMessage(text))
      candidates.push(text)
    return
  }
  const text = stringifyDetail(value)
  if (text && !isGenericErrorMessage(text))
    candidates.push(text)
}

export function readErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') {
    const text = unwrapOfetchMessage(error)
    return text && !isGenericErrorMessage(text) ? text : fallback
  }
  if (!error || typeof error !== 'object')
    return fallback

  const record = error as Record<string, unknown>
  const data = asRecord(record.data)
  const nested = asRecord(data?.data)
  const candidates: string[] = []

  pushCandidate(candidates, nested?.message)
  pushCandidate(candidates, nested?.statusMessage)
  pushCandidate(candidates, nested?.msg)
  pushCandidate(candidates, nested?.detail)
  pushCandidate(candidates, nested?.error)
  pushCandidate(candidates, data?.msg)
  pushCandidate(candidates, data?.detail)
  pushCandidate(candidates, data?.error)
  pushCandidate(candidates, data?.message)
  pushCandidate(candidates, record.msg)
  pushCandidate(candidates, record.detail)
  pushCandidate(candidates, record.error)
  pushCandidate(candidates, data?.statusMessage)
  pushCandidate(candidates, record.statusMessage)
  pushCandidate(candidates, record.message)

  if (candidates[0])
    return candidates[0]

  if (error instanceof Error) {
    const text = unwrapOfetchMessage(error.message)
    if (text && !isGenericErrorMessage(text))
      return text
  }

  return fallback
}
