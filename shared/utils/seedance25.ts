export const SEEDANCE_25_ASPECT_RATIOS = [
  'adaptive',
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
] as const

export const SEEDANCE_25_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const SEEDANCE_25_DURATIONS = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const
export const SEEDANCE_25_OUTPUT_FORMATS = ['mp4', 'mov'] as const

export const SEEDANCE_25_MODEL = 'bytedance/seedance-2-5'

export const SEEDANCE_25_MODELS = [
  'bytedance/seedance-2-5-text-to-video',
  'bytedance/seedance-2-5-image-to-video',
  'bytedance/seedance-2-5-reference-to-video',
] as const

export type Seedance25AspectRatio = typeof SEEDANCE_25_ASPECT_RATIOS[number]
export type Seedance25Resolution = typeof SEEDANCE_25_RESOLUTIONS[number]
export type Seedance25Duration = typeof SEEDANCE_25_DURATIONS[number]

export function isSeedance25Model(model: string) {
  return (SEEDANCE_25_MODELS as readonly string[]).includes(model)
}

export function isSeedance25AspectRatio(value: string): value is Seedance25AspectRatio {
  return (SEEDANCE_25_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isSeedance25Resolution(value: string): value is Seedance25Resolution {
  return (SEEDANCE_25_RESOLUTIONS as readonly string[]).includes(value)
}

export function isSeedance25Duration(value: number): value is Seedance25Duration {
  return (SEEDANCE_25_DURATIONS as readonly number[]).includes(value)
}

export const SEEDANCE_25_MAX_INPUT_VIDEO_SECONDS = 30

export function isMediaVideoUrl(url: string) {
  return /\.(?:mp4|mov|webm|m4v)(?:\?|$)/i.test(url)
}

export function isMediaAudioUrl(url: string) {
  return /\.(?:mp3|wav|m4a|aac|ogg)(?:\?|$)/i.test(url)
}

export function isMediaImageUrl(url: string) {
  return /\.(?:jpe?g|png|webp|gif|bmp|tiff?)(?:\?|$)/i.test(url)
}
