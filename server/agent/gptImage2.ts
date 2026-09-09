import type { GptImage2AspectRatio, GptImage2Resolution } from './types'
import { GPT_IMAGE_2_ASPECT_RATIOS, GPT_IMAGE_2_RESOLUTIONS } from './types'

const HIGH_RES_UNSUPPORTED = new Set(['5:4', '4:5', '3:1', '1:3', '9:21'])

export function isGptImage2AspectRatio(value: string): value is GptImage2AspectRatio {
  return (GPT_IMAGE_2_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isGptImage2Resolution(value: string): value is GptImage2Resolution {
  return (GPT_IMAGE_2_RESOLUTIONS as readonly string[]).includes(value)
}

export function gptImage2ComboError(aspect: string, resolution: string) {
  if (aspect === 'auto' && resolution !== '1K')
    return 'Auto aspect ratio only supports 1K resolution'
  if (aspect === '1:1' && resolution === '4K')
    return '1:1 aspect ratio cannot use 4K resolution'
  if (HIGH_RES_UNSUPPORTED.has(aspect) && resolution !== '1K')
    return `${aspect} only supports 1K resolution`
  return ''
}
