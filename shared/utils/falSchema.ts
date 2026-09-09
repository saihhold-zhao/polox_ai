import type { ModelOpenAPISchema, SchemaProperty } from '../types/aiModel'
import { FAL_ENDPOINTS } from '../constants/falEndpoints'
import schemas from '../constants/falSchemas.json'

export function falInputSchema(model: string): Record<string, any> | undefined {
  return (schemas as Record<string, any>)[FAL_ENDPOINTS[model] || model]
}
export function falFormSchema(model: string): ModelOpenAPISchema | undefined {
  const input = falInputSchema(model)
  if (!input)
    return undefined
  const properties: Record<string, SchemaProperty> = {}
  for (const [key, raw] of Object.entries(input.properties) as [string, Record<string, any>][]) {
    if (key === 'end_user_id')
      continue
    const variant = raw.anyOf?.find((item: any) => item.type === 'string') || raw.anyOf?.find((item: any) => item.type !== 'null')
    const prop = { ...raw, ...variant }
    delete prop.anyOf
    delete prop.properties
    delete prop.required
    if (key === 'prompt')
      prop['x-ui-component'] = 'textarea'
    if (key.endsWith('_url') || key.endsWith('_urls')) {
      prop['x-ui-component'] = 'uploaders'
      prop['x-accept'] = key.includes('video') ? 'video/mp4,video/webm,video/quicktime' : key.includes('audio') ? 'audio/*' : key.includes('pdf') ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/gif,image/avif'
    }
    if (key === 'sync_mode') {
      prop.default = false
      prop.disabled = true
      prop['x-ui-component'] = 'hidden'
    }
    if (key === 'enable_safety_checker') {
      prop.disabled = true
      prop['x-ui-component'] = 'hidden'
    }
    properties[key] = prop as SchemaProperty
  }
  const required = [...(input.required || [])]
  if (model.endsWith('-image-to-image') && !required.includes('image_urls'))
    required.push('image_urls')
  if (model === 'minimax-h3/image-to-video' && !required.includes('image_url'))
    required.push('image_url')
  return { components: { schemas: { Input: { properties, required, 'x-order-properties': ['prompt', ...Object.keys(properties).filter(key => key !== 'prompt')] } } } }
}
