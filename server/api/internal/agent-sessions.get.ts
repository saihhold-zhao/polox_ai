import { listAgentRuntimes } from '../../utils/agentSessionRuntime'

export default defineEventHandler(async (event) => {
  const projectId = String(getQuery(event).projectId || '').trim()
  return {
    items: await listAgentRuntimes(projectId),
  }
})
