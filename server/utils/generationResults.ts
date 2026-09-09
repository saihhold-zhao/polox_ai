import type { GenerationJobPublic } from '../../shared/types/generation'
import type { IGenerationJob, IResultAsset } from '../models/generationJob'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'

export function parseResultUrls(resultJson?: string) {
  if (!resultJson)
    return []

  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>
    const lists = [parsed.resultUrls, parsed.result_urls, parsed.urls, parsed.originUrls]
    for (const list of lists) {
      if (!Array.isArray(list))
        continue
      const urls = list.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
      if (urls.length)
        return urls
    }
    for (const key of ['resultUrl', 'video_url', 'image_url', 'url']) {
      const value = parsed[key]
      if (typeof value === 'string' && /^https?:\/\//.test(value))
        return [value]
    }
    return []
  }
  catch {
    return []
  }
}

function toCompletedAt(job: IGenerationJob) {
  if (job.state !== 'success' && job.state !== 'fail')
    return ''

  if (typeof job.completeTime === 'number' && Number.isFinite(job.completeTime) && job.completeTime > 0) {
    const ms = job.completeTime < 1e12 ? job.completeTime * 1000 : job.completeTime
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime()))
      return date.toISOString()
  }

  return job.updatedAt.toISOString()
}

function httpJobUrls(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(url => /^https?:\/\//i.test(url))
  }
  const url = String(value || '').trim()
  return /^https?:\/\//i.test(url) ? [url] : []
}

function inputUrlSet(job: IGenerationJob) {
  const input = job.input && typeof job.input === 'object' ? job.input : {}
  return new Set([
    ...httpJobUrls(input.reference_image_urls),
    ...httpJobUrls(input.reference_video_urls),
    ...httpJobUrls(input.first_frame_url),
    ...httpJobUrls(input.last_frame_url),
    ...httpJobUrls(input.input_urls),
    ...['image_urls', 'video_urls', 'audio_urls', 'image_url', 'start_image_url', 'end_image_url'].flatMap(key => httpJobUrls(input[key])),
  ])
}

function publicResultUrls(job: IGenerationJob) {
  if (job.state === 'fail')
    return []
  if (job.resultUrls?.length)
    return job.resultUrls
  if (job.state !== 'success' && job.state !== 'archiving' && job.state !== 'moderating')
    return []
  const inputs = inputUrlSet(job)
  const fromAssets = (job.resultAssets || [])
    .map(asset => String(asset.localUrl || asset.sourceUrl || '').trim())
    .filter(url => /^https?:\/\//i.test(url) && !inputs.has(url))
  if (fromAssets.length)
    return fromAssets
  return (job.sourceUrls || []).filter(url => /^https?:\/\//i.test(url) && !inputs.has(url))
}

function publicImageLayers(job: IGenerationJob): GenerationJobPublic['layers'] {
  if (!isImageLayerSplitterModel(job.model) || job.state !== 'success')
    return undefined
  try {
    const result = JSON.parse(job.resultJson)
    if (!Array.isArray(result.layers))
      return undefined
    return result.layers.map((layer: { name?: string, description?: string, z_index: number, bounding_box?: unknown }) => ({
      name: layer.name || (layer.z_index === 0 ? 'Background' : `Layer ${layer.z_index}`),
      description: layer.description || '',
      zIndex: layer.z_index,
      boundingBox: layer.bounding_box,
    }))
  }
  catch {
    return undefined
  }
}

export function toPublicJob(job: IGenerationJob): GenerationJobPublic {
  const prompt = typeof job.input?.prompt === 'string' ? job.input.prompt : ''
  return {
    taskId: job.taskId,
    projectId: job.projectId || '',
    model: job.model,
    category: job.category || '',
    task: job.task || '',
    prompt,
    input: job.input && typeof job.input === 'object' ? job.input : {},
    state: job.state,
    resultUrls: publicResultUrls(job),
    ...(isImageLayerSplitterModel(job.model) ? { layers: publicImageLayers(job) } : {}),
    failCode: job.failCode || '',
    failMsg: job.failMsg || '',
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: toCompletedAt(job),

  }
}

function emptyAsset(sourceUrl: string): IResultAsset {
  return {
    sourceUrl,
    localUrl: '',
    localKey: '',
    contentType: '',
    status: 'pending',
    error: '',
  }
}

export function mergeSourceUrls(job: IGenerationJob, urls: string[]) {
  job.sourceUrls = urls
  const existing = new Map((job.resultAssets || []).map(asset => [asset.sourceUrl, asset]))
  job.resultAssets = urls.map(sourceUrl => existing.get(sourceUrl) || emptyAsset(sourceUrl))
}
