export interface SchemaProperty {
  'type'?: string | string[]
  'description'?: string
  'enum'?: Array<string | number>
  'default'?: unknown
  'minimum'?: number
  'maximum'?: number
  'minItems'?: number
  'maxItems'?: number
  'minLength'?: number
  'maxLength'?: number
  'disabled'?: boolean
  'x-placeholder'?: string
  'x-ui-component'?: string
  'x-label'?: string
  'x-accept'?: string
  'x-max-bytes'?: number
  'x-min-seconds'?: number
  'x-max-seconds'?: number
  'x-max-total-seconds'?: number
  'items'?: SchemaProperty
}

export interface ModelInputSchema {
  'properties': Record<string, SchemaProperty>
  'required'?: string[]
  'x-order-properties'?: string[]
}

export interface ModelOpenAPISchema {
  components: {
    schemas: {
      Input: ModelInputSchema
    }
  }
}

export type FieldPlacement = 'primary' | 'toolbar' | 'advanced' | 'hidden'
export type FieldWidget = 'textarea' | 'upload' | 'select' | 'radio' | 'number' | 'switch' | 'text'

export interface FieldConfig {
  key: string
  label: string
  description?: string
  required: boolean
  placement: FieldPlacement
  widget: FieldWidget
  property: SchemaProperty
}

export type AiCategory = 'Image' | 'Video' | 'Tools'
export type AiTask
  = | 'Text to Image'
    | 'Image to Image'
    | 'Text to Video'
    | 'Image to Video'
    | 'Reference to Video'
    | 'Remove Background'
    | 'Split Image Layers'
    | 'Edit Image Text'

export interface AiModelConfig {
  id: string
  name: string
  category: AiCategory
  task: AiTask

  icon?: string
  schema: ModelOpenAPISchema
}

export type AiFormValues = Record<string, unknown>
