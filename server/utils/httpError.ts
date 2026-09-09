import { createError, isError } from 'h3'
import { isGenericErrorMessage, readErrorMessage } from '~~/shared/utils/apiError'

function looksInternal(message: string) {
  return /at\s+\S+\s+\(|SQLITE_ERROR|SQLITE_CONSTRAINT|ECONNREFUSED|ENOTFOUND|ECONNRESET|ENOENT|Cannot read propert/i.test(message)
}

function extraData(error: unknown) {
  if (!error || typeof error !== 'object' || !('data' in error))
    return undefined
  const data = (error as { data?: unknown }).data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : undefined
}

function publicStatusCode(statusCode?: number) {
  if (!statusCode || statusCode < 400)
    return 502
  if (statusCode === 500 || statusCode === 501)
    return 502
  return statusCode
}

function upstreamStatusCode(statusCode?: number) {
  if (statusCode === 401 || statusCode === 403)
    return 502
  if (statusCode && statusCode >= 400 && statusCode < 500)
    return statusCode
  return 502
}

export function publicApiError(statusCode: number, message: string, data?: Record<string, unknown>) {
  const statusMessage = message.trim() || 'Generation failed'
  return createError({
    statusCode: publicStatusCode(statusCode),
    statusMessage,
    message: statusMessage,
    data: {
      ...data,
      message: statusMessage,
    },
  })
}

export function toPublicApiError(error: unknown, fallback: string) {
  if (isError(error)) {
    const message = readErrorMessage(error, error.statusMessage || fallback)
    const nextMessage = isGenericErrorMessage(message) || looksInternal(message) ? fallback : message
    return publicApiError(error.statusCode, nextMessage, extraData(error))
  }

  const message = readErrorMessage(error, fallback)
  if (message !== fallback && !looksInternal(message))
    return publicApiError(502, message)

  console.error('[api error]', error)
  return publicApiError(502, fallback)
}

export function toUpstreamApiError(error: unknown, fallback: string) {
  const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
  return publicApiError(upstreamStatusCode(statusCode), readErrorMessage(error, fallback))
}
