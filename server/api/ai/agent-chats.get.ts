import { listAgentChats, toWorkspaceAgentChat } from '../../utils/agentChats'

export default defineEventHandler(async (event) => {
  const projectId = String(getQuery(event).projectId || '').trim()
  const chats = await listAgentChats(projectId)
  return {
    items: chats.map(chat => toWorkspaceAgentChat(chat)),
  }
})
