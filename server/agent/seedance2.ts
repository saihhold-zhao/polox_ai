import type { Seedance2AspectRatio, Seedance2Duration, Seedance2Resolution } from './types'
import { SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_DURATIONS, SEEDANCE_2_RESOLUTIONS } from './types'

export function isSeedance2AspectRatio(value: string): value is Seedance2AspectRatio {
  return (SEEDANCE_2_ASPECT_RATIOS as readonly string[]).includes(value)
}

export function isSeedance2Resolution(value: string): value is Seedance2Resolution {
  return (SEEDANCE_2_RESOLUTIONS as readonly string[]).includes(value)
}

export function isSeedance2Duration(value: number): value is Seedance2Duration {
  return (SEEDANCE_2_DURATIONS as readonly number[]).includes(value)
}
