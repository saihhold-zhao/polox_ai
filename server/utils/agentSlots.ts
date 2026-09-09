import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { AGENT_CONCAT_MODEL } from '~~/shared/utils/agentConcat'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { IDEOGRAM_REMOVE_BACKGROUND_MODEL } from '~~/shared/utils/ideogram'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { agentResultTaskId, httpUrlList } from './agentJobs'
import { syncAgentRuntimeFromJob } from './agentSessionRuntime'
import { isFalGenerateModel } from './falGenerate'
import { generationConcurrency } from './generationConcurrency'
import { countActiveGenerationJobs, dispatchQueuedJobs } from './generationQueue'
import { resolveProject } from './projects'
import { connectDatabase } from './sqlite'

async function saveAgentJob(job: StoredDocument<IGenerationJob>) {
  await job.save()
  return job
}
function queueMessage(limit: number, active: number) {
  if (limit <= 1) {
    return active >= 1
      ? 'This workspace supports 1 concurrent generation. This job is waiting in queue and will start automatically.'
      : 'This workspace supports 1 concurrent generation.'
  }
  return active >= limit
    ? `This workspace supports ${limit} concurrent generations. This job is waiting in queue and will start automatically.`
    : `This workspace supports ${limit} concurrent generations.`
}
function modelMeta(kind: string, sourceUrl: string, videoMode: string, videoFamily: string) {
  if (kind === 'cutout') {
    return {
      provider: 'fal' as const,
      model: IDEOGRAM_REMOVE_BACKGROUND_MODEL,
      category: 'Tools',
      task: 'Remove Background',
    }
  }
  if (kind === 'video' && videoMode === 'concat') {
    return {
      provider: 'fal' as const,
      model: AGENT_CONCAT_MODEL,
      category: 'Video',
      task: '',
    }
  }
  if (kind === 'video') {
    const family = String(videoFamily || '')
    const prefix = family === 'seedance-2-5'
      ? 'bytedance/seedance-2-5'
      : family === 'wan-3'
        ? 'wan/3-0-video'
        : 'bytedance/seedance-2'
    if (videoMode === 'reference') {
      return {
        provider: 'fal' as const,
        model: `${prefix}-reference-to-video`,
        category: 'Video',
        task: 'Reference to Video',
      }
    }
    return {
      provider: 'fal' as const,
      model: videoMode === 'image' ? `${prefix}-image-to-video` : `${prefix}-text-to-video`,
      category: 'Video',
      task: videoMode === 'image' ? 'Image to Video' : 'Text to Video',
    }
  }
  return {
    provider: 'fal' as const,
    model: sourceUrl ? 'gpt-image-2-image-to-image' : 'gpt-image-2-text-to-image',
    category: 'Image',
    task: sourceUrl ? 'Image to Image' : 'Text to Image',
  }
}
async function slotSnapshot(callId: string) {
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  const [limit, active] = await Promise.all([
    generationConcurrency(),
    countActiveGenerationJobs(),
  ])
  const state = String(job?.state || 'fail')
  const queued = state === 'queued'
  return {
    callId,
    state,
    queued,
    limit,
    active,
    message: job?.failMsg || queueMessage(limit, active),
  }
}
export async function acquireAgentSlot(input: {
  sessionId: string
  callId: string
  projectId?: string
  modelId?: string
  modelInput?: Record<string, unknown>
  requestModel?: string
  kind?: string
  prompt?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  videoMode?: string
  videoFamily?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  if (!callId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId is required',
    })
  }
  const project = await resolveProject(input.projectId)
  const taskId = agentResultTaskId(callId)
  const kind = String(input.kind || 'still')
  const sourceUrl = String(input.sourceUrl || '').trim()
  const stills = httpUrlList(input.inputUrls?.length ? input.inputUrls : [sourceUrl])
  const videos = httpUrlList(input.referenceVideoUrls)
  const videoMode = String(input.videoMode || '')
  const registered = input.modelId ? AGENT_MODELS.find(model => model.id === input.modelId) : undefined
  if (input.modelId && !registered)
    throw new Error('Unknown Agent model')
  const meta = registered ? { model: registered.id, category: registered.category, task: registered.task, provider: 'fal' as const } : modelMeta(kind, stills[0] || sourceUrl, videoMode, String(input.videoFamily || ''))
  const prompt = String(input.prompt || '').trim()
  let inputPayload: Record<string, unknown> = {
    prompt,
    aspect_ratio: input.aspectRatio || '',
    resolution: String(input.videoFamily || '') === 'wan-3'
      ? (/^720p$/i.test(String(input.resolution || ''))
          ? '720P'
          : /^1080p$/i.test(String(input.resolution || ''))
            ? '1080P'
            : '480P')
      : (input.resolution || ''),
  }
  if (String(input.videoFamily || '') === 'wan-3')
    inputPayload.audio = true
  if (input.duration)
    inputPayload.duration = input.duration
  if (kind === 'cutout' && stills[0]) {
    inputPayload.image_url = stills[0]
  }
  else if (kind === 'video' && videoMode === 'reference') {
    if (stills.length)
      inputPayload.reference_image_urls = stills
    if (videos.length)
      inputPayload.reference_video_urls = videos
  }
  else if (kind === 'video' && videoMode === 'image' && stills[0]) {
    inputPayload.first_frame_url = stills[0]
    if (stills[1])
      inputPayload.last_frame_url = stills[1]
  }
  else if (stills.length) {
    inputPayload.input_urls = stills
  }
  if (registered && input.modelInput)
    inputPayload = input.modelInput
  const requestModel = registered ? (input.requestModel || registered.id) : meta.model
  const sourceUrls = httpUrlList([...stills, ...videos])
  const existing = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (!existing) {
    await GenerationJob.create({
      projectId: String(project._id),
      provider: meta.provider,
      model: meta.model,
      category: meta.category,
      task: meta.task,
      input: inputPayload,
      requestBody: { model: requestModel, input: inputPayload },
      originalRequest: {
        source: 'agent',
        holdSlot: !registered,
        imageId: callId,
        sessionId: input.sessionId,
      },
      taskId,
      providerTaskId: '',
      state: 'queued',
      sourceUrls,
      resultUrls: [],
      resultAssets: [],
      resultJson: '',
      failCode: '',
      failMsg: '',

      archiveAttempts: 0,
      lastSyncAt: new Date(),
    })
  }
  else if (existing.state === 'fail' || existing.state === 'success') {
    existing.state = 'queued'
    existing.failCode = ''
    existing.failMsg = ''
    existing.resultUrls = []
    existing.input = inputPayload
    existing.requestBody = { model: requestModel, input: inputPayload }
    existing.sourceUrls = sourceUrls
    existing.projectId = String(project._id)
    existing.lastSyncAt = new Date()
    await existing.save()
  }
  await dispatchQueuedJobs()
  return slotSnapshot(callId)
}
export async function readAgentSlot(callId: string) {
  await connectDatabase()
  await dispatchQueuedJobs()
  return slotSnapshot(callId)
}
export async function completeAgentSlot(input: {
  callId: string
  url?: string
  error?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  if (!callId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId is required',
    })
  }
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (job) {
    const settled = job.state === 'success' || job.state === 'moderating' || job.state === 'archiving'
    if (!settled) {
      const url = String(input.url || '').trim()
      const error = String(input.error || '').trim()
      const now = new Date()
      const keepOpen = Boolean(job.providerTaskId) && isKeepAliveSlotError(error)
      if (url && /^https?:\/\//i.test(url) && !error) {
        job.state = 'success'
        job.resultUrls = [url]
        if (!job.sourceUrls.includes(url))
          job.sourceUrls = [...job.sourceUrls, url]
        job.failCode = ''
        job.failMsg = ''
        job.completeTime = now.getTime()
        job.lastSyncAt = now
        await saveAgentJob(job)
      }
      else if (!keepOpen) {
        job.state = 'fail'
        job.failMsg = error || 'Generation cancelled'
        job.completeTime = now.getTime()
        job.lastSyncAt = now
        await saveAgentJob(job)
      }
    }
    void syncAgentRuntimeFromJob(job)
  }
  await dispatchQueuedJobs()
  const active = await GenerationJob.countDocuments({
    deleted: { $ne: true },
    state: { $in: [...GENERATION_ACTIVE_STATES] },
  })
  const limit = await generationConcurrency()
  return {
    callId,
    state: job?.state || 'fail',
    queued: false,
    limit,
    active,
    message: job?.state === 'fail' ? String(job.failMsg || '') : '',
  }
}
export async function bindAgentSlot(input: {
  callId: string
  providerTaskId?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  const providerTaskId = String(input.providerTaskId || '').trim()
  if (!callId || !providerTaskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId and providerTaskId are required',
    })
  }
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (job && !job.providerTaskId) {
    job.providerTaskId = providerTaskId
    job.lastSyncAt = new Date()
    if (job.state === 'queued' || job.state === 'waiting' || job.state === 'queuing')
      job.state = 'generating'
    try {
      await saveAgentJob(job)
    }
    catch (error) {
      console.error('[agent slot bind]', callId, error)
    }
  }
  return slotSnapshot(callId)
}
function isKeepAliveSlotError(error: string) {
  return /aborted|timed out|timeout|no result urls/i.test(error)
}
