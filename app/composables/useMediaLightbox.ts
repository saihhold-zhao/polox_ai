import { isMediaVideoUrl } from '~~/shared/utils/seedance25'

export type MediaLightboxKind = 'image' | 'video'

export interface MediaLightboxItem {
  url: string
  kind?: MediaLightboxKind
  alt?: string
  cutout?: boolean
}

export function useMediaLightbox() {
  const item = useState<MediaLightboxItem | null>('polox-media-lightbox', () => null)

  function open(next: MediaLightboxItem | string) {
    const payload = typeof next === 'string' ? { url: next } : next
    const url = String(payload.url || '').trim()
    if (!url)
      return
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
  }
}
