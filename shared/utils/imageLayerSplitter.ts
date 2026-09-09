export const IMAGE_LAYER_SPLITTER_MODEL = 'image-layer-splitter'
export const IMAGE_LAYER_SPLITTER_NAME = 'Image Layer Splitter'
export const IMAGE_LAYER_SPLITTER_MAX_BYTES = 30 * 1024 * 1024
export const MAX_IMAGE_LAYERS = 17

export function isImageLayerSplitterModel(model: string) {
  return model === IMAGE_LAYER_SPLITTER_MODEL
}

/** Coordinates use the provider's 0–1000 image space. */
export type ImageLayerRegion = [number, number, number, number]

export type ImageLayerHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export function transformImageLayerRegion(box: ImageLayerRegion, dx: number, dy: number, handle?: ImageLayerHandle): ImageLayerRegion {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)))
  if (!handle) {
    const x = clamp(dx, -box[0], 1000 - box[2])
    const y = clamp(dy, -box[1], 1000 - box[3])
    return [box[0] + x, box[1] + y, box[2] + x, box[3] + y]
  }
  return [
    handle.includes('w') ? clamp(box[0] + dx, 0, box[2] - 5) : box[0],
    handle.includes('n') ? clamp(box[1] + dy, 0, box[3] - 5) : box[1],
    handle.includes('e') ? clamp(box[2] + dx, box[0] + 5, 1000) : box[2],
    handle.includes('s') ? clamp(box[3] + dy, box[1] + 5, 1000) : box[3],
  ]
}

export function imageLayerRegionFromPoints(start: { x: number, y: number }, end: { x: number, y: number }): ImageLayerRegion {
  const clamp = (value: number) => Math.max(0, Math.min(1000, Math.round(value)))
  return [clamp(Math.min(start.x, end.x)), clamp(Math.min(start.y, end.y)), clamp(Math.max(start.x, end.x)), clamp(Math.max(start.y, end.y))]
}

export function imageLayerSelectionPrompt(regions: ImageLayerRegion[]) {
  if (!regions.length)
    return ''
  return `Extract the subject or element inside each selected region into its own separate, editable transparent PNG layer. Follow the subject's natural outline, preserve its appearance and original position, and exclude surrounding objects. Reconstruct the background behind the extracted elements as a separate base layer. Selected regions: ${regions.map(region => `<bbox>${region.join(' ')}</bbox>`).join(', ')}. Return layer names and descriptions in English.`
}
