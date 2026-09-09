import type { AgentSession } from './session'
import type { AgentImage } from './types'
import { isAgentDisconnectError } from '~~/shared/utils/agentRecovery'
import { GenerationJob } from '../models/generationJob'
import { agentResultTaskId } from '../utils/agentJobs'
import { connectDatabase } from '../utils/sqlite'
import { IMAGE_TIMEOUT_MS, pollFalTask, VIDEO_25_TIMEOUT_MS, VIDEO_TIMEOUT_MS } from './modelGeneration'
import { SESSION_ORPHAN_MS } from './policy'
import { adoptStoredSnapshot, bootSessions, persistNow, upsertImage } from './session'
import { fetchRemoteInflightSessions, fetchRemotePendingConfirmSessions, fetchRemoteRecentAutoSessions } from './sessionStore'
import { bindGenerationSlot, completeGenerationSlot } from './slots'

const inFlight = new Set<string>()
const continueInFlight = new Set<string>()
const RESUME_INTERVAL_MS = 20000
let resumeTimer: ReturnType<typeof setInterval> | undefined
let resumePromise: Promise<void> | null = null
function timeoutFor(image: AgentImage) {
  if (image.kind === 'video')
    return image.videoFamily === 'seedance-2-5' ? VIDEO_25_TIMEOUT_MS : VIDEO_TIMEOUT_MS
  if (image.kind === 'cutout')
    return 4 * 60 * 1000
  return IMAGE_TIMEOUT_MS
}
function sessionHasInflightMedia(sessionId: string) {
  for (const key of inFlight) {
    if (key.startsWith(`${sessionId}:`))
      return true
  }
  return false
}
async function maybeContinueSession(session: AgentSession) {
  if (session.busy || session.stopRequested || continueInFlight.has(session.id))
    return
  if (session.images.some(item => item.status === 'generating'))
    return
  if (sessionHasInflightMedia(session.id))
    return
  continueInFlight.add(session.id)
  try {
    const { continueAgentSession } = await import('./loop')
    await continueAgentSession(session.id)
  }
  catch (error) {
    console.error('[agent session continue]', session.id, error)
  }
  finally {
    continueInFlight.delete(session.id)
  }
}
async function recoverImageFromJob(session: AgentSession, image: AgentImage) {
  if (image.status !== 'generating')
    return image
  try {
    await connectDatabase()
    const taskId = agentResultTaskId(image.id)
    const job = await GenerationJob.findOne({
      taskId,
      deleted: { $ne: true },
    })
    if (!job)
      return image
    const providerTaskId = String(job.providerTaskId || '').trim()
    if (providerTaskId && !String(image.providerTaskId || '').trim()) {
      const next = { ...image, providerTaskId }
      upsertImage(session, next)
      persistNow(session)
      return next
    }
    const url = String((job.resultUrls || []).find((item: string) => /^https?:\/\//i.test(item)) || '').trim()
    if (job.state === 'success' || job.state === 'archiving' || job.state === 'moderating') {
      if (!url)
        return image
      const next: AgentImage = {
        ...image,
        providerTaskId: providerTaskId || image.providerTaskId,
        status: 'success',
        url,
        error: '',
      }
      upsertImage(session, next)
      if (image.modelId) {
        for (const [index, resultUrl] of job.resultUrls.entries()) {
          if (index)
            upsertImage(session, { ...next, id: `${image.id}_${index}`, url: resultUrl })
        }
      }
      persistNow(session)
      return next
    }
    if (job.state === 'fail') {
      const next: AgentImage = {
        ...image,
        providerTaskId: providerTaskId || image.providerTaskId,
        status: 'fail',
        url: '',
        error: String(job.failMsg || 'Generation failed'),
      }
      upsertImage(session, next)
      persistNow(session)
      return next
    }
  }
  catch (error) {
    console.error('[agent resume job recover]', session.id, image.id, error)
  }
  return image
}
async function finishImage(session: AgentSession, image: AgentImage, providerTaskId: string) {
  await bindGenerationSlot({
    callId: image.id,
    providerTaskId,
    bffUrl: session.bffUrl,
  })
  try {
    const result = await pollFalTask(providerTaskId, {
      timeoutMs: timeoutFor(image),
      failLabel: image.kind === 'video' ? 'Video generation failed' : 'Generation failed',
    })
    const next: AgentImage = {
      ...image,
      providerTaskId,
      status: 'success',
      url: result.urls[0] || '',
      error: '',
    }
    upsertImage(session, next)
    persistNow(session)
    const completed = await completeGenerationSlot({
      callId: image.id,
      bffUrl: session.bffUrl,
      url: next.url,
    })
    if (completed.state === 'fail') {
      const message = completed.message || 'Generation failed'
      const failed: AgentImage = {
        ...next,
        status: 'fail',
        url: '',
        error: message,
      }
      upsertImage(session, failed)
      persistNow(session)
    }
  }
  catch (error) {
    const current = session.images.find(item => item.id === image.id)
    if (current?.status === 'success' && current.url)
      return
    if (isAgentDisconnectError(error)) {
      console.warn('[agent resume transient error]', session.id, image.id, error)
      return
    }
    const message = error instanceof Error ? error.message : 'Generation failed'
    const next: AgentImage = {
      ...image,
      providerTaskId,
      status: 'fail',
      error: message,
    }
    upsertImage(session, next)
    persistNow(session)
    await completeGenerationSlot({
      callId: image.id,
      bffUrl: session.bffUrl,
      error: message,
    })
  }
}
function failOrphanGenerating(session: AgentSession) {
  if (session.busy)
    return
    // After deploy, images without a provider task cannot resume — fail them sooner.
  const orphanMs = session.images.some(item => item.status === 'generating' && !String(item.providerTaskId || '').trim())
    ? Math.min(SESSION_ORPHAN_MS, 2 * 60 * 1000)
    : SESSION_ORPHAN_MS
  if (Date.now() - session.updatedAt < orphanMs)
    return
  let changed = false
  for (const image of session.images) {
    if (image.status !== 'generating')
      continue
    if (image.modelId || String(image.providerTaskId || '').trim())
      continue
    const message = image.kind === 'cutout'
      ? 'Background removal interrupted'
      : 'Generation was interrupted. Retry this shot.'
    upsertImage(session, {
      ...image,
      status: 'fail',
      error: image.error || message,
    })
    changed = true
    void completeGenerationSlot({
      callId: image.id,
      bffUrl: session.bffUrl,
      error: image.error || message,
    })
  }
  if (changed)
    persistNow(session)
}
export function scheduleSessionResume(session: AgentSession) {
  void (async () => {
    for (const raw of [...session.images]) {
      if (raw.status !== 'generating')
        continue
      if (raw.kind === 'cutout' && !raw.modelId)
        continue
      const image = await recoverImageFromJob(session, raw)
      if (image.status !== 'generating')
        continue
      // Registered models are polled and archived by the shared provider pipeline.
      if (image.modelId)
        continue
      const providerTaskId = String(image.providerTaskId || '').trim()
      if (!providerTaskId)
        continue
      const key = `${session.id}:${image.id}`
      if (inFlight.has(key))
        continue
      inFlight.add(key)
      void finishImage(session, image, providerTaskId)
        .catch((error) => {
          console.error('[agent session resume image]', session.id, image.id, error)
        })
        .finally(() => {
          inFlight.delete(key)
          void maybeContinueSession(session)
        })
    }
    failOrphanGenerating(session)
    await resumeAutoConfirm(session)
    await maybeContinueSession(session)
  })().catch(error => console.error('[agent session recovery]', session.id, error))
}
async function resumeAutoConfirm(session: AgentSession) {
  if (!session.pendingConfirmation || session.busy)
    return
  try {
    const { continueServerAutoConfirm, shouldServerAutoConfirm } = await import('./loop')
    if (!shouldServerAutoConfirm(session.confirmPolicy, session.pendingConfirmation.payload))
      return
    await continueServerAutoConfirm(session.id)
  }
  catch (error) {
    console.error('[agent auto-confirm resume]', session.id, error)
  }
}
async function resumeRemoteInflight() {
  const seen = new Set<string>()
  const snapshots = [
    ...await fetchRemoteInflightSessions(),
    ...await fetchRemotePendingConfirmSessions(),
    ...await fetchRemoteRecentAutoSessions(),
  ]
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.id))
      continue
    seen.add(snapshot.id)
    const session = adoptStoredSnapshot(snapshot)
    scheduleSessionResume(session)
  }
}
async function resumeAll() {
  if (resumePromise)
    return resumePromise
  resumePromise = (async () => {
    for (const session of bootSessions())
      scheduleSessionResume(session)
    await resumeRemoteInflight()
  })()
    .catch((error) => {
      console.error('[agent session resume]', error)
    })
    .finally(() => {
      resumePromise = null
    })
  return resumePromise
}
export function startSessionResumeLoop() {
  if (import.meta.prerender)
    return
  if (resumeTimer)
    return
  void resumeAll()
  resumeTimer = setInterval(() => {
    void resumeAll()
  }, RESUME_INTERVAL_MS)
}
