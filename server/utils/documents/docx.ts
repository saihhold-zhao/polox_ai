import {
  DOCUMENT_WORD_CHUNK_CHARS,
  DOCUMENT_WORD_CHUNKS_PER_CALL,
} from './limits'
import { capText } from './textCap'

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  emf: 'image/emf',
  wmf: 'image/wmf',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

function mimeFromName(name: string) {
  const ext = String(name || '').split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT_MIME[ext] || ''
}

/** Prefer paragraph boundaries when building ~chunkSize character windows. */
export function chunkDocxParagraphs(paragraphs: string[], chunkSize = DOCUMENT_WORD_CHUNK_CHARS) {
  const size = Math.max(500, Math.floor(chunkSize || DOCUMENT_WORD_CHUNK_CHARS))
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current) {
      chunks.push(current)
      current = ''
    }
  }

  const pushPiece = (piece: string) => {
    if (!piece)
      return
    if (piece.length <= size) {
      const next = current ? `${current}\n\n${piece}` : piece
      if (current && next.length > size) {
        flush()
        current = piece
      }
      else {
        current = next
      }
      return
    }
    // Oversized single paragraph: hard-split.
    flush()
    for (let offset = 0; offset < piece.length; offset += size)
      chunks.push(piece.slice(offset, offset + size))
  }

  for (const paragraph of paragraphs)
    pushPiece(paragraph)
  flush()
  if (!chunks.length)
    chunks.push('')
  return chunks
}

export async function docxRawText(bytes: Uint8Array) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return String(result.value || '')
}

export async function docxParagraphs(bytes: Uint8Array) {
  const text = await docxRawText(bytes)
  const paragraphs = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  return { text, paragraphs }
}

export async function docxMeta(bytes: Uint8Array, fileName = '') {
  const { text, paragraphs } = await docxParagraphs(bytes)
  const chunks = chunkDocxParagraphs(paragraphs, DOCUMENT_WORD_CHUNK_CHARS)
  return {
    format: 'docx' as const,
    title: fileName.replace(/\.docx$/i, '') || '',
    characters: text.length,
    paragraphCount: paragraphs.length,
    chunkCount: chunks.length,
    chunkChars: DOCUMENT_WORD_CHUNK_CHARS,
    hasText: text.trim().length > 0,
  }
}

export async function docxText(bytes: Uint8Array, chunkFrom = 1, chunkTo?: number) {
  const { paragraphs } = await docxParagraphs(bytes)
  const allChunks = chunkDocxParagraphs(paragraphs, DOCUMENT_WORD_CHUNK_CHARS)
  const totalChunks = allChunks.length
  const from = Math.max(1, Math.floor(chunkFrom || 1))
  const requestedTo = chunkTo == null ? from + DOCUMENT_WORD_CHUNKS_PER_CALL - 1 : Math.floor(chunkTo)
  const to = Math.min(totalChunks, Math.max(from, requestedTo), from + DOCUMENT_WORD_CHUNKS_PER_CALL - 1)
  if (from > totalChunks)
    throw new Error(`chunkFrom ${from} is past the end (${totalChunks} chunks)`)
  const parts = []
  for (let chunk = from; chunk <= to; chunk++) {
    parts.push({ chunk, text: allChunks[chunk - 1] || '' })
  }
  const joined = parts.map(item => `--- chunk ${item.chunk}/${totalChunks} ---\n${item.text}`).join('\n\n')
  const capped = capText(joined)
  return {
    format: 'docx' as const,
    chunkFrom: from,
    chunkTo: to,
    chunkCount: totalChunks,
    paragraphCount: paragraphs.length,
    chunks: parts,
    text: capped.text,
    truncated: capped.truncated,
    nextHint: capped.truncated
      ? capped.nextHint
      : (to < totalChunks ? `More chunks remain. Call again with chunkFrom=${to + 1}.` : ''),
  }
}

export async function docxSearch(bytes: Uint8Array, query: string, maxHits: number) {
  const { paragraphs } = await docxParagraphs(bytes)
  const allChunks = chunkDocxParagraphs(paragraphs, DOCUMENT_WORD_CHUNK_CHARS)
  const needle = query.trim().toLowerCase()
  if (!needle)
    throw new Error('query is required')
  const hits: Array<{ chunk: number, snippet: string }> = []
  for (let index = 0; index < allChunks.length; index++) {
    const text = allChunks[index] || ''
    const lower = text.toLowerCase()
    let from = 0
    while (hits.length < maxHits) {
      const at = lower.indexOf(needle, from)
      if (at < 0)
        break
      hits.push({
        chunk: index + 1,
        snippet: text.slice(Math.max(0, at - 80), Math.min(text.length, at + needle.length + 140)).replace(/\s+/g, ' ').trim(),
      })
      from = at + needle.length
    }
    if (hits.length >= maxHits)
      break
  }
  return { format: 'docx' as const, query, hits, hitCount: hits.length, chunkCount: allChunks.length }
}

export type DocxEmbeddedImage = {
  index: number
  name: string
  path: string
  mime: string
  bytes: Uint8Array
  byteLength: number
}

export async function docxEmbeddedImages(bytes: Uint8Array, maxImages: number): Promise<DocxEmbeddedImage[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const mediaNames = Object.keys(zip.files)
    .filter(name => /^word\/media\//i.test(name) && !zip.files[name]!.dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const images: DocxEmbeddedImage[] = []
  for (const path of mediaNames) {
    if (images.length >= maxImages)
      break
    const name = path.split('/').pop() || path
    const mime = mimeFromName(name)
    if (!mime || mime === 'image/emf' || mime === 'image/wmf')
      continue
    const data = await zip.files[path]!.async('uint8array')
    if (!data.byteLength)
      continue
    images.push({
      index: images.length,
      name,
      path,
      mime,
      bytes: data,
      byteLength: data.byteLength,
    })
  }
  return images
}
