import type { ImageLayerRegion } from '~~/shared/utils/imageLayerSplitter'
import { imageLayerSelectionPrompt } from '~~/shared/utils/imageLayerSplitter'
import { firstHttpUrl } from './mediaInput'

export const IMAGE_LAYER_SPLITTER_ENDPOINT = 'bytedance/seedream/v5/pro/layerize'

export function sanitizeImageLayerInput(input: Record<string, unknown>): Record<string, unknown> {
  const regions = input.regions ?? []
  if (!Array.isArray(regions) || regions.length > 16 || regions.some(region =>
    !Array.isArray(region) || region.length !== 4
    || region.some(value => !Number.isInteger(value) || value < 0 || value > 1000)
    || region[0] >= region[2] || region[1] >= region[3],
  )) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image selection' })
  }
  return {
    image_url: firstHttpUrl(input.image_url, 'image_url', true),
    prompt: imageLayerSelectionPrompt(regions as ImageLayerRegion[]),
    image_size: 'auto_2K',
    enhance_prompt_mode: 'fast',
    enable_safety_checker: true,
  }
}

interface Layer {
  image: { url: string, width?: number, height?: number }
  z_index: number
  name?: string
  description?: string
  bounding_box?: unknown
}

export async function readLayerResult(result: Record<string, unknown>) {
  const layers = result.layers as Layer[]
  if (!Array.isArray(layers) || layers.length < 2 || layers.length > 17 || layers.some(layer => !layer.image || !/^https:\/\//.test(layer.image.url) || !Number.isInteger(layer.z_index)))
    throw new Error('Invalid image layer result')
  const ordered = [...layers].sort((a, b) => a.z_index - b.z_index)
  if (ordered[0]!.z_index !== 0 || new Set(ordered.map(layer => layer.z_index)).size !== layers.length)
    throw new Error('Missing base layer or duplicate layer order')
  const base = ordered[0]!.image
  const width = Number(base.width) || undefined
  const height = Number(base.height) || undefined
  return { layers: ordered, width, height, urls: ordered.map(layer => layer.image.url) }
}
