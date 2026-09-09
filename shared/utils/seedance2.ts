export const SEEDANCE_2_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
  'adaptive',
] as const

export const SEEDANCE_2_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const
export const SEEDANCE_2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export const SEEDANCE_2_MODEL = 'bytedance/seedance-2'

export const SEEDANCE_2_MODELS = [
  'bytedance/seedance-2-text-to-video',
  'bytedance/seedance-2-image-to-video',
  'bytedance/seedance-2-reference-to-video',
] as const

export type Seedance2AspectRatio = typeof SEEDANCE_2_ASPECT_RATIOS[number]
export type Seedance2Resolution = typeof SEEDANCE_2_RESOLUTIONS[number]
export type Seedance2Duration = typeof SEEDANCE_2_DURATIONS[number]

export function isSeedance2Model(model: string) {
  return (SEEDANCE_2_MODELS as readonly string[]).includes(model)
}

export function isSeedance2AspectRatio(value: string): value is Seedance2AspectRatio {
  return (SEEDANCE_2_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isSeedance2Resolution(value: string): value is Seedance2Resolution {
  return (SEEDANCE_2_RESOLUTIONS as readonly string[]).includes(value)
}

export function isSeedance2Duration(value: number): value is Seedance2Duration {
  return (SEEDANCE_2_DURATIONS as readonly number[]).includes(value)
}

export const SEEDANCE_2_MAX_INPUT_VIDEO_SECONDS = 15
