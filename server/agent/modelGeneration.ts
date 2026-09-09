import { GenerationJob } from '../models/generationJob'
import { createFalTask } from '../utils/falGenerate'
import { falEndpoint } from '../utils/falInput'
import { sanitizeGenerateInput } from '../utils/generateInput'
import { agentEnv } from './env'

export const IMAGE_TIMEOUT_MS = 8 * 60 * 1000
export const VIDEO_TIMEOUT_MS = 30 * 60 * 1000
export const VIDEO_25_TIMEOUT_MS = 40 * 60 * 1000
export type OnProviderCreated = (providerTaskId: string) => void | Promise<void>

export async function pollFalTask(taskId: string, options: { timeoutMs: number, failLabel: string, endpoint?: string, statusUrl?: string, responseUrl?: string }) {
  const job = options.endpoint ? null : await GenerationJob.findOne({ providerTaskId: taskId })
  const endpoint = options.endpoint || falEndpoint(String(job?.requestBody?.model || job?.model || ''), job?.input || {})
  if (!endpoint)
    throw new Error('Cannot recover generation without its model endpoint')
  const queue = `https://queue.fal.run/${endpoint.split('/').slice(0, 2).join('/')}/requests/${encodeURIComponent(taskId)}`
  const statusUrl = options.statusUrl || String(job?.requestBody?.statusUrl || '') || `${queue}/status`
  const responseUrl = options.responseUrl || String(job?.requestBody?.responseUrl || '') || queue
  if ((job?.provider && job.provider !== 'fal') || [statusUrl, responseUrl].some(url => new URL(url).origin !== 'https://queue.fal.run'))
    throw new Error('Cannot resume a retired provider task. Please generate again.')
  const headers = { Authorization: `Key ${agentEnv.falApiKey}` }
  const deadline = Date.now() + options.timeoutMs
  while (Date.now() < deadline) {
    const response = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30_000) })
    const status = await response.json() as Record<string, any>
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      throw new Error(String(status.detail || status.message || options.failLabel))
    }
    if (status.error || ['FAILED', 'CANCELED'].includes(status.status))
      throw new Error(String(status.error || options.failLabel))
    if (status.status === 'COMPLETED') {
      const response = await fetch(responseUrl, { headers, signal: AbortSignal.timeout(30_000) })
      const result = await response.json() as Record<string, any>
      if (!response.ok)
        throw new Error(typeof result.detail === 'string' ? result.detail : options.failLabel)
      const urls = (Array.isArray(result.images) ? result.images : [result.video || result.image]).map((file: any) => file?.url).filter((url: unknown): url is string => typeof url === 'string' && /^https?:\/\//i.test(url))
      if (!urls.length)
        throw new Error('Fal returned no result URLs')
      return { taskId, urls }
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error(`${options.failLabel} timed out`)
}
async function generate(model: string, input: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal, onCreated?: OnProviderCreated) {
  signal?.throwIfAborted()
  const payload = sanitizeGenerateInput(model, input)
  const endpoint = falEndpoint(model, payload)
  const task = await createFalTask(endpoint, payload)
  await onCreated?.(task.requestId)
  return pollFalTask(task.requestId, { endpoint, statusUrl: task.statusUrl, responseUrl: task.responseUrl, timeoutMs, failLabel: 'Generation failed' })
}
export async function generateGptImage2(input: { prompt: string, aspect_ratio: string, resolution: string, input_urls?: string[] }, signal?: AbortSignal, onCreated?: OnProviderCreated) {
  return generate(input.input_urls?.length ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image', input, IMAGE_TIMEOUT_MS, signal, onCreated)
}
interface VideoInput { prompt: string, aspect_ratio: string, resolution: string, duration: number, generate_audio: boolean, first_frame_url?: string, last_frame_url?: string, reference_image_urls?: string[], reference_video_urls?: string[] }
function videoModel(prefix: string, input: VideoInput) {
  return `${prefix}-${input.reference_image_urls?.length || input.reference_video_urls?.length ? 'reference-to-video' : input.first_frame_url ? 'image-to-video' : 'text-to-video'}`
}
export function generateSeedance2(input: VideoInput, signal?: AbortSignal, onCreated?: OnProviderCreated) {
  return generate(videoModel('bytedance/seedance-2', input), { ...input }, VIDEO_TIMEOUT_MS, signal, onCreated)
}
export function generateSeedance25(input: VideoInput, signal?: AbortSignal, onCreated?: OnProviderCreated) {
  return generate(videoModel('bytedance/seedance-2-5', input), { ...input }, VIDEO_25_TIMEOUT_MS, signal, onCreated)
}
export function generateWan30(input: VideoInput, signal?: AbortSignal, onCreated?: OnProviderCreated) {
  return generate(videoModel('wan/3-0-video', input), { ...input }, VIDEO_TIMEOUT_MS, signal, onCreated)
}
