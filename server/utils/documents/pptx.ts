import { DOCUMENT_PPT_SLIDES_PER_CALL } from './limits'
import { capText } from './textCap'

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function mimeFromName(name: string) {
  const ext = String(name || '').split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT_MIME[ext] || ''
}

function resolveZipPath(baseDir: string, target: string) {
  const joined = `${baseDir}/${target}`.replace(/\\/g, '/')
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.')
      continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export type PptxSlide = {
  slide: number
  text: string
  imagePaths: string[]
}

async function loadPptxSlides(bytes: Uint8Array): Promise<{ zip: import('jszip'), slides: PptxSlide[] }> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0)
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0)
      return na - nb
    })
  const slides: PptxSlide[] = []
  for (const name of slideFiles) {
    const slideNum = Number(name.match(/slide(\d+)/i)?.[1] || slides.length + 1)
    const xml = await zip.files[name]!.async('text')
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1] || ''))
    const text = texts.join(' ').replace(/\s+/g, ' ').trim()
    const imagePaths: string[] = []
    const relsName = `ppt/slides/_rels/slide${slideNum}.xml.rels`
    const relsFile = zip.files[relsName]
    if (relsFile) {
      const relsXml = await relsFile.async('text')
      const relationships = [...relsXml.matchAll(/<Relationship\b[^>]*>/g)]
      for (const match of relationships) {
        const tag = match[0] || ''
        const type = tag.match(/\bType="([^"]+)"/)?.[1] || ''
        const target = tag.match(/\bTarget="([^"]+)"/)?.[1] || ''
        if (!/image/i.test(type) || !target || /^https?:\/\//i.test(target) || target.startsWith('/'))
          continue
        const path = resolveZipPath('ppt/slides', target)
        if (zip.files[path] && !imagePaths.includes(path))
          imagePaths.push(path)
      }
    }
    slides.push({ slide: slideNum, text, imagePaths })
  }
  return { zip, slides }
}

export async function pptxMeta(bytes: Uint8Array, fileName = '') {
  const { slides } = await loadPptxSlides(bytes)
  const embeddedImageCount = slides.reduce((sum, slide) => sum + slide.imagePaths.length, 0)
  return {
    format: 'pptx' as const,
    title: fileName.replace(/\.pptx$/i, '') || '',
    slideCount: slides.length,
    embeddedImageCount,
    hasText: slides.some(slide => slide.text.trim().length > 0),
  }
}

export async function pptxText(bytes: Uint8Array, slideFrom = 1, slideTo?: number) {
  const { slides } = await loadPptxSlides(bytes)
  const total = slides.length
  const from = Math.max(1, Math.floor(slideFrom || 1))
  const requestedTo = slideTo == null ? from + DOCUMENT_PPT_SLIDES_PER_CALL - 1 : Math.floor(slideTo)
  const to = Math.min(total, Math.max(from, requestedTo), from + DOCUMENT_PPT_SLIDES_PER_CALL - 1)
  if (from > total)
    throw new Error(`slideFrom ${from} is past the end (${total} slides)`)
  const slice = slides.slice(from - 1, to).map(item => ({
    slide: item.slide,
    text: item.text,
    imageCount: item.imagePaths.length,
  }))
  const joined = slice.map(item => `--- slide ${item.slide} ---\n${item.text}`).join('\n\n')
  const capped = capText(joined)
  return {
    format: 'pptx' as const,
    slideFrom: from,
    slideTo: to,
    slideCount: total,
    slides: slice,
    text: capped.text,
    truncated: capped.truncated,
    nextHint: capped.truncated
      ? capped.nextHint
      : (to < total ? `More slides remain. Call again with slideFrom=${to + 1}.` : ''),
  }
}

export async function pptxSearch(bytes: Uint8Array, query: string, maxHits: number) {
  const { slides } = await loadPptxSlides(bytes)
  const needle = query.trim().toLowerCase()
  if (!needle)
    throw new Error('query is required')
  const hits: Array<{ slide: number, snippet: string }> = []
  for (const slide of slides) {
    const text = slide.text || ''
    const at = text.toLowerCase().indexOf(needle)
    if (at < 0)
      continue
    hits.push({
      slide: slide.slide,
      snippet: text.slice(Math.max(0, at - 80), Math.min(text.length, at + needle.length + 140)).replace(/\s+/g, ' ').trim(),
    })
    if (hits.length >= maxHits)
      break
  }
  return { format: 'pptx' as const, query, hits, hitCount: hits.length, slideCount: slides.length }
}

export type PptxEmbeddedImage = {
  index: number
  name: string
  path: string
  mime: string
  bytes: Uint8Array
  byteLength: number
  slides: number[]
}

export async function pptxEmbeddedImages(bytes: Uint8Array, maxImages: number): Promise<PptxEmbeddedImage[]> {
  const { zip, slides } = await loadPptxSlides(bytes)
  const byPath = new Map<string, number[]>()
  for (const slide of slides) {
    for (const path of slide.imagePaths) {
      const list = byPath.get(path) || []
      list.push(slide.slide)
      byPath.set(path, list)
    }
  }
  // Also pick up media not linked from slide rels (notes/masters rarely needed, but catch orphans under ppt/media).
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/media\//i.test(name) || zip.files[name]!.dir)
      continue
    if (!byPath.has(name))
      byPath.set(name, [])
  }
  const images: PptxEmbeddedImage[] = []
  for (const [path, slideRefs] of [...byPath.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    if (images.length >= maxImages)
      break
    const name = path.split('/').pop() || path
    const mime = mimeFromName(name)
    if (!mime)
      continue
    const file = zip.files[path]
    if (!file)
      continue
    const data = await file.async('uint8array')
    if (!data.byteLength)
      continue
    images.push({
      index: images.length,
      name,
      path,
      mime,
      bytes: data,
      byteLength: data.byteLength,
      slides: slideRefs,
    })
  }
  return images
}

function wrapLines(ctx: { measureText: (text: string) => { width: number } }, text: string, maxWidth: number, maxLines: number) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth) {
      current = next
      continue
    }
    if (current)
      lines.push(current)
    current = word
    if (lines.length >= maxLines)
      break
  }
  if (current && lines.length < maxLines)
    lines.push(current)
  if (words.length && lines.length >= maxLines) {
    const last = lines[lines.length - 1] || ''
    lines[lines.length - 1] = `${last.replace(/\s+\S*$/, '')}…`
  }
  return lines
}

/**
 * Node-friendly PPTX "page" preview: compose slide text + embedded images on a canvas.
 * Not a full PowerPoint rasterizer — layout/fonts/shapes are approximate.
 */
export async function pptxSlideImage(bytes: Uint8Array, page = 1) {
  const { zip, slides } = await loadPptxSlides(bytes)
  const total = slides.length
  const slideNumber = Math.max(1, Math.floor(page || 1))
  if (slideNumber > total)
    throw new Error(`slide ${slideNumber} is past the end of the deck (${total} slides)`)
  const slide = slides[slideNumber - 1]!

  const width = 1280
  const height = 720
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(24, 24, width - 48, height - 48)

  ctx.fillStyle = '#334155'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText(`Slide ${slideNumber} / ${total}`, 56, 72)

  ctx.strokeStyle = '#e2e8f0'
  ctx.beginPath()
  ctx.moveTo(56, 92)
  ctx.lineTo(width - 56, 92)
  ctx.stroke()

  const textMaxWidth = width - 112
  ctx.fillStyle = '#0f172a'
  ctx.font = '32px sans-serif'
  const lines = wrapLines(ctx, slide.text || '(no extractable text on this slide)', textMaxWidth, 8)
  let y = 140
  for (const line of lines) {
    ctx.fillText(line, 56, y)
    y += 44
  }

  const embedded: Array<{ name: string, mime: string, bytes: Uint8Array }> = []
  for (const path of slide.imagePaths.slice(0, 4)) {
    const file = zip.files[path]
    if (!file)
      continue
    const name = path.split('/').pop() || path
    const mime = mimeFromName(name)
    if (!mime)
      continue
    const data = await file.async('uint8array')
    if (!data.byteLength)
      continue
    embedded.push({ name, mime, bytes: data })
  }

  if (embedded.length) {
    const slotW = Math.floor((width - 112 - (embedded.length - 1) * 16) / embedded.length)
    const slotH = 220
    const top = height - slotH - 64
    for (let index = 0; index < embedded.length; index++) {
      const item = embedded[index]!
      const x = 56 + index * (slotW + 16)
      try {
        const image = await loadImage(Buffer.from(item.bytes))
        const scale = Math.min(slotW / image.width, slotH / image.height)
        const drawW = Math.max(1, Math.floor(image.width * scale))
        const drawH = Math.max(1, Math.floor(image.height * scale))
        const dx = x + Math.floor((slotW - drawW) / 2)
        const dy = top + Math.floor((slotH - drawH) / 2)
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(x, top, slotW, slotH)
        ctx.drawImage(image, dx, dy, drawW, drawH)
      }
      catch {
        ctx.fillStyle = '#f1f5f9'
        ctx.fillRect(x, top, slotW, slotH)
        ctx.fillStyle = '#64748b'
        ctx.font = '16px sans-serif'
        ctx.fillText(item.name.slice(0, 28), x + 12, top + 28)
      }
    }
  }

  ctx.fillStyle = '#64748b'
  ctx.font = '16px sans-serif'
  ctx.fillText(
    embedded.length
      ? `Preview (text + ${embedded.length} embedded image${embedded.length === 1 ? '' : 's'}). Not a full PPTX raster.`
      : 'Preview from slide text. Not a full PPTX raster — shapes/charts may be missing.',
    56,
    height - 36,
  )

  const buffer = canvas.toBuffer('image/png')
  return {
    format: 'pptx' as const,
    page: slideNumber,
    slide: slideNumber,
    pageCount: total,
    slideCount: total,
    mime: 'image/png' as const,
    bytes: new Uint8Array(buffer),
    scale: 1,
    mode: 'pptx-preview' as const,
    slideText: slide.text,
    embeddedImages: embedded.map(item => ({
      name: item.name,
      mime: item.mime,
      byteLength: item.bytes.byteLength,
      bytes: item.bytes,
    })),
    note: 'PPTX slide preview composed in Node (text + embedded images). Not a pixel-perfect PowerPoint render.',
  }
}
