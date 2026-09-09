import type {
  AiFormValues,
  FieldConfig,
  FieldPlacement,
  FieldWidget,
  ModelInputSchema,
  ModelOpenAPISchema,
  SchemaProperty,
} from '@/types/aiModel'

const TOOLBAR_FIELD_KEYS = new Set([
  'aspect_ratio',
  'resolution',
  'quality',
  'duration',
  'size',
  'image_size',
  'width',
  'height',
  'fps',
  'num_frames',
])

const AUTO_VALUE_FIELD_KEYS = new Set([
  'output_format',
])

export const UPLOAD_FIELD_LABELS: Record<string, string> = {
  images: 'Input image',
  image_urls: 'Input image',
  input_urls: 'Input image',
  image_input: 'Input image',
  image_url: 'Input image',
  start_image_url: 'First frame',
  end_image_url: 'Last frame',
  video_urls: 'Reference video',
  audio_urls: 'Reference audio',
  first_frame_url: 'First frame',
  last_frame_url: 'Last frame',
  reference_image_urls: 'Reference image',
  reference_video_urls: 'Reference video',
  reference_audio_urls: 'Reference audio',
}

function formatLabel(key: string, property?: SchemaProperty) {
  if (property?.['x-label'])
    return property['x-label']
  if (UPLOAD_FIELD_LABELS[key])
    return UPLOAD_FIELD_LABELS[key]

  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function resolvePropertyType(property: SchemaProperty) {
  if (Array.isArray(property.type))
    return property.type[0]

  return property.type
}

const UPLOAD_FIELD_KEYS = new Set([
  'images',
  'image_urls',
  'input_urls',
  'image_input',
  'image_url',
  'first_frame_url',
  'last_frame_url',
  'reference_image_urls',
  'reference_video_urls',
  'reference_audio_urls',
])

function resolvePlacement(key: string, property: SchemaProperty): FieldPlacement {
  if (property.disabled || AUTO_VALUE_FIELD_KEYS.has(key))
    return 'hidden'

  if (key === 'prompt' || property['x-ui-component'] === 'uploaders' || UPLOAD_FIELD_KEYS.has(key))
    return 'primary'

  if (TOOLBAR_FIELD_KEYS.has(key))
    return 'toolbar'

  return 'advanced'
}

function resolveWidget(key: string, property: SchemaProperty, placement: FieldPlacement): FieldWidget {
  if (property['x-ui-component'] === 'uploaders' || UPLOAD_FIELD_KEYS.has(key))
    return 'upload'

  if (key === 'prompt')
    return 'textarea'

  const type = resolvePropertyType(property)

  if (type === 'boolean')
    return 'switch'

  if (type === 'integer' || type === 'number')
    return 'number'

  if (property.enum?.length) {
    if (placement === 'advanced' && property.enum.length <= 4)
      return 'radio'

    return 'select'
  }

  if (type === 'array')
    return 'upload'

  return 'text'
}

function resolveDefaultValue(key: string, property: SchemaProperty, widget: FieldWidget) {

  if (property.default !== undefined)
    return property.default

  if (widget === 'upload')
    return []

  if (widget === 'switch')
    return false

  if (widget === 'number')
    return property.minimum ?? 0

  if (widget === 'select' || widget === 'radio')
    return property.enum?.[0] ?? ''

  return ''
}

export function getInputSchema(schema: ModelOpenAPISchema): ModelInputSchema {
  return schema.components.schemas.Input
}

export function parseFieldConfigs(inputSchema: ModelInputSchema): FieldConfig[] {
  const order = inputSchema['x-order-properties'] ?? Object.keys(inputSchema.properties)

  return order
    .filter((key): key is string => Boolean(inputSchema.properties[key]))
    .map((key) => {
      const property = inputSchema.properties[key]!
      const placement = resolvePlacement(key, property)
      const widget = resolveWidget(key, property, placement)

      return {
        key,
        label: formatLabel(key, property),
        description: property.description,
        required: inputSchema.required?.includes(key) ?? false,
        placement: placement === 'hidden' ? 'hidden' as const : placement,
        widget: placement === 'hidden' ? 'text' as const : widget,
        property,
      }
    })
    .filter(field => field.placement !== 'hidden' || AUTO_VALUE_FIELD_KEYS.has(field.key))
}

export function createDefaultValues(fields: FieldConfig[]): AiFormValues {
  return Object.fromEntries(
    fields.map(field => [field.key, resolveDefaultValue(field.key, field.property, field.widget)]),
  )
}

export function mergePreservedValues(
  nextValues: AiFormValues,
  previousValues: AiFormValues,
  nextFields: FieldConfig[],
) {
  const merged = { ...nextValues }
  const nextFieldMap = new Map(nextFields.map(field => [field.key, field]))

  for (const [key, value] of Object.entries(previousValues)) {
    const field = nextFieldMap.get(key)
    if (!field)
      continue

    if (key === 'prompt' && typeof value === 'string' && value.trim())
      merged[key] = value

    if (field.widget === 'upload' && Array.isArray(value) && value.length)
      merged[key] = value
  }

  return merged
}

export function getFieldsByPlacement(fields: FieldConfig[], placement: FieldPlacement) {
  return fields.filter(field => field.placement === placement)
}

export function isFormValid(fields: FieldConfig[], values: AiFormValues) {
  return fields.every((field) => {
    if (!field.required)
      return true

    const value = values[field.key]

    if (field.widget === 'upload')
      return Array.isArray(value) && value.length > 0

    if (typeof value === 'string')
      return value.trim().length > 0

    return value !== undefined && value !== null && value !== ''
  })
}
