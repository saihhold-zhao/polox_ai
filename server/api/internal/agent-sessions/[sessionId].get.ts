import { isAgentSessionId } from '../../../utils/agentChats'
import { getAgentRuntime } from '../../../utils/agentSessionRuntime'

export default defineEventHandler(async (event) => {
  const sessionId = String(getRouterParam(event, 'sessionId') || '').trim()
  if (!isAgentSessionId(sessionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'sessionId is required',
    })
  }
  const runtime = await getAgentRuntime(sessionId)
  if (!runtime) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Session not found',
    })
  }
  return runtime
})
