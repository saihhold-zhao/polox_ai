import { upsertAgentChat } from '../../utils/agentChats'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    sessionId?: string
    projectId?: string
    messages?: unknown
    images?: unknown
  }>(event)
  const saved = await upsertAgentChat({
    sessionId: String(body?.sessionId || ''),
    projectId: String(body?.projectId || ''),
    messages: body?.messages,
    images: body?.images,
    replaceMessages: true,
    replaceImages: true,
  })
  if (!saved) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sessionId is required',
    })
  }
  return { ok: true, sessionId: saved.sessionId }
})
