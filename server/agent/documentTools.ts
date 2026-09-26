import { z } from 'zod'
import type { AgentImage } from './types'
import {
  runDocumentImages,
  runDocumentMeta,
  runDocumentPageImage,
  runDocumentSearch,
  runDocumentText,
} from '../utils/documents'

export const DOCUMENT_META_TOOL = 'document_meta'
export const DOCUMENT_TEXT_TOOL = 'document_text'
export const DOCUMENT_SEARCH_TOOL = 'document_search'
export const DOCUMENT_PAGE_IMAGE_TOOL = 'document_page_image'
export const DOCUMENT_IMAGES_TOOL = 'document_images'

export const DOCUMENT_TOOL_NAMES = [
  DOCUMENT_META_TOOL,
  DOCUMENT_TEXT_TOOL,
  DOCUMENT_SEARCH_TOOL,
  DOCUMENT_PAGE_IMAGE_TOOL,
  DOCUMENT_IMAGES_TOOL,
] as const

export type DocumentToolName = typeof DOCUMENT_TOOL_NAMES[number]

const urlProp = {
  type: 'string',
  description: 'URL of a document uploaded in this session (PDF / DOCX / PPTX / XLSX / CSV). Legacy .doc/.ppt/.xls are not supported — convert to OOXML first.',
} as const

export const documentMetaTool = {
  type: 'function' as const,
  function: {
    name: DOCUMENT_META_TOOL,
    description: 'Inspect an attached document cheaply after the user states a concrete need: format, page/slide/sheet/chunk counts, paragraphCount (Word), title, size, whether extractable text exists. Call before document_text on long files. Supports PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), CSV. Free. Ask-first: do not call on attach-only or vague look-over turns. Do NOT dump full document text into chat; use the ranged document_* tools.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { url: urlProp },
      required: ['url'],
    },
  },
}

export const documentTextTool = {
  type: 'function' as const,
  function: {
    name: DOCUMENT_TEXT_TOOL,
    description: 'Extract a bounded text range from an attached document after the user asks for specific contents. PDF: pageFrom/pageTo (default max 8 pages/call). Word DOCX: chunkFrom/chunkTo (paragraph-aware ~4k-char chunks, max 4/call). PowerPoint PPTX: slideFrom/slideTo (max 8 slides/call). XLSX/CSV: sheet + rowFrom/rowTo (max ~200 rows × ~40 cols). Returns truncated=true + nextHint when more remains. Hard-capped (~20k chars). Free. Ask-first: do not call on attach-only or vague look-over turns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: urlProp,
        pageFrom: { type: 'integer', minimum: 1, description: 'PDF first page (1-based).' },
        pageTo: { type: 'integer', minimum: 1, description: 'PDF last page inclusive.' },
        chunkFrom: { type: 'integer', minimum: 1, description: 'DOCX first chunk (1-based). Prefer over page* for Word.' },
        chunkTo: { type: 'integer', minimum: 1, description: 'DOCX last chunk inclusive.' },
        slideFrom: { type: 'integer', minimum: 1, description: 'PPTX first slide (1-based). Prefer over page* for PowerPoint.' },
        slideTo: { type: 'integer', minimum: 1, description: 'PPTX last slide inclusive.' },
        sheet: { type: 'string', description: 'XLSX sheet name. Defaults to the first sheet.' },
        rowFrom: { type: 'integer', minimum: 1, description: 'XLSX/CSV first row (1-based).' },
        rowTo: { type: 'integer', minimum: 1, description: 'XLSX/CSV last row inclusive.' },
      },
      required: ['url'],
    },
  },
}

export const documentSearchTool = {
  type: 'function' as const,
  function: {
    name: DOCUMENT_SEARCH_TOOL,
    description: 'Keyword search inside an attached PDF / Word / PowerPoint / Excel / CSV after the user states what to find. Returns up to 20 hits with locators (page / chunk / slide / row) and short snippets. Prefer this over scanning a whole long document with document_text. Free. Ask-first: do not call on attach-only or vague look-over turns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: urlProp,
        query: { type: 'string', minLength: 1, description: 'Case-insensitive keyword or phrase.' },
        maxHits: { type: 'integer', minimum: 1, maximum: 20, description: 'Max hits to return (default 20).' },
      },
      required: ['url', 'query'],
    },
  },
}

export const documentPageImageTool = {
  type: 'function' as const,
  function: {
    name: DOCUMENT_PAGE_IMAGE_TOOL,
    description: 'Rasterize one PDF page OR one PPTX slide to PNG, save it to local media, and return an imageUrl for multimodal follow-up — only after the user asks for a page/slide view or visual follow-up. PDF: true page render (scale ~1.5). PPTX: Node preview composed from slide text + embedded images (not pixel-perfect PowerPoint). Pass page= (or slide= alias for PPTX). DOCX is not page-rasterized — use document_text / document_images. Free. Ask-first: do not call on attach-only or vague look-over turns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: urlProp,
        page: { type: 'integer', minimum: 1, description: 'PDF page or PPTX slide number (1-based).' },
        slide: { type: 'integer', minimum: 1, description: 'PPTX slide alias for page (1-based). Ignored for PDF.' },
        scale: { type: 'number', minimum: 0.75, maximum: 2, description: 'PDF render scale (default 1.5). Ignored for PPTX preview.' },
      },
      required: ['url'],
    },
  },
}

export const documentImagesTool = {
  type: 'function' as const,
  function: {
    name: DOCUMENT_IMAGES_TOOL,
    description: 'Extract embedded images from DOCX / PPTX (saved to local media with imageUrl) or list embedded images in a PDF (best-effort) after the user asks for them. Prefer document_page_image for readable PDF pages or PPTX slide previews. Cap 12. Free. Ask-first: do not call on attach-only or vague look-over turns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: urlProp,
        maxImages: { type: 'integer', minimum: 1, maximum: 12, description: 'Max images to list/upload (default 12).' },
      },
      required: ['url'],
    },
  },
}

export const documentTools = [
  documentMetaTool,
  documentTextTool,
  documentSearchTool,
  documentPageImageTool,
  documentImagesTool,
]

const metaSchema = z.object({ url: z.string().min(1) })
const textSchema = z.object({
  url: z.string().min(1),
  pageFrom: z.number().int().positive().optional(),
  pageTo: z.number().int().positive().optional(),
  chunkFrom: z.number().int().positive().optional(),
  chunkTo: z.number().int().positive().optional(),
  slideFrom: z.number().int().positive().optional(),
  slideTo: z.number().int().positive().optional(),
  sheet: z.string().optional(),
  rowFrom: z.number().int().positive().optional(),
  rowTo: z.number().int().positive().optional(),
})
const searchSchema = z.object({
  url: z.string().min(1),
  query: z.string().min(1),
  maxHits: z.number().int().positive().max(20).optional(),
})
const pageImageSchema = z.object({
  url: z.string().min(1),
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  scale: z.number().min(0.75).max(2).optional(),
}).refine(value => value.page != null || value.slide != null, {
  message: 'page or slide is required',
})
const imagesSchema = z.object({
  url: z.string().min(1),
  maxImages: z.number().int().positive().max(12).optional(),
})

function parseArgs<T>(schema: z.ZodType<T>, raw: string, label: string): T {
  try {
    return schema.parse(JSON.parse(raw || '{}'))
  }
  catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(`${label} arguments are invalid`)
    throw new Error(`${label} arguments were not valid JSON`)
  }
}

export function parseDocumentMetaArgs(raw: string) {
  return parseArgs(metaSchema, raw, DOCUMENT_META_TOOL)
}
export function parseDocumentTextArgs(raw: string) {
  return parseArgs(textSchema, raw, DOCUMENT_TEXT_TOOL)
}
export function parseDocumentSearchArgs(raw: string) {
  return parseArgs(searchSchema, raw, DOCUMENT_SEARCH_TOOL)
}
export function parseDocumentPageImageArgs(raw: string) {
  const parsed = parseArgs(pageImageSchema, raw, DOCUMENT_PAGE_IMAGE_TOOL)
  const page = parsed.page ?? parsed.slide
  if (page == null)
    throw new Error(`${DOCUMENT_PAGE_IMAGE_TOOL} requires page or slide`)
  return { url: parsed.url, page, slide: parsed.slide, scale: parsed.scale }
}
export function parseDocumentImagesArgs(raw: string) {
  return parseArgs(imagesSchema, raw, DOCUMENT_IMAGES_TOOL)
}

export async function runDocumentMetaTool(url: string, images: AgentImage[], signal?: AbortSignal) {
  return runDocumentMeta(url, images, signal)
}

export async function runDocumentTextTool(
  args: z.infer<typeof textSchema>,
  images: AgentImage[],
  signal?: AbortSignal,
) {
  return runDocumentText(args.url, images, args, signal)
}

export async function runDocumentSearchTool(
  args: z.infer<typeof searchSchema>,
  images: AgentImage[],
  signal?: AbortSignal,
) {
  return runDocumentSearch(args.url, images, args.query, args.maxHits, signal)
}

export async function runDocumentPageImageTool(
  args: { url: string, page: number, scale?: number },
  images: AgentImage[],
  sessionId: string,
  signal?: AbortSignal,
) {
  return runDocumentPageImage(args.url, images, args.page, sessionId, signal)
}

export async function runDocumentImagesTool(
  args: z.infer<typeof imagesSchema>,
  images: AgentImage[],
  sessionId: string,
  signal?: AbortSignal,
) {
  return runDocumentImages(args.url, images, args.maxImages, sessionId, signal)
}

export function isDocumentToolName(name: string): name is DocumentToolName {
  return (DOCUMENT_TOOL_NAMES as readonly string[]).includes(name)
}
