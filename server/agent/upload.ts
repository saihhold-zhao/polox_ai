import { uploadFalFile } from '../utils/falFiles'
import { saveMediaFile } from '../utils/localMedia'

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
}
export async function uploadAgentImage(sessionId: string, file: {
  bytes: Uint8Array
  mime: string
}) {
  const extension = IMAGE_EXTENSIONS[file.mime]
  if (!extension)
    throw new Error('This image type is not supported')
  if (!file.bytes.byteLength || file.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error('Each image must be between 1 byte and 10MB')
  if (!sessionId)
    throw new Error('A session is required')
  const key = `agent-lab/${encodeURIComponent(sessionId)}/${crypto.randomUUID()}.${extension}`
  await saveMediaFile(key, file.bytes, file.mime)
  return uploadFalFile(file.bytes, file.mime, `upload.${extension}`)
}
