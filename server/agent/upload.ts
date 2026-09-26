import { audioMimeNeedsMp3Convert, convertAudioBytesToMp3 } from '../utils/convertAudioToMp3'
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

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
}

const VIDEO_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
}

const DOCUMENT_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
}

const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const AUDIO_MAX_BYTES = 15 * 1024 * 1024
const VIDEO_MAX_BYTES = 200 * 1024 * 1024
/** 40 MB per document (PDF / Office / CSV). */
const DOCUMENT_MAX_BYTES = 40 * 1024 * 1024

export type AgentMediaKind = 'image' | 'audio' | 'video' | 'document'

export function agentMediaKindForMime(mime: string): AgentMediaKind | null {
  const normalized = String(mime || '').toLowerCase().split(';')[0]!.trim()
  if (IMAGE_EXTENSIONS[normalized])
    return 'image'
  if (AUDIO_EXTENSIONS[normalized])
    return 'audio'
  if (VIDEO_EXTENSIONS[normalized])
    return 'video'
  if (DOCUMENT_EXTENSIONS[normalized])
    return 'document'
  return null
}

function extensionForKind(kind: AgentMediaKind, mime: string) {
  const normalized = String(mime || '').toLowerCase().split(';')[0]!.trim()
  if (kind === 'image')
    return IMAGE_EXTENSIONS[normalized]
  if (kind === 'audio')
    return AUDIO_EXTENSIONS[normalized]
  if (kind === 'video')
    return VIDEO_EXTENSIONS[normalized]
  return DOCUMENT_EXTENSIONS[normalized]
}

function maxBytesForKind(kind: AgentMediaKind) {
  if (kind === 'image')
    return IMAGE_MAX_BYTES
  if (kind === 'audio')
    return AUDIO_MAX_BYTES
  if (kind === 'video')
    return VIDEO_MAX_BYTES
  return DOCUMENT_MAX_BYTES
}

function sizeErrorForKind(kind: AgentMediaKind) {
  if (kind === 'image')
    return 'Each image must be between 1 byte and 10MB'
  if (kind === 'audio')
    return 'Each audio file must be between 1 byte and 15MB'
  if (kind === 'video')
    return 'Each video must be between 1 byte and 200MB'
  return 'Each document must be between 1 byte and 40MB'
}

export async function uploadAgentMedia(sessionId: string, file: { bytes: Uint8Array, mime: string }) {
  const kind = agentMediaKindForMime(file.mime)
  if (!kind)
    throw new Error('This media type is not supported')
  let extension = extensionForKind(kind, file.mime)
  const maxBytes = maxBytesForKind(kind)
  if (!file.bytes.byteLength || file.bytes.byteLength > maxBytes)
    throw new Error(sizeErrorForKind(kind))
  if (!sessionId)
    throw new Error('A session is required')
  let contentType = String(file.mime || '').toLowerCase().split(';')[0]!.trim() || file.mime
  let bytes = file.bytes
  // Browser MediaRecorder usually sends audio/webm; video reference audio needs mp3/wav/m4a/aac/ogg.
  if (kind === 'audio' && audioMimeNeedsMp3Convert(contentType)) {
    const converted = await convertAudioBytesToMp3(bytes, contentType)
    bytes = converted.bytes
    contentType = converted.mime
    extension = 'mp3'
  }
  const key = `agent-lab/${encodeURIComponent(sessionId)}/${crypto.randomUUID()}.${extension}`
  const url = await saveMediaFile(key, bytes, contentType)
  return { url, kind, contentType, extension }
}

/** @deprecated Prefer uploadAgentMedia — kept for image-only callers. */
export async function uploadAgentImage(sessionId: string, file: { bytes: Uint8Array, mime: string }) {
  const result = await uploadAgentMedia(sessionId, file)
  if (result.kind !== 'image')
    throw new Error('This image type is not supported')
  return result.url
}
