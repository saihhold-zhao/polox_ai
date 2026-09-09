import type { ImageLayerRegion } from './imageLayerSplitter'

export function validateLayerSelection(imageUrl: unknown, regions: unknown, allowedUrls: string[]) {
  if (typeof imageUrl !== 'string' || !allowedUrls.includes(imageUrl))
    throw new Error('Select an image from this conversation.')
  if (!Array.isArray(regions) || regions.length < 1 || regions.length > 16)
    throw new Error('Draw between 1 and 16 boxes before continuing.')
  const validated = regions.map((box) => {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(value => Number.isInteger(value) && value >= 0 && value <= 1000)
      || box[2] - box[0] < 5 || box[3] - box[1] < 5) {
      throw new Error('Invalid selection coordinates. Redraw the box.')
    }
    return [...box] as ImageLayerRegion
  })
  return { imageUrl, regions: validated }
}

export function validateLayerSelections(selections: unknown, allowedUrls: string[]) {
  if (!Array.isArray(selections) || !selections.length || selections.length > allowedUrls.length)
    throw new Error('Confirm boxes for the images you want to split.')
  const seen = new Set<string>()
  return selections.map((selection) => {
    const validated = validateLayerSelection(selection?.imageUrl, selection?.regions, allowedUrls)
    if (seen.has(validated.imageUrl))
      throw new Error('Each source image must appear only once.')
    seen.add(validated.imageUrl)
    return validated
  })
}
