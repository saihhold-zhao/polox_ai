import type { AgentResultItem } from '../../utils/agentJobs'
import { recordAgentResults } from '../../utils/agentJobs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    projectId?: string
    items?: AgentResultItem[]
  }>(event)
  const projectId = String(body?.projectId || '').trim()
  const items = Array.isArray(body?.items) ? body.items : []
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'projectId is required',
    })
  }
  return recordAgentResults(projectId, items)
})
