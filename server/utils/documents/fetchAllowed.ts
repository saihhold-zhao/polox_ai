import type { AgentImage } from '../../agent/types'
import { readStoredMedia } from '../localMedia'
import { DOCUMENT_MAX_BYTES } from './limits'

/** Only documents uploaded to this session's local media store are readable (no arbitrary fetches). */
export function assertAgentDocumentUrl(url: string, images: AgentImage[]) {
  const value = String(url || '').trim()
  if (!/^https?:\/\//i.test(value) || value.toLowerCase().startsWith('blob:'))
    throw new Error('document url must be a media URL from this session')
  const asset = images.find(item => item.url === value && item.status === 'success')
  if (!asset)
    throw new Error('document url is not an attachment in this session')
  if (asset.kind && asset.kind !== 'document')
    throw new Error('That URL is not a document attachment. Use document tools only on uploaded documents.')
  return asset
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
}

export async function fetchAllowedDocumentBytes(url: string, images: AgentImage[], signal?: AbortSignal) {
  const asset = assertAgentDocumentUrl(url, images)
  const local = await readStoredMedia(url, DOCUMENT_MAX_BYTES, signal)
  if (!local)
    throw new Error('document url is not stored in the local media library')
  const bytes = new Uint8Array(local.bytes)
  if (!bytes.byteLength)
    throw new Error('Document is empty')
  const fileName = asset?.name || url.split('?')[0]!.split('/').pop() || 'document'
  const extension = (url.split('?')[0]!.split('.').pop() || '').toLowerCase()
  const mime = local.mime && local.mime !== 'application/octet-stream' ? local.mime : (MIME_BY_EXTENSION[extension] || '')
  return { bytes, mime, asset, fileName }
}
