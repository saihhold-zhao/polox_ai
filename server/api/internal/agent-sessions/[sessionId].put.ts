import { isAgentSessionId } from '../../../utils/agentChats'
import { upsertAgentRuntime } from '../../../utils/agentSessionRuntime'

export default defineEventHandler(async (event) => {
  const sessionId = String(getRouterParam(event, 'sessionId') || '').trim()
  if (!isAgentSessionId(sessionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sessionId is required',
    })
  }
  const body = await readBody<Record<string, unknown>>(event) || {}
  const saved = await upsertAgentRuntime({
    sessionId,
    projectId: String(body.projectId || ''),
    title: body.title,
    quality: body.quality,
    confirmPolicy: body.confirmPolicy,
    messages: body.messages,
    images: body.images,
    pendingConfirmation: body.pendingConfirmation,
    updatedAt: body.updatedAt,
  })
  if (!saved) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Session not found',
    })
  }
  return { ok: true, sessionId: saved.sessionId }
})
