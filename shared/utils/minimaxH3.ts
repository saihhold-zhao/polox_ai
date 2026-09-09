export const MINIMAX_H3_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
export const MINIMAX_H3_REF_ASPECT_RATIOS = ['adaptive', ...MINIMAX_H3_ASPECT_RATIOS] as const
export const MINIMAX_H3_RESOLUTIONS = ['480P', '768P', '2K', '4K'] as const
export const MINIMAX_H3_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export const MINIMAX_H3_MODELS = [
  'minimax-h3/text-to-video',
  'minimax-h3/image-to-video',
  'minimax-h3/reference-to-video',
] as const

export type MiniMaxH3Resolution = typeof MINIMAX_H3_RESOLUTIONS[number]

export function isMiniMaxH3Model(model: string) {
  return (MINIMAX_H3_MODELS as readonly string[]).includes(model)
}

export function isMiniMaxH3AspectRatio(value: string, allowAdaptive = false) {
  if (allowAdaptive && value === 'adaptive')
    return true
  return (MINIMAX_H3_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isMiniMaxH3Resolution(value: string): value is MiniMaxH3Resolution {
  return (MINIMAX_H3_RESOLUTIONS as readonly string[]).includes(value)
}
export const MINIMAX_H3_MAX_REFERENCE_IMAGES = 9
