export const GPT_IMAGE_2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21',
] as const

export const GPT_IMAGE_2_RESOLUTIONS = ['1K', '2K', '4K'] as const

export const GPT_HIGH_RES_UNSUPPORTED_RATIOS = new Set(['5:4', '4:5', '3:1', '1:3', '9:21'])

export type GptImage2AspectRatio = typeof GPT_IMAGE_2_ASPECT_RATIOS[number]
export type GptImage2Resolution = typeof GPT_IMAGE_2_RESOLUTIONS[number]

export function isGptImage2AspectRatio(value: string): value is GptImage2AspectRatio {
  return (GPT_IMAGE_2_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isGptImage2Resolution(value: string): value is GptImage2Resolution {
  return (GPT_IMAGE_2_RESOLUTIONS as readonly string[]).includes(value)
}

export function gptCompatibleAspect(resolution: string, aspect: string) {
  if (resolution === '4K') {
    if (aspect === 'auto' || aspect === '1:1' || GPT_HIGH_RES_UNSUPPORTED_RATIOS.has(aspect))
      return '16:9'
    return aspect
  }

  if (resolution === '2K') {
    if (aspect === 'auto' || GPT_HIGH_RES_UNSUPPORTED_RATIOS.has(aspect))
      return '1:1'
    return aspect
  }

  return aspect
}

export function gptCompatibleResolution(aspect: string, resolution: string) {
  if (aspect === 'auto')
    return '1K'
  if (aspect === '1:1' && resolution === '4K')
    return '2K'
  if (GPT_HIGH_RES_UNSUPPORTED_RATIOS.has(aspect) && resolution !== '1K')
    return '1K'
  return resolution
}

export function gptImage2ComboError(aspect: string, resolution: string) {
  if (aspect === 'auto' && resolution !== '1K')
    return 'Auto aspect ratio only supports 1K resolution'
  if (aspect === '1:1' && resolution === '4K')
    return '1:1 aspect ratio cannot use 4K resolution'
  if (GPT_HIGH_RES_UNSUPPORTED_RATIOS.has(aspect) && resolution !== '1K')
    return `${aspect} only supports 1K resolution`
  return ''
}
