import { readServiceSettings } from './serviceSettings'
import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { FAL_ENDPOINTS } from '~~/shared/constants/falEndpoints'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { isFlux3GenerateModel } from '~~/shared/utils/flux3'
import { isIdeogramRemoveBackgroundModel } from '~~/shared/utils/ideogram'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { prepareFalFiles } from './falFiles'
import { falEndpoint } from './falInput'
import { isProviderStarted, jobProviderId } from './generationJobs'
import { mergeSourceUrls } from './generationResults'
import { toUpstreamApiError } from './httpError'
import { IMAGE_LAYER_SPLITTER_ENDPOINT, readLayerResult } from './imageLayerSplitter'

export function isFalGenerateModel(model: string) {
  return Boolean(FAL_ENDPOINTS[model]) || Object.values(FAL_ENDPOINTS).includes(model) || isImageLayerSplitterModel(model) || isFlux3GenerateModel(model) || isIdeogramRemoveBackgroundModel(model)
}

function falSubmitUrl(model: string) {
  if (!isFalGenerateModel(model) && model !== IMAGE_LAYER_SPLITTER_ENDPOINT) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown Fal model',
    })
  }
  return `https://queue.fal.run/${model}`
}

function falAppQueueUrl(model: string) {
  const parts = model.split('/').filter(Boolean)
  const app = parts.length >= 3 ? parts.slice(0, 2).join('/') : model
  return `https://queue.fal.run/${app}`
}

function getFalApiKey() {
  const key = readServiceSettings().falKey
  if (!key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Fal API key is not configured',
    })
  }
  return key
}

function falHeaders() {
  return {
    'Authorization': `Key ${getFalApiKey()}`,
    'Content-Type': 'application/json',
  }
}

function falAuthHeaders() {
  return {
    Authorization: `Key ${getFalApiKey()}`,
  }
}

function readFalError(error: unknown, fallback: string) {
  return readErrorMessage(error, fallback)
}

function resultUrlFromFal(payload: Record<string, unknown>) {
  const video = payload.video
  if (video && typeof video === 'object' && typeof (video as { url?: unknown }).url === 'string') {
    const url = String((video as { url: string }).url).trim()
    if (/^https?:\/\//i.test(url))
      return url
  }

  if (Array.isArray(payload.images)) {
    const first = payload.images[0] as { url?: string } | undefined
    if (first?.url)
      return first.url
  }
  const image = payload.image
  if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    const url = String((image as { url: string }).url).trim()
    if (/^https?:\/\//i.test(url))
      return url
  }

  return ''
}

export async function createFalTask(model: string, input: Record<string, unknown>) {
  model = falEndpoint(model, input)
  try {
    const response = await $fetch<{
      request_id?: string
      status_url?: string
      response_url?: string
    }>(falSubmitUrl(model), {
      method: 'POST',
      headers: falHeaders(),
      body: await prepareFalFiles(input),
      timeout: 30_000,
    })
    const requestId = String(response.request_id || '').trim()
    if (!requestId) {
      throw createError({
        statusCode: 502,
        statusMessage: 'Fal did not return a request id',
      })
    }
    const queue = falAppQueueUrl(model)
    const id = encodeURIComponent(requestId)
    return {
      requestId,
      statusUrl: String(response.status_url || '').trim() || `${queue}/requests/${id}/status`,
      responseUrl: String(response.response_url || '').trim() || `${queue}/requests/${id}`,
    }
  }
  catch (error) {
    throw toUpstreamApiError(error, 'Failed to create Fal task')
  }
}

function falModelForJob(job: IGenerationJob) {
  const fromRequest = typeof job.requestBody?.model === 'string' ? String(job.requestBody.model).trim() : ''
  return falEndpoint(fromRequest || job.model, job.input)
}

function falPollUrls(job: IGenerationJob) {
  const model = falModelForJob(job)
  const queue = falAppQueueUrl(model)
  const id = encodeURIComponent(jobProviderId(job))
  const statusUrl = typeof job.requestBody?.statusUrl === 'string' ? String(job.requestBody.statusUrl).trim() : ''
  const responseUrl = typeof job.requestBody?.responseUrl === 'string' ? String(job.requestBody.responseUrl).trim() : ''
  return {
    statusUrl: statusUrl || `${queue}/requests/${id}/status`,
    responseUrl: responseUrl || `${queue}/requests/${id}`,
  }
}

export async function syncJobFromFal(job: IGenerationJob & { save: () => Promise<unknown> }) {
  if (job.state === 'queued' || job.state === 'fail' || job.state === 'moderating' || job.state === 'archiving' || (job.state === 'success' && job.resultUrls.length > 0))
    return job
  if (!isProviderStarted(job))
    return job

  if (job.provider && job.provider !== 'fal') {
    job.state = 'fail'
    job.failMsg = 'This task belongs to a retired provider. Please generate again.'
    await job.save()
    return job
  }
  const { statusUrl, responseUrl } = falPollUrls(job)
  if ([statusUrl, responseUrl].some(url => new URL(url).origin !== 'https://queue.fal.run')) {
    job.state = 'fail'
    job.failMsg = 'Invalid generation polling address. Please generate again.'
    await job.save()
    return job
  }
  try {
    const status = await $fetch<{ status?: string, error?: unknown }>(statusUrl, {
      headers: falAuthHeaders(),
      timeout: 20_000,
    })

    const next = String(status.status || '').toUpperCase()
    job.lastSyncAt = new Date()

    if (next === 'IN_QUEUE') {
      job.state = 'queuing'
      await job.save()
      return job
    }

    if (next === 'IN_PROGRESS') {
      job.state = 'generating'
      await job.save()
      return job
    }

    // COMPLETED means the request finished; fal can include a terminal error.
    if (next === 'FAILED' || next === 'CANCELED' || (next === 'COMPLETED' && status.error)) {
      job.state = 'fail'
      job.failMsg = readFalError(status, next === 'CANCELED' ? 'Fal generation was canceled' : 'Fal generation failed')
      await job.save()
      return job as StoredDocument<IGenerationJob>
    }

    if (next !== 'COMPLETED') {
      await job.save()
      return job
    }

    const result = await $fetch<Record<string, unknown>>(responseUrl, {
      headers: falAuthHeaders(),
      timeout: 30_000,
    })

    const layerResult = isImageLayerSplitterModel(job.model) ? await readLayerResult(result) : null
    const url = layerResult?.urls[0] || resultUrlFromFal(result)
    if (!url) {
      job.state = 'fail'
      job.failMsg = 'Fal returned no result'
      await job.save()
      return job as StoredDocument<IGenerationJob>
    }

    if (layerResult && String(job.state) === 'fail')
      return job
    const urls = layerResult?.urls || (Array.isArray(result.images) ? result.images.map(image => String((image as { url?: string }).url || '')).filter(Boolean) : [url])
    job.resultJson = JSON.stringify({ resultUrls: urls, seed: result.seed, ...(layerResult ? { layers: layerResult.layers, baseWidth: layerResult.width, baseHeight: layerResult.height } : {}) })
    mergeSourceUrls(job, urls)
    job.failCode = ''
    job.failMsg = ''
    job.state = 'archiving'
    await job.save()
    return job
  }
  catch (error) {
    const errorStatus = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status || 0)
    // Validation/content-policy failures are terminal for every fal model.
    if (errorStatus === 422) {
      job.state = 'fail'
      job.failCode = '422'
      job.failMsg = readFalError(error, 'Fal generation failed')
      job.lastSyncAt = new Date()
      await job.save()
      return job as StoredDocument<IGenerationJob>
    }
    console.error('[fal sync]', job.taskId, Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status || 0) || '', error)
    job.lastSyncAt = new Date()
    await job.save()
    return job
  }
}
