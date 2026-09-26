/**
 * Downscaled LLM copies of chat images (vision only needs ~1.5K px). Originals stay in
 * the session and in tool input_urls; only the provider request carries the small copy.
 *
 * OSS: only media stored locally (served from this app's /media/) is shrunk. The local
 * bytes are resized to a webp and uploaded to WaveSpeed, and that WaveSpeed URL is what
 * the LLM receives. Remote URLs pass through untouched; the server never fetches
 * arbitrary URLs for this.
 */
import type { ChatMessage } from './types'
import type { LlmImageBudgetOptions } from './llmImageBudget'
import sharp from 'sharp'
import { readStoredMedia } from '../utils/localMedia'
import { uploadWavespeedFile } from '../utils/wavespeed'
import { applyLlmImageBudget, hasLlmImages, LLM_IMAGE_BUDGET, llmImageUrlsNewestFirst } from './llmImageBudget'

const LLM_IMAGE_MAX_SIDE = 1536
const LLM_IMAGE_QUALITY = 80
const LOCAL_MAX_BYTES = 200 * 1024 * 1024
const CACHE_MAX = 64
const FAILURE_TTL_MS = 10 * 60 * 1000
/** WaveSpeed download URLs are long-lived but not forever; refresh copies after this. */
const COPY_TTL_MS = 6 * 60 * 60 * 1000

type CopyEntry = { url: string, bytes: number, createdAt: number } | { failedAt: number, originalBytes?: number }
const cache = new Map<string, CopyEntry>()
const inflight = new Map<string, Promise<CopyEntry | null>>()

async function buildCopy(source: string): Promise<CopyEntry | null> {
  let originalBytes: number | undefined
  try {
    const local = await readStoredMedia(source, LOCAL_MAX_BYTES)
    if (!local)
      return null
    originalBytes = local.bytes.byteLength
    const output = await sharp(local.bytes, { limitInputPixels: 64_000_000, animated: false })
      .rotate()
      .resize({ width: LLM_IMAGE_MAX_SIDE, height: LLM_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: LLM_IMAGE_QUALITY })
      .toBuffer()
    const name = (new URL(source).pathname.split('/').pop() || 'image').replace(/\.[^.]+$/, '')
    const url = await uploadWavespeedFile(output, 'image/webp', `${name || 'image'}-llm.webp`)
    return { url, bytes: output.byteLength, createdAt: Date.now() }
  }
  catch (error) {
    console.warn('[agent llm image copy]', source, error instanceof Error ? error.message : error)
    return { failedAt: Date.now(), originalBytes }
  }
}

function remember(source: string, entry: CopyEntry) {
  cache.delete(source)
  cache.set(source, entry)
  while (cache.size > CACHE_MAX)
    cache.delete(cache.keys().next().value!)
}

function fresh(entry: CopyEntry) {
  return 'url' in entry ? Date.now() - entry.createdAt < COPY_TTL_MS : Date.now() - entry.failedAt < FAILURE_TTL_MS
}

async function llmCopy(source: string): Promise<CopyEntry | null> {
  if (source.startsWith('data:'))
    return null
  const hit = cache.get(source)
  if (hit && fresh(hit)) {
    remember(source, hit)
    return hit
  }
  let task = inflight.get(source)
  if (!task) {
    task = buildCopy(source).then((entry) => {
      if (entry)
        remember(source, entry)
      return entry
    }).finally(() => inflight.delete(source))
    inflight.set(source, task)
  }
  return task
}

/**
 * Budgeted copy of the messages for one provider call: newest images first, each local
 * image replaced by its downscaled WaveSpeed copy when available, older ones turned into
 * `[image omitted: <url>]` once the count/byte budget is reached. Only candidates that
 * could still fit are processed; copies are cached per URL (first call pays once).
 * Local images whose copy failed keep their original URL (providerMessages uploads the
 * original bytes as before) and are budgeted at their real size.
 */
export async function budgetLlmImages(messages: ChatMessage[], budget: LlmImageBudgetOptions = LLM_IMAGE_BUDGET) {
  if (!hasLlmImages(messages))
    return { messages, kept: 0, omitted: 0, bytes: 0 }
  const candidates = llmImageUrlsNewestFirst(messages).slice(0, budget.maxImages)
  const copies = new Map<string, string>()
  const sizes = new Map<string, number>()
  await Promise.all(candidates.map(async (url) => {
    const entry = await llmCopy(url)
    if (!entry)
      return
    if ('url' in entry) {
      copies.set(url, entry.url)
      sizes.set(entry.url, entry.bytes)
    }
    else if (entry.originalBytes) {
      sizes.set(url, entry.originalBytes)
    }
  }))
  const result = applyLlmImageBudget(messages, { ...budget, copyFor: url => copies.get(url), sizeOf: url => sizes.get(url) })
  if (result.omitted)
    console.warn('[agent llm image budget]', { kept: result.kept, omitted: result.omitted, bytes: result.bytes, latestTurnOnly: Boolean(budget.latestTurnOnly) })
  return result
}
