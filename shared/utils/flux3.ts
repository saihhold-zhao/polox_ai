export const FLUX_3_T2V_MODEL = 'blackforestlabs/flux-3/text-to-video'
export const FLUX_3_I2V_MODEL = 'blackforestlabs/flux-3/image-to-video'
export const FLUX_3_FLF_MODEL = 'blackforestlabs/flux-3/first-last-frame-to-video'

export const FLUX_3_ASPECT_RATIOS = ['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
export const FLUX_3_RESOLUTIONS = ['720p', '1080p'] as const
export const FLUX_3_DURATIONS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const

export type Flux3Resolution = typeof FLUX_3_RESOLUTIONS[number]

export function isFlux3T2vModel(model: string) {
  return model === FLUX_3_T2V_MODEL
}

export function isFlux3I2vModel(model: string) {
  return model === FLUX_3_I2V_MODEL
}

export function isFlux3FlfModel(model: string) {
  return model === FLUX_3_FLF_MODEL
}

export function isFlux3GenerateModel(model: string) {
  return isFlux3T2vModel(model) || isFlux3I2vModel(model) || isFlux3FlfModel(model)
}

export function flux3FalEndpoint(model: string, input: Record<string, unknown>) {
  if (isFlux3I2vModel(model) && typeof input.end_image_url === 'string' && input.end_image_url)
    return FLUX_3_FLF_MODEL
  return model
}

export function isFlux3AspectRatio(value: string) {
  return (FLUX_3_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isFlux3Resolution(value: string): value is Flux3Resolution {
  return (FLUX_3_RESOLUTIONS as readonly string[]).includes(value)
}

export function isFlux3Duration(value: number) {
  return (FLUX_3_DURATIONS as readonly number[]).includes(value)
}
