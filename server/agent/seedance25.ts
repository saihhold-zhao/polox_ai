import type { Seedance25Duration, Seedance25Resolution } from './types'
import { SEEDANCE_25_DURATIONS, SEEDANCE_25_RESOLUTIONS } from './types'

export function isSeedance25Resolution(value: string): value is Seedance25Resolution {
  return (SEEDANCE_25_RESOLUTIONS as readonly string[]).includes(value)
}

export function isSeedance25Duration(value: number): value is Seedance25Duration {
  return (SEEDANCE_25_DURATIONS as readonly number[]).includes(value)
}

export function snapSeedance25Duration(value: number): Seedance25Duration {
  const duration = Math.floor(Number(value) || 5)
  return SEEDANCE_25_DURATIONS.reduce((best, item) => (
    Math.abs(item - duration) < Math.abs(best - duration) ? item : best
  ))
}
