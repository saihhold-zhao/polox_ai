import Ajv from 'ajv'
import { FAL_ENDPOINTS } from '~~/shared/constants/falEndpoints'
import { falInputSchema } from '~~/shared/utils/falSchema'
import { flux3FalEndpoint, isFlux3GenerateModel } from '~~/shared/utils/flux3'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
const validators = new Map<string, ReturnType<typeof ajv.compile>>()
export function falEndpoint(model: string, input: Record<string, unknown> = {}) {
  if (isImageLayerSplitterModel(model))
    return 'bytedance/seedream/v5/pro/layerize'
  if (isFlux3GenerateModel(model))
    return flux3FalEndpoint(model, input)
  return FAL_ENDPOINTS[model] || model
}
export function legacyImageSize(ratio: string, resolution = '1K') {
  if (!ratio || ratio === 'auto' || ratio === 'adaptive')
    return 'auto'
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h)
    return 'auto'
  const edge = resolution === '4K' ? 4096 : resolution === '2K' ? 2048 : 1024
  const factor = edge / Math.sqrt(w * h)
  return { width: Math.round(w * factor / 16) * 16, height: Math.round(h * factor / 16) * 16 }
}
export function sanitizeFalInput(model: string, raw: Record<string, unknown>) {
  const endpoint = falEndpoint(model, raw)
  const schema = falInputSchema(model)
  if (!schema)
    throw createError({ statusCode: 400, statusMessage: 'Unknown model' })
  const input = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)))
  const properties = schema.properties
  const rename = (old: string, key: string) => {
    if (input[old] !== undefined && !(old in properties) && key in properties) {
      input[key] ??= input[old]
      delete input[old]
    }
  }
  rename('input_urls', 'image_urls')
  rename('image_input', 'image_urls')
  rename('first_frame_url', endpoint.startsWith('alibaba/') ? 'start_image_url' : 'image_url')
  rename('last_frame_url', 'end_image_url')
  rename('reference_image_urls', 'image_urls')
  rename('reference_video_urls', 'video_urls')
  rename('reference_audio_urls', 'audio_urls')
  if (endpoint.startsWith('openai/') && !input.image_size && input.aspect_ratio)
    input.image_size = legacyImageSize(String(input.aspect_ratio), String(input.resolution || '1K'))
  if (endpoint.startsWith('bytedance/seedream/') && !input.image_size)
    input.image_size = input.quality === 'basic' ? 'auto_1K' : 'auto_2K'
  if ('image_size' in properties) {
    delete input.aspect_ratio
    delete input.resolution
    if (endpoint.startsWith('bytedance/'))
      delete input.quality
  }
  if (endpoint.startsWith('bytedance/seedance-')) {
    if (typeof input.duration === 'number')
      input.duration = String(input.duration)
    if (input.aspect_ratio === 'adaptive')
      input.aspect_ratio = 'auto'
  }
  if (endpoint.startsWith('alibaba/')) {
    if (typeof input.resolution === 'string')
      input.resolution = input.resolution.toLowerCase()
    rename('generate_audio', 'audio')
  }
  for (const key of ['watermark', 'web_search', 'return_last_frame', '_textEdit']) delete input[key]
  for (const [key, prop] of Object.entries(properties) as [string, any][]) {
    if ((key.endsWith('_url') || key.endsWith('_urls')) && Array.isArray(input[key]) && !(input[key] as unknown[]).length)
      delete input[key]
    if (key.endsWith('_url') && Array.isArray(input[key]))
      input[key] = (input[key] as unknown[])[0]
    if (input[key] === undefined && prop.default !== undefined)
      input[key] = prop.default
    if (input[key] === '' && !schema.required?.includes(key))
      delete input[key]
  }
  // Queued jobs must return durable URLs rather than inline data.
  if ('sync_mode' in properties)
    input.sync_mode = false
  delete input.end_user_id
  let validate = validators.get(endpoint)
  if (!validate) {
    validate = ajv.compile(schema)
    validators.set(endpoint, validate)
  }
  if (!validate(input))
    throw createError({ statusCode: 400, statusMessage: ajv.errorsText(validate.errors, { separator: '; ' }) })
  for (const [key, value] of Object.entries(input)) {
    if (!key.endsWith('_url') && !key.endsWith('_urls'))
      continue
    for (const url of Array.isArray(value) ? value : [value]) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
        throw createError({ statusCode: 400, statusMessage: `${key} must contain HTTP URLs` })
    }
  }
  return input
}
