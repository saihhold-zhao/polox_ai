import { z } from 'zod'
import { measureReferenceVideoSeconds } from '../utils/videoDuration'

export const MEASURE_VIDEO_DURATION_TOOL = 'measure_video_duration'
export const MAX_MEASURE_VIDEOS = 20

export const measureVideoDurationTool = {
  type: 'function' as const,
  function: {
    name: MEASURE_VIDEO_DURATION_TOOL,
    description: 'Measure how many seconds one or more videos last (ffprobe). Pass public HTTP URLs, session video ids, or "latest". No generation confirmation needed. Use before planning clip length, reference-video limits, or concat. Returns per-clip seconds and a total.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        videos: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_MEASURE_VIDEOS,
          items: { type: 'string' },
          description: 'Videos to measure. Public HTTP URLs, session video ids, or "latest" for the newest session clip. Order is preserved in the result.',
        },
      },
      required: ['videos'],
    },
  },
}

const argsSchema = z.object({
  videos: z.array(z.string().min(1)).min(1).max(MAX_MEASURE_VIDEOS),
})

export function parseMeasureVideoDurationArgs(raw: string) {
  return argsSchema.parse(JSON.parse(raw || '{}'))
}

export type MeasureVideoDurationItem = {
  token: string
  url: string
  id?: string
  name?: string
}

export async function runMeasureVideoDuration(
  items: MeasureVideoDurationItem[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (!items.length)
    throw new Error('At least one video is required')
  const measured = await measureReferenceVideoSeconds(items.map(item => item.url))
  const videos = items.map((item, index) => ({
    token: item.token,
    id: item.id,
    name: item.name,
    url: item.url,
    seconds: Number((measured.durations[index] ?? 0).toFixed(3)),
  }))
  return {
    ok: true as const,
    videos,
    total_seconds: Number(measured.total.toFixed(3)),
    count: videos.length,
  }
}
