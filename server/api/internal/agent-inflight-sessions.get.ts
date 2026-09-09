import { listInflightAgentRuntimes } from '../../utils/agentSessionRuntime'

export default defineEventHandler(async (_event) => {
  return {
    items: await listInflightAgentRuntimes(),
  }
})
