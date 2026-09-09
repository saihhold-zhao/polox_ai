import { getAgentChat, isAgentSessionId, toWorkspaceAgentChat } from '../../../utils/agentChats'

export default defineEventHandler(async (event) => {
  const sessionId = String(getRouterParam(event, 'sessionId') || '').trim()
  if (!isAgentSessionId(sessionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sessionId is required',
    })
  }
  const chat = await getAgentChat(sessionId)
  if (!chat) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Session not found',
    })
  }
  return toWorkspaceAgentChat(chat)
})
