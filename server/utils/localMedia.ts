import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'

// Runtime files live outside public/ so builds never copy or erase user media.
export function mediaRoot() {
  return resolve('.data/media')
}

let applicationUrl = 'http://localhost:3001'
export function configureMediaBase(url: string) { applicationUrl = url }
function mediaBase() {
  const base = new URL(applicationUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Media base must be an HTTP(S) application URL')
  return base.href.replace(/\/$/, '')
}

function mediaPath(key: string) {
  if (!key || key.includes('\\') || /\p{Cc}/u.test(key) || key.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))
    throw new Error('Invalid media path')
  const path = resolve(mediaRoot(), key)
  if (!path.startsWith(mediaRoot() + sep))
    throw new Error('Invalid media path')
  return path
}

export function storedMediaKey(source: string): string | null {
  const prefix = `${mediaBase()}/media/`
  if (!source.startsWith(prefix))
    return null
  try {
    const url = new URL(source)
    if (url.search || url.hash)
      return null
    const key = decodeURIComponent(source.slice(prefix.length))
    mediaPath(key)
    return key
  }
  catch {
    return null
  }
}

export function isStoredMediaUrl(source: string) {
  return storedMediaKey(source) !== null
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.zip': 'application/zip',
}

export async function storedMediaFile(key: string) {
  const path = mediaPath(key)
  const [root, actual] = await Promise.all([realpath(mediaRoot()), realpath(path)])
  if (!actual.startsWith(root + sep))
    throw new Error('Invalid media path')
  const info = await stat(actual)
  if (!info.isFile())
    throw new Error('Media file not found')
  return { path: actual, size: info.size, modified: info.mtime, mime: MIME[extname(key).toLowerCase()] || 'application/octet-stream' }
}

export async function saveMediaFile(key: string, body: Uint8Array, _contentType: string) {
  const path = mediaPath(key)
  const url = `${mediaBase()}/media/${key.split('/').map(encodeURIComponent).join('/')}`
  await mkdir(dirname(path), { recursive: true })
  const [root, parent] = await Promise.all([realpath(mediaRoot()), realpath(dirname(path))])
  if (parent !== root && !parent.startsWith(root + sep))
    throw new Error('Invalid media path')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, body, { flag: 'wx' })
    await rename(temporary, path)
  }
  finally {
    await rm(temporary, { force: true })
  }
  return url
}

export async function readStoredMedia(source: string, maxBytes: number, signal?: AbortSignal) {
  const key = storedMediaKey(source)
  if (key === null)
    return null
  signal?.throwIfAborted()
  const file = await storedMediaFile(key)
  if (!file.size || file.size > maxBytes)
    throw new Error('Media file is empty or exceeds the size limit')
  const bytes = await readFile(file.path, { signal })
  if (bytes.length > maxBytes)
    throw new Error('Media file exceeds the size limit')
  return { bytes, mime: file.mime }
}
