import { readServiceSettings } from './serviceSettings'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { createFalClient } from '@fal-ai/client'
import { readStoredMedia } from './localMedia'

function storage() {
  const key = readServiceSettings().falKey
  if (!key)
    throw createError({ statusCode: 503, statusMessage: 'Fal API key is not configured' })
  return createFalClient({ credentials: key }).storage
}
export async function uploadFalFile(bytes: Uint8Array, mime: string, fileName = 'upload.bin') {
  const file = new File([new Uint8Array(bytes)], basename(fileName), { type: mime || 'application/octet-stream' })
  return storage().upload(file)
}
const uploads = new Map<string, { time: number, pending: Promise<string> }>()
export async function falReadableUrl(url: string) {
  const local = await readStoredMedia(url, 200 * 1024 * 1024)
  if (!local)
    return url
  const hash = createHash('sha256').update(local.bytes).digest('hex')
  const cached = uploads.get(hash)
  if (cached && Date.now() - cached.time < 60 * 60 * 1000)
    return cached.pending
  const pending = uploadFalFile(local.bytes, local.mime, new URL(url).pathname.split('/').pop()).catch((error) => {
    uploads.delete(hash)
    throw error
  })
  uploads.set(hash, { time: Date.now(), pending })
  if (uploads.size > 100)
    uploads.delete(uploads.keys().next().value!)
  return pending
}
export async function prepareFalFiles(input: Record<string, unknown>) {
  const output = { ...input }
  for (const [key, value] of Object.entries(input)) {
    if (!key.endsWith('_url') && !key.endsWith('_urls'))
      continue
    if (typeof value === 'string')
      output[key] = await falReadableUrl(value)
    else if (Array.isArray(value))
      output[key] = await Promise.all(value.map(url => typeof url === 'string' ? falReadableUrl(url) : url))
  }
  return output
}
