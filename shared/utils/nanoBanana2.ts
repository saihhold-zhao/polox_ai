export const NANO_BANANA_2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '2:3',
  '3:2',
  '1:4',
  '4:1',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '1:8',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const

export const NANO_BANANA_PRO_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const

export const NANO_BANANA_2_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const NANO_BANANA_2_OUTPUT_FORMATS = ['png', 'jpg'] as const

export type NanoBanana2AspectRatio = typeof NANO_BANANA_2_ASPECT_RATIOS[number]
export type NanoBananaProAspectRatio = typeof NANO_BANANA_PRO_ASPECT_RATIOS[number]
export type NanoBanana2Resolution = typeof NANO_BANANA_2_RESOLUTIONS[number]
export type NanoBanana2OutputFormat = typeof NANO_BANANA_2_OUTPUT_FORMATS[number]

export function isNanoBanana2AspectRatio(value: string): value is NanoBanana2AspectRatio {
  return (NANO_BANANA_2_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isNanoBananaProAspectRatio(value: string): value is NanoBananaProAspectRatio {
  return (NANO_BANANA_PRO_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isNanoBanana2Resolution(value: string): value is NanoBanana2Resolution {
  return (NANO_BANANA_2_RESOLUTIONS as readonly string[]).includes(value)
}

export function isNanoBanana2OutputFormat(value: string): value is NanoBanana2OutputFormat {
  return (NANO_BANANA_2_OUTPUT_FORMATS as readonly string[]).includes(value)
}
