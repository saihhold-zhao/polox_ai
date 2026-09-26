import type { AgentImage } from './types'
import { parseSkillCoverInput } from '~~/shared/utils/skillCover'

export const SKILL_COVER_MIRROR_MAX_BYTES = 10 * 1024 * 1024
const MIRROR_TIMEOUT_MS = 20_000

export type ResolveSkillCoverResult =
  | { ok: true, cover: string, mirrored: boolean }
  | { ok: false, error: string }

export interface ResolveSkillCoverDeps {
  /** True when the URL points at this install's local media store (already durable). */
  isLocalMediaUrl: (url: string) => boolean
  /** Saves bytes into local media storage and returns the local media URL. */
  saveImage: (file: { bytes: Uint8Array, mime: string }) => Promise<string>
  fetchImpl?: typeof fetch
}

/** Session still image (finished, not video/audio/document) whose URL matches. */
export function findSessionCoverAsset(images: readonly AgentImage[], url: string) {
  return images.find(item =>
    item.status === 'success'
    && (item.url === url || item.sourceUrl === url)
    && item.kind !== 'video'
    && item.kind !== 'audio'
    && item.kind !== 'document',
  ) || null
}

/**
 * Validate a set_skill_cover URL and make it durable:
 * - already in local media storage → saved as-is;
 * - a finished image from this session on a temporary provider host (fal / WaveSpeed …) → copied to local storage first;
 * - anything else is refused (no arbitrary server-side fetches).
 */
export async function resolveSkillCoverUrl(
  rawUrl: unknown,
  images: readonly AgentImage[],
  deps: ResolveSkillCoverDeps,
  signal?: AbortSignal,
): Promise<ResolveSkillCoverResult> {
  const parsed = parseSkillCoverInput(rawUrl)
  if (!parsed.ok)
    return { ok: false, error: parsed.error }
  if (!parsed.cover)
    return { ok: false, error: 'url is required (an image URL from this session)' }
  const raw = typeof rawUrl === 'string' ? rawUrl.trim() : parsed.cover
  if (deps.isLocalMediaUrl(parsed.cover) || deps.isLocalMediaUrl(raw))
    return { ok: true, cover: deps.isLocalMediaUrl(raw) ? raw : parsed.cover, mirrored: false }

  const asset = findSessionCoverAsset(images, raw) || findSessionCoverAsset(images, parsed.cover)
  if (!asset)
    return { ok: false, error: 'Use a finished image generated or uploaded in this session as the cover.' }
  if (asset.url && asset.url !== raw && deps.isLocalMediaUrl(asset.url))
    return { ok: true, cover: asset.url, mirrored: false }

  const fetchImpl = deps.fetchImpl || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetchImpl(raw, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok)
      return { ok: false, error: `Could not download the cover image (${response.status})` }
    const mime = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0]!.trim()
    if (!mime.startsWith('image/'))
      return { ok: false, error: 'The cover URL is not an image' }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength || bytes.byteLength > SKILL_COVER_MIRROR_MAX_BYTES)
      return { ok: false, error: 'The cover image must be between 1 byte and 10MB' }
    const cover = await deps.saveImage({ bytes, mime })
    return { ok: true, cover, mirrored: true }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error && error.name !== 'AbortError' ? `Could not copy the cover to storage: ${error.message}` : 'Timed out copying the cover to storage' }
  }
  finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
