/**
 * Skill card cover URL rules (My Skills / Home cards render it in an <img>).
 * Shared by PATCH /api/skills/:id (cover-only updates) and the Test-mode canvas action.
 */
export const SKILL_COVER_MAX_LENGTH = 2048

export type SkillCoverInput =
  | { ok: true, cover: string }
  | { ok: false, error: string }

const NON_IMAGE_EXT = /\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|pdf|docx?|pptx?|xlsx?|csv|zip)(?:[?#]|$)/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Loopback, private-LAN, or *.local hosts: where a local OSS install serves its own media over plain http. */
function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (LOCAL_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost'))
    return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
    return false
  const [a, b] = parts as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * Strict write-side validation. Empty string clears the cover.
 * Accepts any HTTPS image URL, plus plain http for local media: loopback / LAN / *.local hosts,
 * or the app's own `/media/...` route (OSS stores media locally and may serve it over http).
 */
export function parseSkillCoverInput(value: unknown): SkillCoverInput {
  if (value === null)
    return { ok: true, cover: '' }
  if (typeof value !== 'string')
    return { ok: false, error: 'cover must be a string URL' }
  const raw = value.trim()
  if (!raw)
    return { ok: true, cover: '' }
  if (raw.length > SKILL_COVER_MAX_LENGTH)
    return { ok: false, error: 'cover URL is too long' }
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return { ok: false, error: 'cover must be an absolute image URL' }
  }
  const isLocal = isLocalHost(url.hostname) || url.pathname.startsWith('/media/')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal))
    return { ok: false, error: 'cover must be an HTTPS image URL' }
  if (NON_IMAGE_EXT.test(url.pathname))
    return { ok: false, error: 'cover must be an image (video, audio, and documents are not supported)' }
  return { ok: true, cover: url.toString() }
}

/** Canvas helper: only finished still images can become a skill cover. */
export function canUseAsSkillCover(asset: { url?: string, video?: boolean, audio?: boolean, document?: boolean, state?: string }) {
  if (!asset.url || asset.state !== 'success' || asset.video || asset.audio || asset.document)
    return false
  return parseSkillCoverInput(asset.url).ok
}
