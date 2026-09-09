import { proxyAgentRequest } from '../../utils/agentGateway'

export default defineEventHandler(async (event) => {
  return proxyAgentRequest(event)
})
