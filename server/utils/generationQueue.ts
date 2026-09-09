import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { createFalTask } from './falGenerate'
import { generationConcurrency } from './generationConcurrency'
import { isProviderStarted } from './generationJobs'

type GenerationJobDocument = StoredDocument<IGenerationJob>
let dispatching: Promise<void> | undefined
let dispatchAgain = false
function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
export function newLocalTaskId() {
  return `job_${crypto.randomUUID()}`
}
export async function countActiveGenerationJobs() {
  return GenerationJob.countDocuments({
    deleted: { $ne: true },
    state: { $in: [...GENERATION_ACTIVE_STATES] },
  })
}
async function failUnstartedJob(job: GenerationJobDocument, error: unknown) {
  const message = readErrorMessage(error, 'Generation failed')
  job.state = 'fail'
  job.failMsg = message
  await job.save()
  return job
}
async function startProviderTask(job: GenerationJobDocument) {
  if (job.provider && job.provider !== 'fal') return failUnstartedJob(job, new Error('This task belongs to a retired provider. Please generate again.'))
  const original = asRecord(job.originalRequest)
  if (original?.source === 'agent' && original?.holdSlot === true) {
    if (job.state === 'queued' || job.state === 'waiting' || job.state === 'queuing') {
      job.state = 'generating'
      job.lastSyncAt = new Date()
      await job.save()
    }
    return job
  }
  if (isProviderStarted(job))
    return job
  const requestBody = asRecord(job.requestBody) || {}
  // Ignore legacy text-compositing metadata on already persisted jobs.
  const { _textEdit, ...input } = job.input && typeof job.input === 'object' ? job.input : {}
  {
    const falModel = String(requestBody.model || job.model || '').trim()
    const falTask = await createFalTask(falModel, input)
    job.providerTaskId = falTask.requestId
    job.requestBody = {
      ...requestBody,
      statusUrl: falTask.statusUrl,
      responseUrl: falTask.responseUrl,
    }
    job.state = 'waiting'
    job.lastSyncAt = new Date()
    await job.save()
    return job
  }

}
async function dispatchOnce() {
  const limit = await generationConcurrency()
  for (let i = 0; i < limit + 2; i++) {
    const active = await countActiveGenerationJobs()
    if (active >= limit)
      return
    const claimed = await GenerationJob.findOneAndUpdate({
      deleted: { $ne: true },
      state: 'queued',
    }, {
      $set: {
        state: 'waiting',
        lastSyncAt: new Date(),
      },
    }, {
      sort: { createdAt: 1 },
      new: true,
    })
    if (!claimed)
      return
    const activeAfter = await countActiveGenerationJobs()
    if (activeAfter > limit) {
      if (!isProviderStarted(claimed)) {
        claimed.state = 'queued'
        await claimed.save()
      }
      return
    }
    try {
      await startProviderTask(claimed)
    }
    catch (error) {
      console.error('[generation queue start]', claimed.taskId, error)
      await failUnstartedJob(claimed, error)
    }
  }
}
export function dispatchQueuedJobs(): Promise<void> {
  dispatchAgain = true
  if (dispatching)
    return dispatching
  dispatching = (async () => {
    try {
      do {
        dispatchAgain = false
        await dispatchOnce()
      } while (dispatchAgain)
    }
    catch (error) {
      console.error('[generation queue]', error)
    }
    finally {
      dispatching = undefined
    }
  })()
  return dispatching
}

export async function startPendingProviderJob(job: GenerationJobDocument) {
  if (job.state === 'queued') {
    await dispatchQueuedJobs()
    return (await GenerationJob.findById(job._id)) || job
  }
  if ((job.state === 'waiting' || job.state === 'queuing' || job.state === 'generating') && !isProviderStarted(job)) {
    try {
      return await startProviderTask(job)
    }
    catch (error) {
      console.error('[generation queue retry]', job.taskId, error)
      return failUnstartedJob(job, error)
    }
  }
  return job
}
