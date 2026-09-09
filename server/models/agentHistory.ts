import type { AgentHistoryImage, AgentHistoryMessage } from '../../shared/types/agentHistory'
import { defineCollection } from '../utils/sqlite'

interface IAgentHistory {
  sessionId: string
  messageId: string
  message: AgentHistoryMessage
  images: AgentHistoryImage[]
  createdAt: Date
  updatedAt: Date
}
export const AgentHistory = defineCollection<IAgentHistory>('agent_history', () => ({
  images: [],
}), [{ fields: ['sessionId', 'messageId'] }])
