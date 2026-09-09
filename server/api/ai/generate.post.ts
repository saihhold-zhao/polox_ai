import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { GenerationJob } from '../../models/generationJob'
import { isFalGenerateModel } from '../../utils/falGenerate'
import { falEndpoint } from '../../utils/falInput'
import { sanitizeGenerateInput } from '../../utils/generateInput'
import { dispatchQueuedJobs, newLocalTaskId } from '../../utils/generationQueue'
import { toPublicJob } from '../../utils/generationResults'
import { toPublicApiError } from '../../utils/httpError'
import { resolveProject } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'
import { measureReferenceVideoSeconds, referenceVideoDurationLimits } from '../../utils/videoDuration'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    model?: string
    category?: string
    task?: string
    projectId?: string
    input?: Record<string, unknown>
  }>(event)
  const model = String(body?.model || '').trim()
  const useFal = isFalGenerateModel(model)
  if (!useFal) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This model is not available for generation yet',
    })
  }
  const rawInput = body?.input && typeof body.input === 'object' ? body.input : {}
  const input = sanitizeGenerateInput(model, rawInput)
  const videoInput = input.reference_video_urls || input.video_urls
  const referenceVideos = Array.isArray(videoInput)
    ? videoInput.filter((item): item is string => typeof item === 'string')
    : []
  const hasVideoInput = referenceVideos.length > 0
  const measuredVideos = hasVideoInput
    ? await measureReferenceVideoSeconds(referenceVideos)
    : { durations: [] as number[], total: 0 }
  const limits = referenceVideoDurationLimits(model)
  if (hasVideoInput) {
    if (measuredVideos.durations.some(seconds => seconds < limits.minEach || seconds > limits.maxEach)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Each reference video must be ${limits.minEach}-${limits.maxEach} seconds`,
      })
    }
    if (measuredVideos.total > limits.maxTotal) {
      throw createError({
        statusCode: 400,
        statusMessage: `Reference videos cannot exceed ${limits.maxTotal} seconds in total`,
      })
    }
  }
  const inputVideoDuration = hasVideoInput
    ? Math.min(limits.maxTotal, measuredVideos.total)
    : 0
  if (model.startsWith('wan/') && hasVideoInput && inputVideoDuration + Number(input.duration || 0) > 30) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Input video plus output duration cannot exceed 30 seconds',
    })
  }
  await connectDatabase()
  const project = await resolveProject(body?.projectId)
  const requestBody = { model: falEndpoint(model, input), input }
  try {
    const job = await GenerationJob.create({
      projectId: String(project._id),
      provider: 'fal',
      model,
      category: (isImageLayerSplitterModel(model) ? 'Tools' : String(body?.category || '')),
      task: (isImageLayerSplitterModel(model) ? 'Split Image Layers' : String(body?.task || '')),
      input,
      requestBody,
      originalRequest: body && typeof body === 'object' ? body : {},
      taskId: newLocalTaskId(),
      providerTaskId: '',
      state: 'queued',
      sourceUrls: [],
      resultUrls: [],
      resultAssets: [],
      resultJson: '',
      failCode: '',
      failMsg: '',

      archiveAttempts: 0,
      lastSyncAt: new Date(),
    })
    await dispatchQueuedJobs()
    const latest = await GenerationJob.findById(job._id)
    if (!latest) {
      throw createError({
        statusCode: 502,
        statusMessage: 'Generation failed',
      })
    }
    if (latest.state === 'fail' && !latest.providerTaskId) {
      latest.deleted = true
      latest.deletedAt = new Date()
      latest.hiddenFromUser = true
      await latest.save()
      throw createError({
        statusCode: 502,
        statusMessage: latest.failMsg || 'Generation failed',
      })
    }
    return toPublicJob(latest)
  }
  catch (error) {
    const statusCode = Number((error as {
      statusCode?: number
    })?.statusCode || 0)
    if (statusCode !== 402 && statusCode !== 422)
      console.error('[generate]', error)
    throw toPublicApiError(error, 'Generation failed')
  }
})
