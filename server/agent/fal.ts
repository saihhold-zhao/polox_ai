import { falReadableUrl } from '../utils/falFiles'
import { agentEnv } from './env'

const FAL_MODEL = 'fal-ai/ideogram/remove-background'
const FAL_SUBMIT_URL = `https://queue.fal.run/${FAL_MODEL}`
const POLL_MS = 1500
const TIMEOUT_MS = 4 * 60 * 1000

function requireFalKey() {
  const key = agentEnv.falApiKey
  if (!key) {
    throw new Error('Configure your fal API key using Service connection in the top-right corner.')
  }
  return key
}

function falHeaders() {
  return {
    'Authorization': `Key ${requireFalKey()}`,
    'Content-Type': 'application/json',
  }
}

function falAuthHeaders() {
  return {
    Authorization: `Key ${requireFalKey()}`,
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted)
    throw new Error('Generation aborted')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Generation aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function readJson(response: Response) {
  const text = await response.text()
  if (!text)
    return {} as Record<string, unknown>
  try {
    return JSON.parse(text) as Record<string, unknown>
  }
  catch {
    return { message: text } as Record<string, unknown>
  }
}

function falErrorMessage(payload: Record<string, unknown>, fallback: string) {
  if (typeof payload.detail === 'string' && payload.detail.trim())
    return payload.detail.trim()
  if (Array.isArray(payload.detail)) {
    const first = payload.detail[0]
    if (typeof first === 'string' && first.trim())
      return first.trim()
    if (first && typeof first === 'object' && typeof (first as { msg?: unknown }).msg === 'string') {
      const msg = String((first as { msg: string }).msg).trim()
      if (msg)
        return msg
    }
  }
  if (typeof payload.error === 'string' && payload.error.trim())
    return payload.error.trim()
  if (payload.error && typeof payload.error === 'object' && typeof (payload.error as { message?: unknown }).message === 'string') {
    const msg = String((payload.error as { message: string }).message).trim()
    if (msg)
      return msg
  }
  if (typeof payload.message === 'string' && payload.message.trim())
    return payload.message.trim()
  return fallback
}

function resultUrlFromFal(payload: Record<string, unknown>) {
  const image = payload.image
  if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    const url = String((image as { url: string }).url).trim()
    if (/^https?:\/\//i.test(url))
      return url
  }
  return ''
}

export async function removeBackground(imageUrl: string, signal?: AbortSignal, onCreated?: (requestId: string) => void | Promise<void>) {
  const createResponse = await fetch(FAL_SUBMIT_URL, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({ image_url: await falReadableUrl(imageUrl) }),
    signal,
  })
  const created = await readJson(createResponse)
  if (!createResponse.ok) {
    throw new Error(falErrorMessage(created, `Fal submit failed (${createResponse.status})`))
  }

  const requestId = String(created.request_id || '').trim()
  const statusUrl = String(created.status_url || '').trim()
  const responseUrl = String(created.response_url || '').trim()
  if (!requestId || !statusUrl || !responseUrl)
    throw new Error('Fal did not return a request id')

  if (onCreated) {
    try {
      await onCreated(requestId)
    }
    catch (error) {
      console.error('[fal] bind provider task', requestId, error)
    }
  }

  const started = Date.now()
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_MS)
    const statusResponse = await fetch(statusUrl, {
      headers: falAuthHeaders(),
    })
    const statusPayload = await readJson(statusResponse)
    if (!statusResponse.ok)
      throw new Error(falErrorMessage(statusPayload, `Fal status failed (${statusResponse.status})`))

    const next = String(statusPayload.status || '').toUpperCase()
    if (next === 'FAILED' || next === 'CANCELED')
      throw new Error(falErrorMessage(statusPayload, next === 'CANCELED' ? 'Background removal was canceled' : 'Background removal failed'))

    if (next !== 'COMPLETED')
      continue

    const resultResponse = await fetch(responseUrl, {
      headers: falAuthHeaders(),
    })
    const result = await readJson(resultResponse)
    if (!resultResponse.ok)
      throw new Error(falErrorMessage(result, `Fal result failed (${resultResponse.status})`))

    const url = resultUrlFromFal(result)
    if (!url)
      throw new Error('Fal returned no cutout image')
    return { requestId, urls: [url] }
  }

  throw new Error('Background removal timed out')
}
