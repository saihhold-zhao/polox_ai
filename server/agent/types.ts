import type { ImageTextEdit, ImageTextLine } from '~~/shared/utils/imageTextEditor'

export const GPT_IMAGE_2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21',
] as const

export const GPT_IMAGE_2_RESOLUTIONS = ['1K', '2K', '4K'] as const

export const SEEDANCE_2_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
  'adaptive',
] as const

export const SEEDANCE_2_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const
export const SEEDANCE_2_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export const SEEDANCE_25_ASPECT_RATIOS = [
  'adaptive',
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
] as const

export const SEEDANCE_25_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const SEEDANCE_25_DURATIONS = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const

export const AGENT_VIDEO_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 25, 30] as const
export const AGENT_QUALITIES = ['high', 'economy', 'hobby', 'custom'] as const
export const AGENT_CONFIRM_POLICIES = ['auto', 'when_needed', 'always'] as const
export const VIDEO_FAMILIES = ['seedance-2', 'seedance-2-5', 'wan-3'] as const

export const WAN_30_ASPECT_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
export const WAN_30_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const WAN_30_DURATIONS = Array.from({ length: 29 }, (_, index) => index + 2) as number[]

export const UNCERTAIN_FIELDS = ['prompt', 'aspect_ratio', 'resolution', 'duration'] as const

export type GptImage2AspectRatio = typeof GPT_IMAGE_2_ASPECT_RATIOS[number]
export type GptImage2Resolution = typeof GPT_IMAGE_2_RESOLUTIONS[number]
export type Seedance2AspectRatio = typeof SEEDANCE_2_ASPECT_RATIOS[number]
export type Seedance2Resolution = typeof SEEDANCE_2_RESOLUTIONS[number]
export type Seedance2Duration = typeof SEEDANCE_2_DURATIONS[number]
export type Seedance25AspectRatio = typeof SEEDANCE_25_ASPECT_RATIOS[number]
export type Seedance25Resolution = typeof SEEDANCE_25_RESOLUTIONS[number]
export type Seedance25Duration = typeof SEEDANCE_25_DURATIONS[number]
export type Wan30AspectRatio = typeof WAN_30_ASPECT_RATIOS[number]
export type Wan30Resolution = typeof WAN_30_RESOLUTIONS[number]
export type AgentQuality = typeof AGENT_QUALITIES[number]
export type AgentConfirmPolicy = typeof AGENT_CONFIRM_POLICIES[number]
export type VideoFamily = typeof VIDEO_FAMILIES[number]
export type UncertainField = typeof UNCERTAIN_FIELDS[number]

export interface GenerateImageArgs {
  name?: string
  prompt: string
  aspect_ratio: GptImage2AspectRatio
  resolution: GptImage2Resolution
  input_urls: string[]
  uncertain_fields: UncertainField[]
  reason: string
}

export interface RemoveBackgroundArgs {
  image_url: string
}

export interface ResolvedRemoveBackground {
  image_url: string
  prompt: string
  aspectRatio: string
  resolution: string
}

export interface GenerateVideoArgs {
  name?: string
  prompt: string
  aspect_ratio: Seedance2AspectRatio
  resolution: Seedance2Resolution
  duration: number
  generate_audio: boolean
  family: VideoFamily
  first_frame: string
  last_frame: string
  reference_images: string[]
  reference_videos: string[]
  uncertain_fields: UncertainField[]
}

export interface ConcatVideoArgs {
  video_urls: string[]
}

export interface ResolvedGenerateVideo {
  name?: string
  prompt: string
  aspect_ratio: Seedance2AspectRatio
  resolution: Seedance2Resolution
  duration: number
  generate_audio: boolean
  family: VideoFamily
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls?: string[]
  reference_video_urls?: string[]
  uncertain_fields?: UncertainField[]
}

export type AgentImageKind = 'still' | 'cutout' | 'upload' | 'video'

export interface AgentImage {
  modelId?: string
  modelInput?: Record<string, unknown>
  name?: string
  id: string
  kind?: AgentImageKind
  status: 'generating' | 'success' | 'fail'
  prompt: string
  aspectRatio: string
  resolution: string
  url: string
  error: string
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: VideoFamily
  providerTaskId?: string
}

export interface ConfirmationPayload {
  jobs?: Array<{
    id: string
    name: string
    modelName: string
    task: string
    inputUrls: string[]
    params: ConfirmationPayload['params']
  }>
  id: string
  kind: 'image' | 'video' | 'cutout' | 'mixed'
  reason: string
  uncertainFields: string[]
  count: number

  modelName?: string
  task?: string
  inputUrls?: string[]
  approvedBy?: 'agent' | 'user'
  params: {
    modelId?: string
    modelInput?: Record<string, unknown>
    prompt: string
    aspectRatio: string
    resolution: string
    duration?: number
    videoMode?: 'text' | 'image' | 'reference'
    videoFamily?: VideoFamily
  }
}

export interface ChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}

export interface ChoiceQuestion {
  id: string
  title?: string
  prompt: string
  options: ChoiceOption[]
  recommendedId?: string
}

export interface ChoicePayload {
  textEdits?: ImageTextEdit[]
  textEdit?: ImageTextEdit
  id: string
  prompt: string
  recommendation?: string
  questions: ChoiceQuestion[]
}

export interface ChoiceAnswer {
  imageSelections?: { imageUrl: string, regions: number[][] }[]
  textEdits?: ImageTextEdit[]
  textLines?: ImageTextLine[]
  imageUrl?: string
  regions?: number[][]
  questionId: string
  optionId?: string
  label?: string
  text?: string
  skipped?: boolean
}

export interface AskUserArgs {
  textEdits?: ImageTextEdit[]
  textEdit?: ImageTextEdit
  prompt: string
  recommendation: string
  questions: ChoiceQuestion[]
}

export type AgentEvent
  = | { type: 'session', sessionId: string }

    | { type: 'text', delta: string }
    | { type: 'text_replace', delta: string }
    | { type: 'status', status: 'thinking' | 'calling_tool' | 'generating' | 'queued' | 'idle' }
    | { type: 'title', title: string }
    | { type: 'queue', limit: number, active: number, message: string }
    | { type: 'tool', name: string, status: 'start' | 'end', callId: string }
    | { type: 'confirmation', confirmation: ConfirmationPayload }
    | { type: 'choice', choice: ChoicePayload }
    | { type: 'image', image: AgentImage, replay?: boolean }
    | { type: 'error', message: string, remaining?: number, required?: number }
    | { type: 'done' }

export type UserContentPart
  = | { type: 'text', text: string }
    | { type: 'image_url', image_url: { url: string } }

export interface ChatMessage {
  /** Stable public-history identity; excluded from provider requests. */
  historyId?: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | UserContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /** LLM-only turn; never surface in the chat UI transcript. */
  internal?: boolean
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ConfirmBody {
  confirmationId: string
  action: 'confirm' | 'cancel' | 'abort'
  params?: {
    prompt?: string
    aspectRatio?: string
    resolution?: string
    duration?: number
  }
}

export interface ChoiceBody {
  choiceId: string
  action: 'submit' | 'skip'
  answers?: ChoiceAnswer[]
}
