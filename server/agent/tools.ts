import { parseSkillCategoryInput, type SkillCategory } from '~~/shared/utils/skillCategory'
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
import { standaloneImageEditQuestions, withCustomChoiceOption } from '~~/shared/utils/agentChoices'
import { exportZipTool } from './exportZip'
import { measureVideoDurationTool } from './measureVideoDuration'
import { extractVideoFrameTool } from './extractVideoFrame'
import { documentTools } from './documentTools'
import { gptImage2ComboError, isGptImage2AspectRatio, isGptImage2Resolution } from './gptImage2'
import { isSeedance2AspectRatio, isSeedance2Resolution } from './seedance2'
import { SKETCH_QUESTIONS } from './sketchBrief'
import { AGENT_VIDEO_DURATIONS, GPT_IMAGE_2_ASPECT_RATIOS, GPT_IMAGE_2_RESOLUTIONS, SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_RESOLUTIONS, UNCERTAIN_FIELDS } from './types'
import { inspectWebsiteTool } from './websiteInspection'

export const GENERATE_IMAGE_TOOL = 'generate_image'
export const REMOVE_BACKGROUND_TOOL = 'remove_background'
export const GENERATE_VIDEO_TOOL = 'generate_video'
export const CONCAT_VIDEO_TOOL = 'concat_videos'
export { EXTRACT_VIDEO_FRAME_TOOL } from './extractVideoFrame'
export const ASK_USER_TOOL = 'ask_user'
export const REQUEST_VOICE_RECORDING_TOOL = 'request_voice_recording'
export const LOAD_SKILL_TOOL = 'load_skill'
export const SAVE_USER_SKILL_TOOL = 'save_user_skill'
export const CHECK_SKILL_ID_TOOL = 'check_skill_id'
export const EXIT_SKILL_CREATOR_TOOL = 'exit_skill_creator'
export const SET_SKILL_COVER_TOOL = 'set_skill_cover'
export const MAX_CONCAT_CLIPS = 20
export const MAX_ASK_QUESTIONS = 6
export const MAX_ASK_OPTIONS = 8

export const openAiTools = [
  inspectWebsiteTool,
  exportZipTool,
  measureVideoDurationTool,
  extractVideoFrameTool,
  ...documentTools,
  {
    type: 'function',
    function: {
      name: GENERATE_IMAGE_TOOL,
      description: 'Generate or edit one still. Text-to-image uses GPT Image 2; edits with input_urls use GPT Image 2.5 Sunburst Image to Image. Call once per image. For several images, call it several times in the SAME turn. To edit, pass input_urls (uploaded stills, previous results, or "latest"). Omit input_urls for text-to-image.',
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
            description: 'Output aspect ratio. Use auto when editing unless the user asked for a specific crop. Combination limits: auto only supports 1K; 1:1 cannot use 4K; 5:4, 4:5, 3:1, 1:3, 9:21 only support 1K.',
          },
          resolution: {
            type: 'string',
            enum: [...GPT_IMAGE_2_RESOLUTIONS],
            description: 'Output resolution. The runtime overwrites this from the quality preference (Economy = 1K, High quality = 2K). Combination limits: auto -> 1K only; 1:1 -> no 4K; 5:4, 4:5, 3:1, 1:3, 9:21 -> 1K only.',
          },
          input_urls: {
            type: 'array',
            description: 'Reference stills to edit (JPEG, PNG, or WEBP). Public HTTP URLs, session image ids, or "latest". Empty or omitted means text-to-image. Up to 16.',
            items: { type: 'string' },
          },
          uncertain_fields: {
            type: 'array',
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves. This does not start generation by itself. Do not mark preset-tool defaults (1K still, 480p video) or the always-adaptive image-to-video ratio as uncertain.',
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
      description: 'Generate one video. Use first_frame to animate ONE still (image-to-video). Use reference_images / reference_videos for reference-to-video: compose a new clip from several references, or edit an existing clip by putting it in reference_videos and describing the change in the prompt (optional reference_images to replace a person or object). If several stills are attached without a pointed first frame, prefer reference-to-video. Omit both only for text-to-video. Call once per video. The runtime picks the video family from the quality preference. A confirmation card is always recorded; generation may auto-approve from the user\'s generation confirmation.',
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
            description: 'Hint which inferred fields the user may want to edit. When generation confirmation is "review when needed", a non-empty list pauses for a click; empty auto-approves. Do not mark preset-tool defaults (1K still, 480p video) or the always-adaptive image-to-video ratio as uncertain.',
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
      description: 'Concatenate existing clips into one longer video with ffmpeg. Use after a storyboard of short Seedance clips. Pass the clip URLs or session video ids in story order. Do not mix with generate_video in the same turn. Free — no generation confirmation.',
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

  {
    type: 'function',
    function: {
      name: REQUEST_VOICE_RECORDING_TOOL,
      description: 'Open the in-chat microphone recorder so the user can record a short voice sample. Pass a simple 2-sentence reading script in the user-selected spoken language (English or Chinese/中文, etc.) for them to read aloud — do not hardcode English when another language was chosen. Must run alone (do not mix with ask_user, generation, or concat). The UI shows only the script and recorder (no choice tiles). Waits until the user taps Finish; the server converts the recording to MP3 and stores it locally. Tool result includes an MP3 voiceUrl (format audio/mpeg) ready for video reference_audios. Do not invent a URL and do not ask the user to re-upload for format reasons when ok is true.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          script: {
            type: 'string',
            description: 'A simple random 2-sentence reading script in the locked spoken language (English, Chinese/中文, etc.) for the user to read aloud (about 8–15 seconds when spoken). Invent a neutral everyday sample in that language; do not hardcode English-only when Chinese or another language is locked. Do not reuse the talking-avatar speech script here.',
            minLength: 16,
            maxLength: 400,
          },
          prompt: {
            type: 'string',
            description: 'Optional short intro above the recorder, in the user\'s preferred language.',
          },
        },
        required: ['script'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: LOAD_SKILL_TOOL,
      description: 'Load the full body of a skill by id into context. Free and read-only. Use when the user types /skill-id or when a catalog summary is not enough. Does not spend money and does not require generation confirmation.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Skill id, e.g. image-layer-splitter or a user skill id.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: SAVE_USER_SKILL_TOOL,
      description: 'Validate and persist an L1 user skill from SKILL.md markdown after the user confirms the draft. Refuses builtin id overrides and unregistered tools. Imports should stay disabled until explicitly enabled. Free to call; does not generate media.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', description: 'Full SKILL.md including YAML frontmatter and body.' },
          enabled: { type: 'boolean', description: 'Whether the skill is enabled in the catalog after save. Default true for new user skills; false for imports.' },
          category: { type: 'string', enum: ['utility', 'fun'], description: 'Skill sub-category shown on the homepage Skills tabs: "utility" (functional / productivity) or "fun" (entertainment). Right before the final exit, judge the category yourself, ask the user with ask_user question id skill_category (your judged option first, set as recommended, with a one-line reason), then pass the option the USER picked here on the final save. Omit to keep the current category (new skills default to utility).' },
        },
        required: ['markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: SET_SKILL_COVER_TOOL,
      description: 'Set the Skills / Home card cover of the skill bound to this skill project. Use in skill Test mode when the user asks to use a generated or uploaded image as the skill cover. Pass the URL of a finished image from this session; temporary provider URLs are copied to local storage first. Does not require /skill-creator. Free; does not generate media.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', description: 'URL of a finished still image from this session (generated or uploaded).' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: CHECK_SKILL_ID_TOOL,
      description: 'Check whether a skill id (/trigger) and/or display name are available. Free and read-only. Call before proposing or accepting a name/id, and again after the user picks Other/custom text. Pass exceptSkillId when renaming an existing skill so its current id/name stay allowed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'English kebab-case skill id / trigger without the leading slash, e.g. youtube-banner-generator.' },
          name: { type: 'string', description: 'Display name to check (any language). Compared case-insensitively.' },
          except_skill_id: { type: 'string', description: 'Optional current skill id to exclude from the check (in-place rename/edit).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: EXIT_SKILL_CREATOR_TOOL,
      description: 'Finish Skill Creator after the final exit ask_user. ALWAYS Enables the bound skill (status published + enabled; cannot remain draft). action "save_and_exit": Enable then go to Skills. action "test_now": Enable then open Test mode. Say Enable in notices, never Publish. Prefer save_user_skill with enabled:true in the same turn when content changed. Free. Does not generate media.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['save_and_exit', 'test_now'],
            description: 'save_and_exit → /skills after Enable; test_now → open Test mode after Enable.',
          },
          category: {
            type: 'string',
            enum: ['utility', 'fun'],
            description: 'Optional: the category the user chose in the skill_category ask_user (utility | fun). Persisted on the bound skill before exit.',
          },
        },
        required: ['action'],
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
  return image.status === 'success' && isHttpUrl(image.url) && image.kind !== 'video' && image.kind !== 'audio' && image.kind !== 'document'
}

export function latestStill(images: AgentImage[]) {
  return images.find(isStillAsset)
}

export function resolveSessionUrl(token: string, images: AgentImage[], label: string) {
  const value = token.trim()
  const latest = latestStill(images)
  const useLatest = !value || /^(?:latest|last|newest)$/i.test(value)
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
  const useLatest = !value || /^(?:latest|last|newest)$/i.test(value)
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

  const referenceImages = (args.reference_images || []).map(token => resolveSessionUrl(token, images, 'reference_images').url)
  const referenceVideos = (args.reference_videos || []).map(token => resolveSessionVideo(token, images, 'reference_videos').url)

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
  if (tokens.some(token => /^(?:latest|last|newest)$/i.test(token)))
    throw new Error('concat_videos cannot use "latest"; pass each clip URL or session id in order')

  return { video_urls: tokens }
}

export function resolveConcatVideoUrls(args: ConcatVideoArgs, images: AgentImage[]) {
  return args.video_urls.map((token, index) => resolveSessionVideo(token, images, `video_urls[${index}]`).url)
}

const CUSTOM_OPTION_RE = /^(?:other|custom|其他|其它|自定义)\b/i

function clipAsk(value: unknown, max: number) {
  return asString(value).slice(0, max)
}

function optionAllowsCustom(id: string, label: string, flag: unknown) {
  if (flag === true)
    return true
  return CUSTOM_OPTION_RE.test(id) || CUSTOM_OPTION_RE.test(label)
}

/** User-facing copy must say Enable, never Publish (public listing is a separate future feature). */
function rewritePublishWording(text: string) {
  return text
    .replace(/\bPublishing\b/g, 'Enabling')
    .replace(/\bpublishing\b/g, 'enabling')
    .replace(/\bPublished\b/g, 'Enabled')
    .replace(/\bpublished\b/g, 'enabled')
    .replace(/\bPublish\b/g, 'Enable')
    .replace(/\bpublish\b/g, 'enable')
}

const EXIT_SKILL_CREATOR_COPY: Record<string, { label: string, description: string }> = {
  save_and_exit: {
    label: 'Enable & exit',
    description: 'Enable the updated skill and return to Skills.',
  },
  test_now: {
    label: 'Enable & test now',
    description: 'Enable the updated skill and open Test mode so you can try it again.',
  },
}

function normalizeExitSkillCreatorOptionId(id: string, label: string) {
  const hay = `${id} ${label}`.toLowerCase()
  if (/(test[_\s-]?now|enable.*test|publish.*test)/.test(hay))
    return 'test_now'
  if (/(save[_\s-]?and[_\s-]?exit|enable.*exit|publish.*exit)/.test(hay))
    return 'save_and_exit'
  return id
}

function sanitizeExitSkillCreatorQuestion(question: ChoiceQuestion): ChoiceQuestion {
  const options = question.options.map((option) => {
    const id = normalizeExitSkillCreatorOptionId(option.id, option.label)
    const copy = EXIT_SKILL_CREATOR_COPY[id]
    if (copy) {
      return {
        ...option,
        id,
        label: copy.label,
        description: copy.description,
        custom: false,
      }
    }
    return {
      ...option,
      id,
      label: rewritePublishWording(option.label),
      ...(option.description ? { description: rewritePublishWording(option.description) } : {}),
    }
  })
  return {
    ...question,
    prompt: rewritePublishWording(question.prompt) || 'Ready to save. How do you want to finish?',
    ...(question.title ? { title: rewritePublishWording(question.title) } : {}),
    options,
  }
}

export function parseCheckSkillIdArgs(raw: string): { id?: string, name?: string, exceptSkillId?: string } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw || '{}') as Record<string, unknown>
  }
  catch {
    throw new Error('check_skill_id arguments were not valid JSON')
  }
  const id = String(parsed.id || '').trim().toLowerCase()
  const name = String(parsed.name || '').trim()
  const exceptSkillId = String(parsed.except_skill_id || parsed.exceptSkillId || '').trim().toLowerCase()
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(exceptSkillId ? { exceptSkillId } : {}),
  }
}

export function parseExitSkillCreatorArgs(raw: string): { action: 'save_and_exit' | 'test_now', category?: SkillCategory } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw || '{}') as Record<string, unknown>
  }
  catch {
    throw new Error('exit_skill_creator arguments were not valid JSON')
  }
  const action = parsed.action === 'test_now' ? 'test_now' as const : 'save_and_exit' as const
  const category = parseSkillCategoryInput(parsed.category) || undefined
  return category ? { action, category } : { action }
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


function formatLayerSplitConfirmPrompt(prompt: string) {
  const text = prompt.replace(/\r\n/g, '\n').trim()
  if (!text || /\n\s*Box\s+\d+/i.test(text))
    return text
  // Split packed "Box 1 ... Box 2 ..." prose onto separate lines for the confirm card.
  const withBreaks = text
    .replace(/\s*(Box\s+\d+\b)/gi, '\n$1')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
  return withBreaks.trim()
}

function parseAskQuestion(raw: unknown, index: number, seen: Set<string>): ChoiceQuestion | null {
  if (!raw || typeof raw !== 'object')
    return null
  const row = raw as Record<string, unknown>
  const prompt = clipAsk(row.prompt ?? row.question ?? row.label, row.id === 'sketch_prompt' ? 8000 : (row.id === 'sketch_understanding' || row.id === 'object_removal_confirm') ? 4000 : 2000)
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
  // Normalize Image Layer Splitter option ids: the model may emit 'draw'/'describe'
  // instead of the canonical 'draw_boxes'/'describe_layers' that the UI and loop expect.
  if (unique === 'layer_selection_method') {
    for (const option of options) {
      if (option.id === 'draw' || option.id === 'draw_box' || option.id === 'boxes' || option.id === 'draw-boxes')
        option.id = 'draw_boxes'
      else if (option.id === 'describe' || option.id === 'description' || option.id === 'describe-layers')
        option.id = 'describe_layers'
    }
  }
  if (unique === 'layer_split_confirm') {
    for (const option of options) {
      if (['yes', 'ok', 'correct', 'looks_good', 'looks-good', 'proceed', 'confirm_extract', 'confirm-extract'].includes(option.id))
        option.id = 'confirm'
      else if (['no', 'fix', 'revise', 'correct_more', 'need_changes', 'need-changes', 'edit'].includes(option.id))
        option.id = 'adjust'
    }
  }
  if (unique === 'object_removal_method') {
    for (const option of options) {
      if (option.id === 'mark' || option.id === 'mask' || option.id === 'boxes' || option.id === 'draw' || option.id === 'annotate_image')
        option.id = 'annotate'
      else if (option.id === 'text' || option.id === 'description' || option.id === 'describe_text')
        option.id = 'describe'
    }
  }
  if (unique === 'object_removal_confirm') {
    for (const option of options) {
      if (['yes', 'ok', 'correct', 'looks_good', 'looks-good', 'proceed'].includes(option.id))
        option.id = 'confirm'
      else if (['no', 'fix', 'revise', 'correct_more', 'need_changes', 'need-changes', 'edit'].includes(option.id))
        option.id = 'adjust'
    }
  }
  const title = clipAsk(row.title, 80)
  const recommendedRaw = clipAsk(row.recommended ?? row.recommended_id ?? row.recommendedId, 64)
  const recommendedId = options.some(item => item.id === recommendedRaw) ? recommendedRaw : undefined
  const displayPrompt = unique === 'layer_split_confirm' ? formatLayerSplitConfirmPrompt(prompt) : prompt
  const base: ChoiceQuestion = {
    id: unique,
    prompt: displayPrompt,
    options: SKETCH_QUESTIONS.includes(id)
      ? options.filter(option => (id === 'sketch_prompt' ? ['send', 'adjust', 'cancel'] : id === 'sketch_understanding' ? ['correct', 'adjust'] : ['yes', 'no']).includes(option.id)).map(option => ({ ...option, custom: option.id === 'adjust' }))
      : withCustomChoiceOption(options),
    ...(title ? { title } : {}),
    ...(recommendedId ? { recommendedId } : {}),
  }
  if (unique === 'exit_skill_creator')
    return sanitizeExitSkillCreatorQuestion(base)
  return base
}


export function parseRequestVoiceRecordingArgs(raw: string): { script: string, prompt: string } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  }
  catch {
    throw new Error('request_voice_recording arguments were not valid JSON')
  }
  const script = clipAsk(parsed.script, 400).trim()
  if (script.length < 16)
    throw new Error('request_voice_recording needs a script of at least 16 characters')
  return {
    script,
    prompt: clipAsk(parsed.prompt ?? parsed.intro, 500) || 'Record a short voice sample. Read the script aloud, then tap Finish.',
  }
}

export function voiceRecordingAskArgs(script: string, prompt = ''): AskUserArgs {
  const reading = clipAsk(script, 400).trim()
  const intro = clipAsk(prompt, 500) || 'Record a short voice sample. Read the script aloud, then tap Finish.'
  return {
    prompt: intro,
    recommendation: 'Record the sample so the video can match your voice.',
    questions: [{
      id: 'voice_record',
      title: 'Voice sample',
      prompt: `${intro}\n\n"${reading}"`,
      script: reading,
      options: [
        { id: 'recorded', label: 'Finish' },
      ],
    }],
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

  const hasExit = questions.some(question => question.id === 'exit_skill_creator')
  const topPrompt = clipAsk(parsed.prompt ?? parsed.intro, 2000)
  return {
    prompt: hasExit ? (rewritePublishWording(topPrompt) || 'The update is ready to save.') : topPrompt,
    recommendation: questions.find(question => question.id === 'image_edit_method' || question.id === 'object_removal_method')?.options.find(option => option.id === 'annotate')?.label ?? clipAsk(parsed.recommendation ?? parsed.hint, 400),
    questions: standaloneImageEditQuestions(questions),
  }
}
