import type {
  AgentImage,
  AskUserArgs,
  ChoiceOption,
  ChoiceQuestion,
  ConcatVideoArgs,
  GenerateImageArgs,
  GenerateVideoArgs,
  RemoveBackgroundArgs,
  ResolvedGenerateVideo,
  ResolvedRemoveBackground,
  UncertainField,
  VideoFamily,
} from './types'
import { withCustomChoiceOption } from '~~/shared/utils/agentChoices'
import { exportZipTool } from './exportZip'
import { gptImage2ComboError, isGptImage2AspectRatio, isGptImage2Resolution } from './gptImage2'
import { isSeedance2AspectRatio, isSeedance2Resolution } from './seedance2'
import { AGENT_VIDEO_DURATIONS, GPT_IMAGE_2_ASPECT_RATIOS, GPT_IMAGE_2_RESOLUTIONS, SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_RESOLUTIONS, UNCERTAIN_FIELDS } from './types'

export const GENERATE_IMAGE_TOOL = 'generate_image'
export const REMOVE_BACKGROUND_TOOL = 'remove_background'
export const GENERATE_VIDEO_TOOL = 'generate_video'
export const CONCAT_VIDEO_TOOL = 'concat_videos'
export const ASK_USER_TOOL = 'ask_user'
export const MAX_CONCAT_CLIPS = 20
export const MAX_ASK_QUESTIONS = 6
export const MAX_ASK_OPTIONS = 8

export const openAiTools = [
  exportZipTool,
  {
    type: 'function',
    function: {
      name: GENERATE_IMAGE_TOOL,
      description: 'Generate or edit one still with GPT Image 2. Call once per image. For several images, call it several times in the SAME turn. To edit, pass input_urls (uploaded stills, previous results, or "latest"). Omit input_urls for text-to-image.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Required short story/action title in the user preferred conversation language, e.g. Shot 6 · Hiding in the cave. English request means English title, including image-to-video. Do not copy the language of source asset names, tool output, or internal examples; translate descriptive titles when reusing them. Include what happens, not just shot_6. Use the actual storyboard number; never reuse a number for a different scene.' },
          prompt: {
            type: 'string',
            description: 'Detailed English prompt describing the image or the edit.',
          },
          aspect_ratio: {
            type: 'string',
            enum: [...GPT_IMAGE_2_ASPECT_RATIOS],
            description: 'Output aspect ratio. Use auto when editing unless the user asked for a specific crop.',
          },
          resolution: {
            type: 'string',
            enum: [...GPT_IMAGE_2_RESOLUTIONS],
            description: 'Output resolution. The runtime overwrites this from the quality preference (Economy = 1K, High quality = 2K).',
          },
          input_urls: {
            type: 'array',
            description: 'Reference stills to edit. Public HTTP URLs, session image ids, or "latest". Empty or omitted means text-to-image. Up to 16.',
            items: { type: 'string' },
          },
          uncertain_fields: {
            type: 'array',
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves. This does not start generation by itself.',
            items: {
              type: 'string',
              enum: [...UNCERTAIN_FIELDS],
            },
          },
          reason: {
            type: 'string',
            description: 'Optional one-sentence hint shown on the confirmation card.',
          },
        },
        required: ['name', 'prompt', 'aspect_ratio', 'resolution', 'uncertain_fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: REMOVE_BACKGROUND_TOOL,
      description: 'Remove the background from one still and return a transparent PNG. Call once per image. If the user wants several cutouts, call it several times in the SAME turn. Use a public HTTP URL from a previous result or upload, or "latest".',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          image_url: {
            type: 'string',
            description: 'Public HTTP URL of the image, a session image id, or "latest" for the most recent successful still in this session.',
          },
        },
        required: ['image_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GENERATE_VIDEO_TOOL,
      description: 'Generate one video. Use first_frame to animate ONE still (image-to-video). Use reference_images / reference_videos for reference-to-video: compose a new clip from several references, or edit an existing clip by putting it in reference_videos and describing the change in the prompt (optional reference_images to replace a person or object). Omit both only for text-to-video. Call once per video. The runtime picks the video family from the quality preference. A confirmation card is always recorded; generation may auto-approve from the user\'s generation confirmation.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Required short story/action title in the user preferred conversation language, e.g. Shot 6 · Hiding in the cave. English request means English title, including image-to-video. Do not copy the language of source asset names, tool output, or internal examples; translate descriptive titles when reusing them. Include what happens, not just shot_6. Use the actual storyboard number; never reuse a number for a different scene.' },
          prompt: {
            type: 'string',
            description: 'Write motion and production instructions in English: subject, camera, atmosphere. Keep quoted dialogue, narration, and lyrics in the user-selected spoken language; do not translate those lines into English unless English was selected. For speech or singing, explicitly state the selected spoken language and quote the actual lines in that language. Preserve that language across shots and retries. At least 3 characters. For reference-to-video, say how to use the references (character, product, first/last frame if needed). For a video edit, describe what to change in the source clip and which still replaces whom.',
          },
          first_frame: {
            type: 'string',
            description: 'Start frame for image-to-video: public HTTP URL, session image id, or "latest". Empty means not image-to-video. Do not set this when using reference_images.',
          },
          last_frame: {
            type: 'string',
            description: 'Optional end frame URL, session image id, or empty. Image-to-video only.',
          },
          reference_images: {
            type: 'array',
            description: 'Reference stills for reference-to-video (character, product, style). Public HTTP URLs, session image ids, or "latest". Up to 30; the runtime trims to the active model limit. Do not set first_frame when using this.',
            items: { type: 'string' },
          },
          reference_videos: {
            type: 'array',
            description: 'Reference clips for reference-to-video. Put the source clip here when editing a video. Public HTTP URLs, session video ids, or "latest". Up to 10; the runtime trims to the active model limit.',
            items: { type: 'string' },
          },
          aspect_ratio: {
            type: 'string',
            enum: [...SEEDANCE_2_ASPECT_RATIOS],
            description: 'Image-to-video: always adaptive. Reference-to-video or text-to-video: 16:9 unless the user named a ratio. Default adaptive for image-to-video, 16:9 otherwise.',
          },
          resolution: {
            type: 'string',
            enum: [...SEEDANCE_2_RESOLUTIONS],
            description: 'Use 480p unless the user named 720p, 1080p, or 4k. Seedance 2.5 has no 4k (runtime maps it to 1080p). Default 480p.',
          },
          duration: {
            type: 'integer',
            enum: [...AGENT_VIDEO_DURATIONS],
            description: 'Length in seconds. Economy / Seedance 2.0: 4-15. High quality / Seedance 2.5: 4, 5, 6, 8, 10, 12, 15, 20, 25, or 30. Default 5.',
          },
          generate_audio: {
            type: 'boolean',
            description: 'Whether to generate synchronized audio. Default true.',
          },
          uncertain_fields: {
            type: 'array',
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves.',
            items: {
              type: 'string',
              enum: [...UNCERTAIN_FIELDS],
            },
          },
        },
        required: ['name', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: CONCAT_VIDEO_TOOL,
      description: 'Concatenate existing clips into one longer video with ffmpeg. Use after a storyboard of short Seedance clips. Pass the clip URLs or session video ids in story order. Do not mix with generate_video in the same turn. ',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          video_urls: {
            type: 'array',
            description: 'Clips in story order. Public HTTP URLs or session video ids. At least 2, at most 20. Do not use "latest".',
            items: { type: 'string' },
          },
        },
        required: ['video_urls'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: ASK_USER_TOOL,
      description: 'Show clickable choice cards in chat when you need a discrete pick (style, ratio, character, confirm a plan, yes/no). Do not list the options in markdown — the card shows them. Skip is always on the card so they can let you decide. Always include an Other option with allow_custom: true for every question so the user can type their own answer. Do not mix with generation tools or concat_videos in the same turn. After they answer, continue from the tool result.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: {
            type: 'string',
            description: 'Short intro above the cards, in the user\'s preferred language. Do not list the options here.',
          },
          recommendation: {
            type: 'string',
            description: 'In the user\'s preferred language, what you will do if they skip. Shown as a hint on the card.',
          },
          questions: {
            type: 'array',
            description: 'One or more related questions. Prefer one call with several questions over several calls.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: {
                  type: 'string',
                  description: 'Stable id for this question, e.g. style or aspect_ratio.',
                },
                title: {
                  type: 'string',
                  description: 'Optional short section label, in the user\'s preferred language, e.g. Visual style.',
                },
                prompt: {
                  type: 'string',
                  description: 'The question, in the user\'s preferred language.',
                },
                recommended: {
                  type: 'string',
                  description: 'Option id you would pick if they skip this question.',
                },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string', description: 'User-facing option label in the user\'s preferred language.' },
                      description: { type: 'string', description: 'User-facing option description in the user\'s preferred language.' },
                      allow_custom: {
                        type: 'boolean',
                        description: 'If true, selecting this option shows a text field. Use for Other.',
                      },
                    },
                    required: ['id', 'label'],
                  },
                },
              },
              required: ['id', 'prompt', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
]

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value) && !value.toLowerCase().startsWith('blob:')
}

function isStillAsset(image: AgentImage) {
  return image.status === 'success' && isHttpUrl(image.url) && image.kind !== 'video'
}

export function latestStill(images: AgentImage[]) {
  return images.find(isStillAsset)
}

export function resolveSessionUrl(token: string, images: AgentImage[], label: string) {
  const value = token.trim()
  const latest = latestStill(images)
  const useLatest = !value || /^(latest|last|newest)$/i.test(value)
  if (useLatest) {
    if (!latest)
      throw new Error(`No still in this session for ${label}. Generate or upload an image first, or pass a public HTTP URL.`)
    return latest
  }

  const byId = images.find(item => (item.id === value || item.name === value) && isStillAsset(item))
  if (byId)
    return byId

  if (!isHttpUrl(value))
    throw new Error(`${label} must be a public HTTP URL, a session image id, or "latest"`)

  const byUrl = images.find(item => item.url === value && isStillAsset(item))
  return byUrl || {
    id: '',
    kind: 'still' as const,
    status: 'success' as const,
    prompt: '',
    aspectRatio: 'auto',
    resolution: '',
    url: value,
    error: '',
  }
}

export function parseGenerateImageArgs(raw: string): GenerateImageArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('generate_image arguments were not valid JSON')
  }

  const prompt = asString(parsed.prompt)
  if (!prompt)
    throw new Error('prompt is required')
  if (prompt.length > 20_000)
    throw new Error('prompt must be 20000 characters or fewer')

  const aspectRatio = asString(parsed.aspect_ratio) || '1:1'
  if (!isGptImage2AspectRatio(aspectRatio))
    throw new Error(`Invalid aspect_ratio: ${aspectRatio}`)

  const resolution = asString(parsed.resolution) || '1K'
  if (!isGptImage2Resolution(resolution))
    throw new Error(`Invalid resolution: ${resolution}`)

  const comboError = gptImage2ComboError(aspectRatio, resolution)
  if (comboError)
    throw new Error(comboError)

  const uncertain = Array.isArray(parsed.uncertain_fields)
    ? parsed.uncertain_fields
        .filter((item): item is UncertainField => typeof item === 'string' && (UNCERTAIN_FIELDS as readonly string[]).includes(item))
    : []

  const inputTokens = Array.isArray(parsed.input_urls)
    ? parsed.input_urls.map(item => asString(item)).filter(Boolean)
    : []
  if (inputTokens.length > 16)
    throw new Error('A maximum of 16 reference images is allowed')

  return {
    name: asString(parsed.name).slice(0, 100),
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
    input_urls: inputTokens,
    uncertain_fields: uncertain,
    reason: asString(parsed.reason),
  }
}

export function resolveGenerateImageArgs(args: GenerateImageArgs, images: AgentImage[]): GenerateImageArgs {
  if (!args.input_urls.length)
    return args
  return {
    ...args,
    input_urls: args.input_urls.map(token => resolveSessionUrl(token, images, 'input_urls').url),
  }
}

export function parseRemoveBackgroundArgs(raw: string): RemoveBackgroundArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('remove_background arguments were not valid JSON')
  }

  const imageUrl = asString(parsed.image_url)
  if (imageUrl.length > 2048)
    throw new Error('image_url is too long')

  return { image_url: imageUrl || 'latest' }
}

function fromSessionImage(image: AgentImage): ResolvedRemoveBackground {
  const prompt = image.kind === 'cutout'
    ? (image.prompt || 'Background removed')
    : (image.prompt ? `Cutout · ${image.prompt}` : 'Background removed')
  return {
    image_url: image.url,
    prompt,
    aspectRatio: image.aspectRatio || 'auto',
    resolution: image.resolution || '',
  }
}

export function resolveRemoveBackgroundSource(
  args: RemoveBackgroundArgs,
  images: AgentImage[],
): ResolvedRemoveBackground {
  const source = resolveSessionUrl(args.image_url, images, 'image_url')
  if (source.id)
    return fromSessionImage(source)
  return {
    image_url: source.url,
    prompt: 'Background removed',
    aspectRatio: 'auto',
    resolution: '',
  }
}

function asStringList(value: unknown, max: number, label: string) {
  if (!Array.isArray(value))
    return []
  const list = value.map(item => asString(item)).filter(Boolean)
  if (list.length > max)
    throw new Error(`${label} allows at most ${max} items`)
  return list
}

function isVideoAsset(image: AgentImage) {
  return image.status === 'success' && isHttpUrl(image.url) && image.kind === 'video'
}

export function latestVideo(images: AgentImage[]) {
  return images.find(isVideoAsset)
}

export function resolveSessionVideo(token: string, images: AgentImage[], label: string) {
  const value = token.trim()
  const latest = latestVideo(images)
  const useLatest = !value || /^(latest|last|newest)$/i.test(value)
  if (useLatest) {
    if (!latest)
      throw new Error(`No video in this session for ${label}. Generate a clip first, or pass a public HTTP URL.`)
    return latest
  }

  const byId = images.find(item => (item.id === value || item.name === value) && isVideoAsset(item))
  if (byId)
    return byId

  if (!isHttpUrl(value))
    throw new Error(`${label} must be a public HTTP URL, a session video id, or "latest"`)

  const byUrl = images.find(item => item.url === value && isVideoAsset(item))
  return byUrl || {
    id: '',
    kind: 'video' as const,
    status: 'success' as const,
    prompt: '',
    aspectRatio: 'auto',
    resolution: '',
    url: value,
    error: '',
  }
}

export function parseGenerateVideoArgs(raw: string): GenerateVideoArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('generate_video arguments were not valid JSON')
  }

  const prompt = asString(parsed.prompt)
  if (!prompt)
    throw new Error('prompt is required')
  if (prompt.length < 3)
    throw new Error('prompt must be at least 3 characters')
  if (prompt.length > 30_000)
    throw new Error('prompt must be 30000 characters or fewer')

  const firstFrame = asString(parsed.first_frame) || asString(parsed.first_frame_url)
  const lastFrame = asString(parsed.last_frame) || asString(parsed.last_frame_url)
  const referenceImages = asStringList(parsed.reference_images ?? parsed.reference_image_urls, 30, 'reference_images')
  const referenceVideos = asStringList(parsed.reference_videos ?? parsed.reference_video_urls, 10, 'reference_videos')
  const hasRefs = Boolean(referenceImages.length || referenceVideos.length)
  const aspectRatio = asString(parsed.aspect_ratio) || (firstFrame && !hasRefs ? 'adaptive' : '16:9')
  if (!isSeedance2AspectRatio(aspectRatio))
    throw new Error(`Invalid aspect_ratio: ${aspectRatio}`)

  const resolutionRaw = asString(parsed.resolution) === '4K' ? '4k' : (asString(parsed.resolution) || '480p')
  if (!isSeedance2Resolution(resolutionRaw))
    throw new Error('resolution must be 480p, 720p, 1080p, or 4k')

  const duration = Math.floor(Number(parsed.duration ?? 5))
  if (!Number.isInteger(duration) || duration < 2 || duration > 30)
    throw new Error('duration must be 2-30 seconds')

  const family: VideoFamily = parsed.family === 'seedance-2-5'
    ? 'seedance-2-5'
    : parsed.family === 'wan-3'
      ? 'wan-3'
      : 'seedance-2'
  const uncertain = Array.isArray(parsed.uncertain_fields)
    ? parsed.uncertain_fields
        .filter((item): item is UncertainField => typeof item === 'string' && (UNCERTAIN_FIELDS as readonly string[]).includes(item))
    : []

  return {
    name: asString(parsed.name).slice(0, 100),
    prompt,
    aspect_ratio: aspectRatio,
    resolution: resolutionRaw,
    duration,
    generate_audio: parsed.generate_audio !== false,
    family,
    first_frame: firstFrame,
    last_frame: lastFrame,
    reference_images: referenceImages,
    reference_videos: referenceVideos,
    uncertain_fields: uncertain,
  }
}

export function resolveGenerateVideoArgs(args: GenerateVideoArgs, images: AgentImage[]): ResolvedGenerateVideo {
  const resolved: ResolvedGenerateVideo = {
    name: args.name,
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    resolution: args.resolution,
    duration: args.duration,
    generate_audio: args.generate_audio,
    family: args.family,
    uncertain_fields: args.uncertain_fields,
  }

  const referenceImages = args.reference_images.map(token => resolveSessionUrl(token, images, 'reference_images').url)
  const referenceVideos = args.reference_videos.map(token => resolveSessionVideo(token, images, 'reference_videos').url)

  if (referenceImages.length || referenceVideos.length) {
    if (referenceImages.length)
      resolved.reference_image_urls = referenceImages
    if (referenceVideos.length)
      resolved.reference_video_urls = referenceVideos
    return resolved
  }

  if (args.first_frame) {
    const first = resolveSessionUrl(args.first_frame, images, 'first_frame')
    resolved.first_frame_url = first.url
    resolved.aspect_ratio = 'adaptive'
  }

  if (args.last_frame)
    resolved.last_frame_url = resolveSessionUrl(args.last_frame, images, 'last_frame').url

  return resolved
}

export function parseConcatVideoArgs(raw: string): ConcatVideoArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('concat_videos arguments were not valid JSON')
  }

  const tokens = asStringList(parsed.video_urls ?? parsed.urls, MAX_CONCAT_CLIPS, 'video_urls')
  if (tokens.length < 2)
    throw new Error('concat_videos needs at least two clips, in story order')
  if (tokens.some(token => /^(latest|last|newest)$/i.test(token)))
    throw new Error('concat_videos cannot use "latest"; pass each clip URL or session id in order')

  return { video_urls: tokens }
}

export function resolveConcatVideoUrls(args: ConcatVideoArgs, images: AgentImage[]) {
  return args.video_urls.map((token, index) => resolveSessionVideo(token, images, `video_urls[${index}]`).url)
}

const CUSTOM_OPTION_RE = /^(other|custom|其他|其它|自定义)\b/i

function clipAsk(value: unknown, max: number) {
  return asString(value).slice(0, max)
}

function optionAllowsCustom(id: string, label: string, flag: unknown) {
  if (flag === true)
    return true
  return CUSTOM_OPTION_RE.test(id) || CUSTOM_OPTION_RE.test(label)
}

function parseAskOption(raw: unknown, index: number, seen: Set<string>): ChoiceOption | null {
  if (!raw || typeof raw !== 'object')
    return null
  const row = raw as Record<string, unknown>
  const label = clipAsk(row.label ?? row.title ?? row.text, 120)
  if (!label)
    return null
  const id = clipAsk(row.id ?? row.value, 64) || `opt_${index + 1}`
  const unique = seen.has(id) ? `${id}_${index + 1}` : id
  seen.add(unique)
  const description = clipAsk(row.description ?? row.hint, 200)
  const custom = optionAllowsCustom(unique, label, row.allow_custom ?? row.allowCustom ?? row.custom)
  return {
    id: unique,
    label,
    ...(description ? { description } : {}),
    ...(custom ? { custom: true } : {}),
  }
}

function parseAskQuestion(raw: unknown, index: number, seen: Set<string>): ChoiceQuestion | null {
  if (!raw || typeof raw !== 'object')
    return null
  const row = raw as Record<string, unknown>
  const prompt = clipAsk(row.prompt ?? row.question ?? row.label, 280)
  if (!prompt)
    return null
  const optionSeen = new Set<string>()
  const source = Array.isArray(row.options) ? row.options : []
  const options: ChoiceOption[] = []
  for (const [optionIndex, item] of source.entries()) {
    if (options.length >= MAX_ASK_OPTIONS)
      break
    const option = parseAskOption(item, optionIndex, optionSeen)
    if (option)
      options.push(option)
  }
  if (!options.length)
    return null
  const id = clipAsk(row.id, 64) || `q_${index + 1}`
  const unique = seen.has(id) ? `${id}_${index + 1}` : id
  seen.add(unique)
  const title = clipAsk(row.title, 80)
  const recommendedRaw = clipAsk(row.recommended ?? row.recommended_id ?? row.recommendedId, 64)
  const recommendedId = options.some(item => item.id === recommendedRaw) ? recommendedRaw : undefined
  return {
    id: unique,
    prompt,
    options: withCustomChoiceOption(options),
    ...(title ? { title } : {}),
    ...(recommendedId ? { recommendedId } : {}),
  }
}

export function parseAskUserArgs(raw: string): AskUserArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('ask_user arguments were not valid JSON')
  }

  const source = Array.isArray(parsed.questions)
    ? parsed.questions
    : parsed.question
      ? [parsed.question]
      : []
  const seen = new Set<string>()
  const questions: ChoiceQuestion[] = []
  for (const [index, item] of source.entries()) {
    if (questions.length >= MAX_ASK_QUESTIONS)
      break
    const question = parseAskQuestion(item, index, seen)
    if (question)
      questions.push(question)
  }
  if (!questions.length)
    throw new Error('ask_user needs at least one question with options')

  return {
    prompt: clipAsk(parsed.prompt ?? parsed.intro, 400),
    recommendation: clipAsk(parsed.recommendation ?? parsed.hint, 400),
    questions,
  }
}
