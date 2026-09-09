import type { AgentConfirmPolicy, AgentQuality, GenerateImageArgs, GenerateVideoArgs, GptImage2Resolution, VideoFamily } from './types'
import { gptImage2ComboError } from './gptImage2'
import { isSeedance2Duration, isSeedance2Resolution } from './seedance2'
import { isSeedance25Resolution, snapSeedance25Duration } from './seedance25'
import { WAN_30_ASPECT_RATIOS, WAN_30_RESOLUTIONS } from './types'

export function parseAgentQuality(value: unknown): AgentQuality {
  if (value === 'high' || value === 'hobby' || value === 'custom')
    return value
  // Legacy preference id from before the Hobby rename.
  if (value === 'draft')
    return 'hobby'
  return 'economy'
}

export function parseAgentConfirmPolicy(value: unknown): AgentConfirmPolicy {
  if (value === 'auto' || value === 'when_needed' || value === 'always')
    return value
  return 'always'
}

export function parseVideoFamily(value: unknown): VideoFamily {
  if (value === 'seedance-2-5' || value === 'wan-3')
    return value
  return 'seedance-2'
}

export function applyImageQuality(args: GenerateImageArgs, quality: AgentQuality): GenerateImageArgs {
  const target: GptImage2Resolution = quality === 'high' ? '2K' : '1K'
  const resolution = gptImage2ComboError(args.aspect_ratio, target) ? '1K' : target
  return {
    ...args,
    resolution,
    uncertain_fields: args.uncertain_fields.filter(field => field !== 'resolution'),
  }
}

function isWan30AspectRatio(value: string) {
  return (WAN_30_ASPECT_RATIOS as readonly string[]).includes(value)
}

function isWan30Resolution(value: string) {
  return (WAN_30_RESOLUTIONS as readonly string[]).includes(value)
}

function normalizeWan30Resolution(value: string) {
  const raw = String(value || '').trim()
  if (/^480p$/i.test(raw))
    return '480p'
  if (/^720p$/i.test(raw))
    return '720p'
  if (/^1080p$/i.test(raw))
    return '1080p'
  return '480p'
}

export function clampVideoToFamily(args: GenerateVideoArgs, family: VideoFamily): GenerateVideoArgs {
  if (family === 'seedance-2-5') {
    let resolution = args.resolution === '4k' ? '1080p' : args.resolution
    if (!isSeedance25Resolution(resolution))
      resolution = '480p'
    return {
      ...args,
      family,
      resolution,
      duration: snapSeedance25Duration(args.duration),
      reference_images: args.reference_images.slice(0, 30),
      reference_videos: args.reference_videos.slice(0, 10),
    }
  }

  if (family === 'wan-3') {
    const hasFirst = Boolean(args.first_frame)
    const hasRefs = Boolean(args.reference_images.length || args.reference_videos.length)
    let aspectRatio = args.aspect_ratio
    if (!isWan30AspectRatio(aspectRatio))
      aspectRatio = hasFirst && !hasRefs ? 'adaptive' : '16:9'
    const duration = Math.min(30, Math.max(2, Math.floor(Number(args.duration) || 5)))
    return {
      ...args,
      family,
      aspect_ratio: aspectRatio as GenerateVideoArgs['aspect_ratio'],
      resolution: isWan30Resolution(normalizeWan30Resolution(args.resolution))
        ? normalizeWan30Resolution(args.resolution)
        : '480p',
      duration,
      reference_images: args.reference_images.slice(0, 10),
      reference_videos: args.reference_videos.slice(0, 5),
    }
  }

  const duration = Math.min(15, Math.max(4, Math.floor(Number(args.duration) || 5)))
  return {
    ...args,
    family,
    resolution: isSeedance2Resolution(args.resolution) ? args.resolution : '480p',
    duration: isSeedance2Duration(duration) ? duration : 5,
    reference_images: args.reference_images.slice(0, 9),
    reference_videos: args.reference_videos.slice(0, 3),
  }
}

export function applyVideoQuality(args: GenerateVideoArgs, quality: AgentQuality): GenerateVideoArgs {
  const family: VideoFamily = quality === 'high'
    ? 'seedance-2-5'
    : quality === 'hobby'
      ? 'wan-3'
      : 'seedance-2'
  return clampVideoToFamily(args, family)
}
