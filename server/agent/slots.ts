import { publicGenerationFailMessage } from '../../shared/types/generation'
import { acquireAgentSlot, bindAgentSlot, completeAgentSlot, readAgentSlot } from '../utils/agentSlots'

export interface SlotSnapshot {
  callId: string
  state: string
  queued: boolean
  limit: number
  active: number
  message: string
}
export interface SlotMeta {
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
}
export async function acquireGenerationSlot(input: {
  sessionId: string
  callId: string
  projectId?: string
  bffUrl?: string
  meta?: SlotMeta
  signal?: AbortSignal
}): Promise<SlotSnapshot> {
  if (input.signal?.aborted)
    throw new Error('Generation aborted')
  return acquireAgentSlot({
    sessionId: input.sessionId,
    callId: input.callId,
    projectId: input.projectId || '',
    ...input.meta,
  })
}
export async function waitForGenerationSlot(input: {
  callId: string
  bffUrl?: string
  signal?: AbortSignal
  onUpdate?: (slot: SlotSnapshot) => void
}): Promise<SlotSnapshot> {
  while (true) {
    if (input.signal?.aborted)
      throw new Error('Generation aborted')
    const slot = await readAgentSlot(input.callId)
    input.onUpdate?.(slot)
    if (slot.state === 'fail')
      throw new Error(slot.message || 'Generation slot was released')
    if (slot.state !== 'queued')
      return slot
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        input.signal?.removeEventListener('abort', onAbort)
        resolve()
      }, 1000)
      function onAbort() {
        clearTimeout(timer)
        reject(new Error('Generation aborted'))
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
export async function bindGenerationSlot(input: {
  callId: string
  providerTaskId: string
  bffUrl?: string
}): Promise<void> {
  const providerTaskId = String(input.providerTaskId || '').trim()
  if (!providerTaskId)
    return
  try {
    await bindAgentSlot({
      callId: input.callId,
      providerTaskId,
    })
  }
  catch (error) {
    console.error('[agent slot bind]', input.callId, error)
  }
}
export async function completeGenerationSlot(input: {
  callId: string
  bffUrl?: string
  url?: string
  error?: string
}): Promise<SlotSnapshot> {
  try {
    return await completeAgentSlot({
      callId: input.callId,
      url: input.url || '',
      error: input.error || '',
    })
  }
  catch (error) {
    console.error('[agent slot complete]', input.callId, error)
    return {
      callId: input.callId,
      state: 'fail',
      queued: false,
      limit: 0,
      active: 0,
      message: publicGenerationFailMessage(error),
    }
  }
}
