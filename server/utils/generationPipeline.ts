import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { syncAgentRuntimeFromJob } from './agentSessionRuntime'
import { syncJobFromFal } from './falGenerate'
import { dispatchQueuedJobs, startPendingProviderJob } from './generationQueue'
import { mergeSourceUrls } from './generationResults'
import { isStoredMediaUrl, saveMediaFile } from './localMedia'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_ATTEMPTS = 12
const STALE_JOB_MS = 24 * 60 * 60 * 1000
const RESUME_INTERVAL_MS = 60 * 1000
const RESUME_CONCURRENCY = 2
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
}
const archiveLocks = new Map<string, Promise<StoredDocument<IGenerationJob> | null>>()
let resumePromise: Promise<void> | null = null
let resumeTimer: ReturnType<typeof setInterval> | undefined
type GenerationJobDocument = StoredDocument<IGenerationJob>
function extensionFrom(contentType: string, sourceUrl: string, preferVideo = false) {
  const type = contentType.split(';')[0]?.trim().toLowerCase() || ''
  if (type && EXTENSION_BY_TYPE[type])
    return EXTENSION_BY_TYPE[type]
  const match = sourceUrl.match(/\.(jpe?g|png|webp|gif|bmp|mp4|mov|webm|m4v|mkv)(?:\?|$)/i)?.[1]
  if (!match)
    return preferVideo || type.startsWith('video/') ? 'mp4' : 'png'
  return match.toLowerCase() === 'jpeg' ? 'jpg' : match.toLowerCase()
}
function contentTypeFrom(header: string | null, extension: string) {
  const type = header?.split(';')[0]?.trim().toLowerCase() || ''
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/'))
    return type
  if (extension === 'jpg' || extension === 'jpeg')
    return 'image/jpeg'
  if (extension === 'webp')
    return 'image/webp'
  if (extension === 'gif')
    return 'image/gif'
  if (extension === 'bmp')
    return 'image/bmp'
  if (extension === 'mp4' || extension === 'm4v')
    return 'video/mp4'
  if (extension === 'mov')
    return 'video/quicktime'
  if (extension === 'webm')
    return 'video/webm'
  return 'image/png'
}
function isVideoJob(job: IGenerationJob) {
  const model = String(job.model || '')
  return job.category === 'Video'
    || model.includes('seedance')
    || model.includes('flux-3')
    || model.startsWith('minimax-h3/')
    || model.startsWith('wan/')
}
async function syncProviderJob(job: GenerationJobDocument) {
  return syncJobFromFal(job)
}
function pendingAssets(job: IGenerationJob) {
  return (job.resultAssets || []).filter(asset => !(asset.status === 'uploaded' && asset.localUrl && isStoredMediaUrl(asset.localUrl)))
}
function needsArchive(job: IGenerationJob) {
  if (job.state === 'fail')
    return false
  if (job.state === 'moderating' || job.state === 'archiving')
    return true
  if (pendingAssets(job).length)
    return (job.sourceUrls || []).length > 0
  return (job.resultUrls || []).some(url => url && !isStoredMediaUrl(url))
}
function markStale(job: GenerationJobDocument) {
  if (job.state === 'queued')
    return false
  const age = Date.now() - new Date(job.createdAt).getTime()
  if (age < STALE_JOB_MS)
    return false
  if ((job.state === 'archiving' || job.state === 'moderating') && (job.sourceUrls || []).length)
    return false
  job.state = 'fail'
  job.failMsg = job.failMsg || 'Generation timed out'
  return true
}
function migrateLegacySourceUrls(job: GenerationJobDocument) {
  const remoteUrls = (job.resultUrls || []).filter(url => url && !isStoredMediaUrl(url))
  if (!remoteUrls.length)
    return false
  mergeSourceUrls(job, Array.from(new Set([...(job.sourceUrls || []), ...remoteUrls])))
  job.resultUrls = (job.resultAssets || [])
    .filter(asset => asset.status === 'uploaded' && asset.localUrl)
    .map(asset => asset.localUrl)
  if (job.state === 'success')
    job.state = 'archiving'
  return true
}
async function releaseGenerationSlot(job: GenerationJobDocument, _reason?: string) {
  await dispatchQueuedJobs()
  return job
}
async function downloadSource(url: string, preferVideo = false) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  })
  if (response.status === 404 || response.status === 410) {
    throw Object.assign(new Error('Generated file expired before it could be saved'), {
      permanent: true,
    })
  }
  if (!response.ok)
    throw new Error(`Failed to download generated file (${response.status})`)
  const headerType = response.headers.get('content-type')
  const extension = extensionFrom(headerType || '', url, preferVideo)
  const isVideo = extension === 'mp4' || extension === 'mov' || extension === 'webm' || extension === 'mkv' || extension === 'm4v'
    || Boolean(headerType?.startsWith('video/'))
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) {
    throw Object.assign(new Error(`Generated file is larger than ${Math.round(maxBytes / (1024 * 1024))}MB`), {
      permanent: true,
    })
  }
  return {
    buffer,
    contentType: contentTypeFrom(headerType, extension),
    extension,
  }
}
async function archiveJob(job: GenerationJobDocument) {
  migrateLegacySourceUrls(job)
  if (!needsArchive(job))
    return job
  if (job.archiveAttempts >= MAX_ARCHIVE_ATTEMPTS) {
    job.state = 'fail'
    job.failMsg = job.failMsg || 'Failed to store generated files'
    await job.save()
    return releaseGenerationSlot(job, job.failMsg)
  }
  job.state = 'archiving'
  job.archiveAttempts += 1
  job.lastArchiveAt = new Date()
  await job.save()
  for (const [index, asset] of job.resultAssets.entries()) {
    if (asset.status === 'uploaded' && asset.localUrl && isStoredMediaUrl(asset.localUrl))
      continue
    try {
      const downloaded = await downloadSource(asset.sourceUrl, isVideoJob(job))
      const key = `generator/results/${job.taskId}/${index}.${downloaded.extension}`
      const localUrl = await saveMediaFile(key, downloaded.buffer, downloaded.contentType)
      asset.localUrl = localUrl
      asset.localKey = key
      asset.contentType = downloaded.contentType
      asset.status = 'uploaded'
      asset.error = ''
      job.markModified('resultAssets')
      job.resultUrls = job.resultAssets
        .filter(entry => entry.status === 'uploaded' && entry.localUrl)
        .map(entry => entry.localUrl)
      await job.save()
    }
    catch (error) {
      const permanent = Boolean((error as {
        permanent?: boolean
      }).permanent)
      asset.status = permanent ? 'failed' : 'pending'
      asset.error = error instanceof Error ? error.message : 'Failed to store generated file'
      job.markModified('resultAssets')
      await job.save()
      if (permanent) {
        job.state = 'fail'
        job.failMsg = asset.error
        await job.save()
        return releaseGenerationSlot(job, job.failMsg)
      }
    }
  }
  const uploaded = job.resultAssets.filter(asset => asset.status === 'uploaded' && asset.localUrl)
  if (uploaded.length === job.resultAssets.length && uploaded.length > 0) {
    job.state = 'success'
    job.resultUrls = uploaded.map(asset => asset.localUrl)
    job.failCode = ''
    job.failMsg = ''
    await job.save()
    await dispatchQueuedJobs()
  }
  void syncAgentRuntimeFromJob(job)
  return job
}
export async function archiveGenerationResults(job: GenerationJobDocument) {
  const existing = archiveLocks.get(job.taskId)
  if (existing)
    return existing
  const pending = (async () => {
    const latest = await GenerationJob.findOne({ taskId: job.taskId })
    if (!latest)
      return null
    return archiveJob(latest)
  })()
    .catch((error) => {
      console.error('[generation archive]', job.taskId, error)
      return job
    })
    .finally(() => {
      archiveLocks.delete(job.taskId)
    })
  archiveLocks.set(job.taskId, pending)
  return pending
}
const AGENT_HOLD_ORPHAN_MS = 40 * 60 * 1000
const refreshLocks = new Map<string, Promise<GenerationJobDocument>>()
function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
function isOrphanAgentHold(job: IGenerationJob) {
  const original = asRecord(job.originalRequest)
  if (original?.source !== 'agent' || original?.holdSlot !== true)
    return false
  if (String(job.providerTaskId || '').trim())
    return false
  if (job.state !== 'generating' && job.state !== 'waiting' && job.state !== 'queuing')
    return false
  const age = Date.now() - new Date(job.createdAt).getTime()
  return age > AGENT_HOLD_ORPHAN_MS
}
export async function refreshGenerationJob(job: GenerationJobDocument) {
  if (isOrphanAgentHold(job)) {
    job.state = 'fail'
    job.failMsg = job.failMsg || 'Generation was interrupted. Retry this shot.'
    job.completeTime = Date.now()
    job.lastSyncAt = new Date()
    await job.save()
    await dispatchQueuedJobs()
    return job
  }
  const current = await startPendingProviderJob(job)
  migrateLegacySourceUrls(current)
  if (current.state === 'waiting' || current.state === 'queuing' || current.state === 'generating')
    await syncProviderJob(current)
  const latest = await GenerationJob.findOne({ taskId: current.taskId }) || current
  if (markStale(latest)) {
    await latest.save()
    await dispatchQueuedJobs()
    return latest
  }
  return latest
}
export function scheduleGenerationRefresh(job: GenerationJobDocument) {
  const existing = refreshLocks.get(job.taskId)
  if (existing)
    return existing
  const pending = refreshGenerationJob(job)
    .then(async (latest) => {
      if (needsArchive(latest)) {
        void archiveGenerationResults(latest).catch((error) => {
          console.error('[generation archive]', latest.taskId, error)
        })
      }
      return latest
    })
    .catch((error) => {
      console.error('[generation refresh]', job.taskId, error)
      return job
    })
    .finally(() => {
      refreshLocks.delete(job.taskId)
    })
  refreshLocks.set(job.taskId, pending)
  return pending
}
export async function finalizeGenerationJob(job: GenerationJobDocument) {
  const current = await refreshGenerationJob(job)
  let latest = await GenerationJob.findOne({ taskId: current.taskId }) || current
  if (latest.state === 'fail') {
    await dispatchQueuedJobs()
    return latest
  }
  if (needsArchive(latest))
    await archiveGenerationResults(latest)
  latest = await GenerationJob.findOne({ taskId: current.taskId }) || latest
  const settled = latest
  if (settled.state === 'success' || settled.state === 'fail')
    await dispatchQueuedJobs()
  return settled
}
export async function resumeIncompleteGenerationJobs() {
  if (resumePromise)
    return resumePromise
  resumePromise = (async () => {
    await dispatchQueuedJobs()
    const jobs = await GenerationJob.find({
      state: { $in: [...GENERATION_ACTIVE_STATES] },
      deleted: { $ne: true },
    })
      .sort({ updatedAt: 1 })
      .limit(20)
    const queue = [...jobs]
    async function runNext(): Promise<void> {
      const job = queue.shift()
      if (!job)
        return
      try {
        const current = await startPendingProviderJob(job)
        migrateLegacySourceUrls(current)
        if (current.state === 'waiting' || current.state === 'queuing' || current.state === 'generating')
          await syncProviderJob(current)
        const latest = await GenerationJob.findOne({ taskId: current.taskId }) || current
        if (markStale(latest)) {
          await latest.save()
          await dispatchQueuedJobs()
        }
        else if (needsArchive(latest)) {
          await archiveGenerationResults(latest)
          const archived = await GenerationJob.findOne({ taskId: latest.taskId }) || latest
          if (archived.state === 'success' || archived.state === 'fail')
            await dispatchQueuedJobs()
        }
      }
      catch (error) {
        console.error('[generation resume]', job.taskId, error)
      }
      await runNext()
    }
    await Promise.all(Array.from({ length: Math.min(RESUME_CONCURRENCY, queue.length) }, () => runNext()))
  })()
    .catch((error) => {
      console.error('[generation resume]', error)
    })
    .finally(() => {
      resumePromise = null
    })
  return resumePromise
}
export function startGenerationResumeLoop() {
  if (resumeTimer)
    return
  void resumeIncompleteGenerationJobs()
  resumeTimer = setInterval(() => {
    void resumeIncompleteGenerationJobs()
  }, RESUME_INTERVAL_MS)
}
