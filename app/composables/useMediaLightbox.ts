import { isMediaDocumentUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'

export type MediaLightboxKind = 'image' | 'video' | 'audio' | 'document'

export interface MediaLightboxItem {
  url: string
  kind?: MediaLightboxKind
  alt?: string
  cutout?: boolean
}

const OFFICE_ONLINE_VIEW = 'https://view.officeapps.live.com/op/view.aspx?src='

/**
 * Absolute http(s) URL on a public host that Office Online can fetch.
 * Local media (localhost, LAN, *.local) is never sent to Office Online; it opens directly instead.
 */
export function isPublicHttpFileUrl(url: string) {
  try {
    const parsed = new URL(String(url || '').trim())
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return false
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0')
      return false
    if (/^(?:127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host))
      return false
    return !host.includes(':') || host.includes('.')
  }
  catch {
    return false
  }
}

/** OOXML + legacy Office (+ CSV) that Microsoft Office Online viewer can preview. */
export function isOfficeOnlineViewerUrl(url: string) {
  return /\.(?:docx?|pptx?|xlsx?|csv)(?:\?|$)/i.test(String(url || ''))
}

export function isPdfDocumentUrl(url: string) {
  return /\.pdf(?:\?|$)/i.test(String(url || ''))
}

export function officeOnlineViewerUrl(publicFileUrl: string) {
  return `${OFFICE_ONLINE_VIEW}${encodeURIComponent(publicFileUrl)}`
}

/**
 * Open a document outside the image lightbox:
 * - PDF → browser native viewer (window.open raw)
 * - Word/Excel/PPT/CSV → Microsoft Office Online view.aspx when URL is public https
 * - otherwise → window.open(raw) (download / browser handler)
 *
 * Optional `nameOrKind` is used only for extension sniffing when the URL path
 * has no recognizable document suffix (e.g. opaque CDN paths). Pass a filename
 * like `report.docx`; the literal kind `"document"` is ignored for sniffing.
 */
export function openMediaDocument(url: string, nameOrKind?: MediaLightboxKind | string) {
  if (!import.meta.client)
    return
  const trimmed = String(url || '').trim()
  if (!trimmed)
    return

  const hint = String(nameOrKind || '').trim()
  const useHint = Boolean(hint) && hint !== 'document'
    && !isPdfDocumentUrl(trimmed)
    && !isOfficeOnlineViewerUrl(trimmed)
  const extProbe = useHint ? hint : trimmed

  // PDF: keep browser native viewer (same as prior Expand behavior).
  if (isPdfDocumentUrl(extProbe)) {
    window.open(trimmed, '_blank', 'noopener,noreferrer')
    return
  }

  // Office / CSV: Office Online needs a publicly reachable https URL; local media opens/downloads directly.
  if (isOfficeOnlineViewerUrl(extProbe) && /^https:\/\//i.test(trimmed) && isPublicHttpFileUrl(trimmed)) {
    window.open(officeOnlineViewerUrl(trimmed), '_blank', 'noopener,noreferrer')
    return
  }

  // Non-public (blob:/data:/relative) or unsupported → raw open / download.
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

export function useMediaLightbox() {
  const item = useState<MediaLightboxItem | null>('polox-media-lightbox', () => null)

  function open(next: MediaLightboxItem | string) {
    const payload = typeof next === 'string' ? { url: next } : next
    const url = String(payload.url || '').trim()
    if (!url)
      return
    // Documents never enter the image/video lightbox — route via openMediaDocument.
    if (payload.kind === 'document' || isMediaDocumentUrl(url)) {
      openMediaDocument(url, payload.alt || payload.kind || 'document')
      return
    }
    item.value = {
      url,
      kind: payload.kind || (isMediaVideoUrl(url) ? 'video' : 'image'),
      alt: payload.alt || '',
      cutout: Boolean(payload.cutout),
    }
  }

  function close() {
    item.value = null
  }

  return {
    item,
    open,
    close,
    openMediaDocument,
  }
}
