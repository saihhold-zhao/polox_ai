import {
  DOCUMENT_PAGE_IMAGE_SCALE,
  DOCUMENT_PDF_PAGES_HARD_MAX,
  DOCUMENT_PDF_PAGES_PER_CALL,
} from './limits'
import { capText } from './textCap'

async function loadPdf(bytes: Uint8Array) {
  const unpdf = await import('unpdf')
  try {
    // Copy buffer — pdf.js may transfer/detach the original ArrayBuffer.
    const copy = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.slice()
      : Uint8Array.from(bytes)
    const proxy = await unpdf.getDocumentProxy(copy)
    return { unpdf, proxy }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password|encrypted/i.test(message))
      throw new Error('This PDF is password-protected. Export an unlocked copy and re-upload.')
    throw new Error(`Could not open PDF: ${message}`)
  }
}

export async function pdfMeta(bytes: Uint8Array) {
  const { unpdf, proxy } = await loadPdf(bytes)
  const meta = await unpdf.getMeta(proxy)
  const sample = await unpdf.extractText(proxy, { mergePages: false })
  const pages = Array.isArray(sample.text) ? sample.text : [String(sample.text || '')]
  const hasText = pages.some(page => String(page || '').trim().length > 0)
  const info = (meta as { info?: Record<string, unknown> })?.info || {}
  return {
    format: 'pdf' as const,
    pageCount: Number(proxy.numPages) || pages.length || 0,
    title: String(info.Title || info.title || '').trim(),
    hasText,
  }
}

export async function pdfText(bytes: Uint8Array, pageFrom = 1, pageTo?: number) {
  const { unpdf, proxy } = await loadPdf(bytes)
  const total = Number(proxy.numPages) || 0
  const from = Math.max(1, Math.floor(pageFrom || 1))
  const requestedTo = pageTo == null ? from + DOCUMENT_PDF_PAGES_PER_CALL - 1 : Math.floor(pageTo)
  const to = Math.min(total, from + DOCUMENT_PDF_PAGES_HARD_MAX - 1, Math.max(from, requestedTo))
  if (from > total)
    throw new Error(`pageFrom ${from} is past the end of the PDF (${total} pages)`)
  const extracted = await unpdf.extractText(proxy, { mergePages: false })
  const pages = Array.isArray(extracted.text)
    ? extracted.text.map((item: unknown) => String(item || ''))
    : [String(extracted.text || '')]
  const slice = pages.slice(from - 1, to).map((text: string, index: number) => ({
    page: from + index,
    text,
  }))
  const joined = slice.map(item => `--- page ${item.page} ---\n${item.text}`).join('\n\n')
  const capped = capText(joined)
  return {
    format: 'pdf' as const,
    pageFrom: from,
    pageTo: to,
    pageCount: total,
    pages: slice,
    text: capped.text,
    truncated: capped.truncated,
    nextHint: capped.truncated
      ? capped.nextHint
      : (to < total ? `More pages remain. Call again with pageFrom=${to + 1}.` : ''),
  }
}

export async function pdfSearch(bytes: Uint8Array, query: string, maxHits: number) {
  const { unpdf, proxy } = await loadPdf(bytes)
  const extracted = await unpdf.extractText(proxy, { mergePages: false })
  const pages = Array.isArray(extracted.text)
    ? extracted.text.map((item: unknown) => String(item || ''))
    : [String(extracted.text || '')]
  const needle = query.trim().toLowerCase()
  if (!needle)
    throw new Error('query is required')
  const hits: Array<{ page: number, snippet: string }> = []
  for (let index = 0; index < pages.length; index++) {
    const pageText = pages[index] || ''
    const lower = pageText.toLowerCase()
    let from = 0
    while (hits.length < maxHits) {
      const at = lower.indexOf(needle, from)
      if (at < 0)
        break
      hits.push({
        page: index + 1,
        snippet: pageText.slice(Math.max(0, at - 80), Math.min(pageText.length, at + needle.length + 140)).replace(/\s+/g, ' ').trim(),
      })
      from = at + needle.length
    }
    if (hits.length >= maxHits)
      break
  }
  return { format: 'pdf' as const, query, hits, hitCount: hits.length, pageCount: pages.length }
}

export async function pdfPageImage(bytes: Uint8Array, page = 1, scale = DOCUMENT_PAGE_IMAGE_SCALE) {
  const { unpdf, proxy } = await loadPdf(bytes)
  const total = Number(proxy.numPages) || 0
  const pageNumber = Math.max(1, Math.floor(page || 1))
  if (pageNumber > total)
    throw new Error(`page ${pageNumber} is past the end of the PDF (${total} pages)`)
  const clampedScale = Math.min(2, Math.max(0.75, Number(scale) || DOCUMENT_PAGE_IMAGE_SCALE))
  const image = await unpdf.renderPageAsImage(proxy, pageNumber, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale: clampedScale,
  })
  const raw: unknown = image
  const buffer = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer)
  return {
    format: 'pdf' as const,
    page: pageNumber,
    pageCount: total,
    mime: 'image/png',
    bytes: buffer,
    scale: clampedScale,
  }
}

export async function pdfEmbeddedImages(bytes: Uint8Array, maxImages: number) {
  const { unpdf, proxy } = await loadPdf(bytes)
  try {
    // unpdf extracts per page; walk pages until the cap.
    const total = Number(proxy.numPages) || 0
    const list: Array<{ page: number, width: number, height: number }> = []
    for (let page = 1; page <= total && list.length < maxImages; page++) {
      const found = await unpdf.extractImages(proxy, page)
      for (const item of Array.isArray(found) ? found : []) {
        if (list.length >= maxImages)
          break
        list.push({ page, width: Number(item.width) || 0, height: Number(item.height) || 0 })
      }
    }
    return {
      format: 'pdf' as const,
      images: list.map((item, index) => ({
        index,
        page: item.page,
        width: item.width,
        height: item.height,
        note: 'Embedded image entry. Prefer document_page_image for readable page screenshots.',
      })),
      count: list.length,
    }
  }
  catch {
    return { format: 'pdf' as const, images: [], count: 0, note: 'No embedded images could be listed for this PDF.' }
  }
}
