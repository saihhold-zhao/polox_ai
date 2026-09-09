import {
  isFlux3AspectRatio,
  isFlux3Duration,
  isFlux3GenerateModel,
  isFlux3I2vModel,
} from '~~/shared/utils/flux3'
import { asBoolean, asString, firstHttpUrl, requireString } from './mediaInput'

export function sanitizeFlux3Input(model: string, input: Record<string, unknown>): Record<string, unknown> {
  if (!isFlux3GenerateModel(model)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown Flux 3 model',
    })
  }

  const prompt = requireString(input.prompt, 'prompt')
  if (prompt.length > 20000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'prompt must be 20000 characters or fewer',
    })
  }

  const aspectRatio = asString(input.aspect_ratio) || 'auto'
  if (!isFlux3AspectRatio(aspectRatio)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid aspect_ratio',
    })
  }

  const resolution = asString(input.resolution) || '720p'
  if (resolution !== '720p' && resolution !== '1080p') {
    throw createError({
      statusCode: 400,
      statusMessage: 'resolution must be 720p or 1080p',
    })
  }

  const duration = Math.floor(Number(input.duration ?? 10))
  if (!isFlux3Duration(duration)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'duration must be 5-20 seconds',
    })
  }

  const sanitized: Record<string, unknown> = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
    duration,
    generate_audio: asBoolean(input.generate_audio, true),
    safety_tolerance: 2,
  }

  if (isFlux3I2vModel(model)) {
    const start = firstHttpUrl(
      input.first_frame_url ?? input.image_url ?? input.start_image_url,
      'first_frame_url',
      true,
    )
    const end = firstHttpUrl(
      input.last_frame_url ?? input.end_image_url,
      'last_frame_url',
      false,
    )
    if (end) {
      sanitized.start_image_url = start
      sanitized.end_image_url = end
    }
    else {
      sanitized.image_url = start
    }
  }

  return sanitized
}
