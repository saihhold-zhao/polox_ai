import type { AgentImage } from '../../agent/types'
import {
  documentFormatForMimeOrName,
  isLegacyOfficeFormat,
  legacyOfficeMessage,
  type DocumentFormat,
} from './detect'
import { fetchAllowedDocumentBytes } from './fetchAllowed'
import { DOCUMENT_EMBEDDED_IMAGES_MAX, DOCUMENT_SEARCH_MAX_HITS } from './limits'
import * as docx from './docx'
import * as pdf from './pdf'
import * as pptx from './pptx'
import * as xlsx from './xlsx'

export * from './detect'
export * from './limits'

function resolveFormat(mime: string, fileName: string): DocumentFormat {
  const format = documentFormatForMimeOrName(mime, fileName)
  if (!format)
    throw new Error(`Unsupported document type (${mime || 'unknown'} / ${fileName || 'file'})`)
  if (isLegacyOfficeFormat(format))
    throw new Error(legacyOfficeMessage(format))
  return format
}

export async function loadDocumentSource(url: string, images: AgentImage[], signal?: AbortSignal) {
  const downloaded = await fetchAllowedDocumentBytes(url, images, signal)
  const format = resolveFormat(downloaded.mime, downloaded.fileName)
  return { ...downloaded, format }
}

export async function runDocumentMeta(url: string, images: AgentImage[], signal?: AbortSignal) {
  const source = await loadDocumentSource(url, images, signal)
  if (source.format === 'pdf')
    return { ok: true as const, url, mime: source.mime, size: source.bytes.byteLength, ...(await pdf.pdfMeta(source.bytes)) }
  if (source.format === 'docx')
    return { ok: true as const, url, mime: source.mime, size: source.bytes.byteLength, ...(await docx.docxMeta(source.bytes, source.fileName)) }
  if (source.format === 'pptx')
    return { ok: true as const, url, mime: source.mime, size: source.bytes.byteLength, ...(await pptx.pptxMeta(source.bytes, source.fileName)) }
  if (source.format === 'xlsx')
    return { ok: true as const, url, mime: source.mime, size: source.bytes.byteLength, ...(await xlsx.xlsxMeta(source.bytes, source.fileName)) }
  return { ok: true as const, url, mime: source.mime, size: source.bytes.byteLength, ...(await xlsx.csvMeta(source.bytes, source.fileName)) }
}

export async function runDocumentText(
  url: string,
  images: AgentImage[],
  args: {
    pageFrom?: number
    pageTo?: number
    chunkFrom?: number
    chunkTo?: number
    slideFrom?: number
    slideTo?: number
    sheet?: string
    rowFrom?: number
    rowTo?: number
  },
  signal?: AbortSignal,
) {
  const source = await loadDocumentSource(url, images, signal)
  if (source.format === 'pdf')
    return { ok: true as const, url, ...(await pdf.pdfText(source.bytes, args.pageFrom, args.pageTo)) }
  if (source.format === 'docx')
    return { ok: true as const, url, ...(await docx.docxText(source.bytes, args.chunkFrom, args.chunkTo)) }
  if (source.format === 'pptx')
    return { ok: true as const, url, ...(await pptx.pptxText(source.bytes, args.slideFrom, args.slideTo)) }
  if (source.format === 'xlsx')
    return { ok: true as const, url, ...(await xlsx.xlsxText(source.bytes, args.sheet, args.rowFrom, args.rowTo)) }
  return { ok: true as const, url, ...(await xlsx.csvText(source.bytes, args.rowFrom, args.rowTo)) }
}

export async function runDocumentSearch(
  url: string,
  images: AgentImage[],
  query: string,
  maxHits = DOCUMENT_SEARCH_MAX_HITS,
  signal?: AbortSignal,
) {
  const source = await loadDocumentSource(url, images, signal)
  const limit = Math.min(DOCUMENT_SEARCH_MAX_HITS, Math.max(1, Math.floor(maxHits || DOCUMENT_SEARCH_MAX_HITS)))
  if (source.format === 'pdf')
    return { ok: true as const, url, ...(await pdf.pdfSearch(source.bytes, query, limit)) }
  if (source.format === 'docx')
    return { ok: true as const, url, ...(await docx.docxSearch(source.bytes, query, limit)) }
  if (source.format === 'pptx')
    return { ok: true as const, url, ...(await pptx.pptxSearch(source.bytes, query, limit)) }
  if (source.format === 'xlsx')
    return { ok: true as const, url, ...(await xlsx.xlsxSearch(source.bytes, query, limit)) }
  return { ok: true as const, url, ...(await xlsx.csvSearch(source.bytes, query, limit)) }
}

async function uploadDocImage(
  sessionId: string,
  bytes: Uint8Array,
  mime: string,
  folder: string,
) {
  const { saveMediaFile } = await import('../localMedia')
  const ext = mime.includes('png')
    ? 'png'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('gif')
        ? 'gif'
        : 'jpg'
  const key = `agent-lab/${encodeURIComponent(sessionId)}/${folder}/${crypto.randomUUID()}.${ext}`
  return saveMediaFile(key, bytes, mime)
}

export async function runDocumentPageImage(
  url: string,
  images: AgentImage[],
  page: number,
  sessionId: string,
  signal?: AbortSignal,
) {
  const source = await loadDocumentSource(url, images, signal)
  signal?.throwIfAborted?.()

  if (source.format === 'pptx') {
    const rendered = await pptx.pptxSlideImage(source.bytes, page)
    const imageUrl = await uploadDocImage(sessionId, rendered.bytes, rendered.mime, 'doc-pages')
    const embeddedImageUrls: Array<{ name: string, mime: string, imageUrl: string }> = []
    for (const item of rendered.embeddedImages.slice(0, 4)) {
      signal?.throwIfAborted?.()
      try {
        const embeddedUrl = await uploadDocImage(sessionId, item.bytes, item.mime, 'doc-embedded')
        embeddedImageUrls.push({ name: item.name, mime: item.mime, imageUrl: embeddedUrl })
      }
      catch {
        // Best-effort: preview URL is enough if an embedded upload fails.
      }
    }
    return {
      ok: true as const,
      url,
      format: 'pptx' as const,
      page: rendered.page,
      slide: rendered.slide,
      pageCount: rendered.pageCount,
      slideCount: rendered.slideCount,
      mime: rendered.mime,
      scale: rendered.scale,
      imageUrl,
      mode: rendered.mode,
      slideText: rendered.slideText,
      embeddedImages: embeddedImageUrls,
      note: rendered.note,
    }
  }

  if (source.format !== 'pdf')
    throw new Error('document_page_image supports PDF pages and PPTX slides (use page= or slide=). DOCX has no page raster — use document_text / document_images.')

  const rendered = await pdf.pdfPageImage(source.bytes, page)
  const imageUrl = await uploadDocImage(sessionId, rendered.bytes, rendered.mime, 'doc-pages')
  return {
    ok: true as const,
    url,
    format: 'pdf' as const,
    page: rendered.page,
    pageCount: rendered.pageCount,
    mime: rendered.mime,
    scale: rendered.scale,
    imageUrl,
  }
}

export async function runDocumentImages(
  url: string,
  images: AgentImage[],
  maxImages = DOCUMENT_EMBEDDED_IMAGES_MAX,
  sessionId?: string,
  signal?: AbortSignal,
) {
  const source = await loadDocumentSource(url, images, signal)
  const limit = Math.min(DOCUMENT_EMBEDDED_IMAGES_MAX, Math.max(1, Math.floor(maxImages || DOCUMENT_EMBEDDED_IMAGES_MAX)))

  if (source.format === 'pdf')
    return { ok: true as const, url, ...(await pdf.pdfEmbeddedImages(source.bytes, limit)) }

  if (source.format === 'docx' || source.format === 'pptx') {
    const extracted = source.format === 'docx'
      ? await docx.docxEmbeddedImages(source.bytes, limit)
      : await pptx.pptxEmbeddedImages(source.bytes, limit)

    if (!sessionId) {
      return {
        ok: true as const,
        url,
        format: source.format,
        images: extracted.map(item => ({
          index: item.index,
          name: item.name,
          mime: item.mime,
          byteLength: item.byteLength,
          ...('slides' in item ? { slides: (item as { slides: number[] }).slides } : {}),
          note: 'Bytes extracted but not uploaded (missing session upload context).',
        })),
        count: extracted.length,
        note: extracted.length
          ? 'Embedded images found. Re-run from the agent session to save local image URLs.'
          : 'No raster embedded images found in this file.',
      }
    }

    const uploaded: Array<Record<string, unknown>> = []
    for (const item of extracted) {
      signal?.throwIfAborted?.()
      const imageUrl = await uploadDocImage(sessionId, item.bytes, item.mime, 'doc-embedded')
      uploaded.push({
        index: item.index,
        name: item.name,
        mime: item.mime,
        byteLength: item.byteLength,
        imageUrl,
        ...('slides' in item ? { slides: (item as { slides: number[] }).slides } : {}),
      })
    }
    return {
      ok: true as const,
      url,
      format: source.format,
      images: uploaded,
      count: uploaded.length,
      note: uploaded.length
        ? 'Embedded images saved to local media.'
        : 'No raster embedded images found in this file.',
    }
  }

  return {
    ok: true as const,
    url,
    format: source.format,
    images: [],
    count: 0,
    note: 'Embedded image extraction supports PDF (listing), DOCX, and PPTX.',
  }
}
