export type AspectRatioOrientation = 'landscape' | 'portrait' | 'square'

export function parseAspectRatio(ratio: string) {
  const [widthRaw, heightRaw] = ratio.split(':').map(Number)
  const width = widthRaw || 1
  const height = heightRaw || 1

  let orientation: AspectRatioOrientation = 'square'
  if (width > height)
    orientation = 'landscape'
  else if (height > width)
    orientation = 'portrait'

  return { width, height, orientation }
}

export function getAspectRatioIconSize(ratio: string, maxSize = 14) {
  const { width, height, orientation } = parseAspectRatio(ratio)
  const scale = maxSize / Math.max(width, height)

  return {
    width: Math.max(4, Math.round(width * scale)),
    height: Math.max(4, Math.round(height * scale)),
    orientation,
  }
}
