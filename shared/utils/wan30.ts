export const WAN_30_ASPECT_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
export const WAN_30_RESOLUTIONS = ['480P', '720P', '1080P'] as const
export const WAN_30_DURATIONS = Array.from({ length: 29 }, (_, index) => index + 2)

export const WAN_30_MODEL = 'wan/3-0-video'

export const WAN_30_MODELS = [
  'wan/3-0-video-text-to-video',
  'wan/3-0-video-image-to-video',
  'wan/3-0-video-reference-to-video',
] as const

export type Wan30Resolution = typeof WAN_30_RESOLUTIONS[number]

export function isWan30Model(model: string) {
  return (WAN_30_MODELS as readonly string[]).includes(model)
}

export function isWan30AspectRatio(value: string) {
  return (WAN_30_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isWan30Resolution(value: string): value is Wan30Resolution {
  return (WAN_30_RESOLUTIONS as readonly string[]).includes(value)
}

export function normalizeWan30Resolution(value: string): Wan30Resolution {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === '480P' || raw === '480')
    return '480P'
  if (raw === '720P' || raw === '720')
    return '720P'
  if (raw === '1080P' || raw === '1080')
    return '1080P'
  return '480P'
}
