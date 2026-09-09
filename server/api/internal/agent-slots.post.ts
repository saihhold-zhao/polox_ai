import { acquireAgentSlot, bindAgentSlot, completeAgentSlot, readAgentSlot } from '../../utils/agentSlots'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event) || {}
  const action = String(body.action || '').trim()
  const callId = String(body.callId || '').trim()
  if (action === 'acquire') {
    return acquireAgentSlot({
      sessionId: String(body.sessionId || '').trim(),
      callId,
      projectId: String(body.projectId || '').trim(),
      kind: String(body.kind || '').trim(),
      prompt: String(body.prompt || ''),
      aspectRatio: String(body.aspectRatio || ''),
      resolution: String(body.resolution || ''),
      duration: Number(body.duration) || undefined,
      sourceUrl: String(body.sourceUrl || ''),
      inputUrls: Array.isArray(body.inputUrls) ? body.inputUrls.map(item => String(item || '')) : [],
      referenceVideoUrls: Array.isArray(body.referenceVideoUrls) ? body.referenceVideoUrls.map(item => String(item || '')) : [],
      videoMode: String(body.videoMode || ''),
      videoFamily: String(body.videoFamily || ''),
    })
  }
  if (action === 'status')
    return readAgentSlot(callId)
  if (action === 'complete') {
    return completeAgentSlot({
      callId,
      url: String(body.url || ''),
      error: String(body.error || ''),
    })
  }
  if (action === 'bind') {
    return bindAgentSlot({
      callId,
      providerTaskId: String(body.providerTaskId || ''),
    })
  }
  throw createError({
    statusCode: 400,
    statusMessage: 'action must be acquire, status, complete, or bind',
  })
})
