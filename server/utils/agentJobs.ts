import type { GenerationJobPublic } from '../../shared/types/generation'
import { AGENT_CONCAT_MODEL, isConcatenatedPrompt, isConcatVideoMode } from '~~/shared/utils/agentConcat'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { IDEOGRAM_REMOVE_BACKGROUND_MODEL } from '~~/shared/utils/ideogram'
import { GenerationJob } from '../models/generationJob'
import { isFalGenerateModel } from './falGenerate'
import { toPublicJob } from './generationResults'
import { resolveProject } from './projects'
import { connectDatabase } from './sqlite'

export interface AgentResultItem {
  modelId?: string
  modelInput?: Record<string, unknown>
  id: string
  kind?: string
  name?: string
  prompt?: string
  url: string
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  aspectRatio?: string
  resolution?: string
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: 'seedance-2' | 'seedance-2-5' | 'wan-3'
}
function taskIdFor(id: string) {
  return `agent_${id}`.slice(0, 120)
}
export function agentResultTaskId(id: string) {
  return taskIdFor(id)
}
export function httpUrlList(values: Array<string | undefined> | undefined, cap = 32) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values || []) {
    const url = String(value || '').trim()
    if (!/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('blob:') || seen.has(url))
      continue
    seen.add(url)
    out.push(url)
    if (out.length >= cap)
      break
  }
  return out
}
function isConcatItem(item: AgentResultItem) {
  return isConcatVideoMode(item.videoMode) || isConcatenatedPrompt(item.prompt)
}
function modelFor(item: AgentResultItem) {
  const selected = AGENT_MODELS.find(model => model.id === item.modelId)
  if (selected)
    return { provider: 'fal' as const, model: selected.id, category: selected.category, task: selected.task }
  if (item.kind === 'cutout') {
    return {
      provider: 'fal' as const,
      model: IDEOGRAM_REMOVE_BACKGROUND_MODEL,
      category: 'Tools',
      task: 'Remove Background',
    }
  }
  if (item.kind === 'video' && isConcatItem(item)) {
    return {
      provider: 'fal' as const,
      model: AGENT_CONCAT_MODEL,
      category: 'Video',
      // Concat may stitch mixed models — do not attribute a generative task.
      task: '',
    }
  }
  if (item.kind === 'video') {
    const mode = item.videoMode
      || (item.sourceUrl ? 'image' : 'text')
    const prefix = item.videoFamily === 'seedance-2-5'
      ? 'bytedance/seedance-2-5'
      : item.videoFamily === 'wan-3'
        ? 'wan/3-0-video'
        : 'bytedance/seedance-2'
    if (mode === 'reference') {
      return {
        provider: 'fal' as const,
        model: `${prefix}-reference-to-video`,
        category: 'Video',
        task: 'Reference to Video',
      }
    }
    return {
      provider: 'fal' as const,
      model: mode === 'image'
        ? `${prefix}-image-to-video`
        : `${prefix}-text-to-video`,
      category: 'Video',
      task: mode === 'image' ? 'Image to Video' : 'Text to Video',
    }
  }
  return {
    provider: 'fal' as const,
    model: item.sourceUrl
      ? 'gpt-image-2-image-to-image'
      : 'gpt-image-2-text-to-image',
    category: 'Image',
    task: item.sourceUrl ? 'Image to Image' : 'Text to Image',
  }
}
function inputFor(item: AgentResultItem) {
  if (item.modelId && AGENT_MODELS.some(model => model.id === item.modelId) && item.modelInput)
    return item.modelInput
  const prompt = String(item.prompt || '').trim()
  const stills = httpUrlList(item.inputUrls?.length ? item.inputUrls : [item.sourceUrl])
  const videos = httpUrlList(item.referenceVideoUrls)
  if (item.kind === 'cutout') {
    return {
      image_url: stills[0] || item.sourceUrl || item.url,
    }
  }
  if (item.kind === 'video' && isConcatItem(item)) {
    return {
      prompt,
      operation: 'concat',
      ...(videos.length ? { video_urls: videos } : {}),
    }
  }
  if (item.kind === 'video') {
    const mode = item.videoMode
      || (stills.length > 1 || videos.length ? 'reference' : (stills[0] || item.sourceUrl ? 'image' : 'text'))
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: item.aspectRatio || (mode === 'image' ? 'adaptive' : '16:9'),
      resolution: item.videoFamily === 'wan-3'
        ? (/^720p$/i.test(String(item.resolution || ''))
            ? '720P'
            : /^1080p$/i.test(String(item.resolution || ''))
              ? '1080P'
              : '480P')
        : (item.resolution || '480p'),
      duration: item.duration || 5,
      ...(item.videoFamily === 'wan-3' ? { audio: true } : {}),
    }
    if (mode === 'reference') {
      if (stills.length)
        input.reference_image_urls = stills
      if (videos.length)
        input.reference_video_urls = videos
    }
    else if (mode === 'image' && stills[0]) {
      input.first_frame_url = stills[0]
      if (stills[1])
        input.last_frame_url = stills[1]
    }
    return input
  }
  return {
    prompt,
    aspect_ratio: item.aspectRatio || 'auto',
    resolution: item.resolution || '1K',
    ...(stills.length ? { input_urls: stills } : {}),
  }
}
export async function recordAgentResults(projectId: string, items: AgentResultItem[]) {
  await connectDatabase()
  const project = await resolveProject(projectId)
  const jobs: GenerationJobPublic[] = []
  const importedIds: string[] = []
  for (const item of items.slice(0, 8)) {
    const id = String(item.id || '').trim()
    const url = String(item.url || '').trim()
    if (!id || !/^https?:\/\//i.test(url))
      continue
    if (item.kind === 'upload')
      continue
    const taskId = taskIdFor(id)
    const meta = modelFor(item)
    const input = { ...inputFor(item), asset_name: String(item.name || '').trim().slice(0, 100) }
    const now = new Date()
    const refs = httpUrlList([
      ...(item.inputUrls || []),
      ...(item.referenceVideoUrls || []),
      item.sourceUrl,
      url,
    ])
    const existing = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
    if (existing && existing.originalRequest?.source === 'agent' && existing.originalRequest?.holdSlot === false) {
      existing.projectId = String(project._id)
      await existing.save()
      jobs.push(toPublicJob(existing))
      importedIds.push(id)
      continue
    }
    if (existing) {
      existing.projectId = String(project._id)
      existing.provider = meta.provider
      existing.set('model', meta.model)
      existing.category = meta.category
      existing.task = meta.task
      existing.state = 'success'
      existing.resultUrls = [url]
      existing.sourceUrls = refs
      existing.failCode = ''
      existing.failMsg = ''
      existing.input = input
      existing.requestBody = { model: meta.model, input }
      existing.completeTime = now.getTime()
      existing.lastSyncAt = now
      await existing.save()
      jobs.push(toPublicJob(existing))
      importedIds.push(id)
      continue
    }
    const job = await GenerationJob.create({
      projectId: String(project._id),
      provider: meta.provider,
      model: meta.model,
      category: meta.category,
      task: meta.task,
      input,
      requestBody: { model: meta.model, input },
      originalRequest: { source: 'agent', imageId: id, ...(isConcatItem(item) ? { operation: 'concat' } : {}) },
      taskId,
      providerTaskId: '',
      state: 'success',
      sourceUrls: refs,
      resultUrls: [url],
      resultAssets: [],
      resultJson: '',
      failCode: '',
      failMsg: '',

      archiveAttempts: 0,
      completeTime: now.getTime(),
      lastSyncAt: now,
    })
    jobs.push(toPublicJob(job))
    importedIds.push(id)
  }
  return { jobs, importedIds }
}
