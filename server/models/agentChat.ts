import { defineCollection } from '../utils/sqlite'

export interface IAgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  kind: '' | 'error'
  content: string
  imageIds: string[]
  confirmationState: '' | 'pending' | 'confirmed' | 'cancelled' | 'blocked'
  confirmation?: Record<string, unknown> | null
  resolvedParams?: Record<string, unknown> | null
  choice?: Record<string, unknown> | null
  choiceState?: '' | 'pending' | 'answered' | 'skipped'
  choiceAnswers?: Record<string, unknown>[]
  confirmationReason: string

}
export interface IAgentChatImage {
  name?: string
  id: string
  kind: string
  status: 'generating' | 'success' | 'fail'
  prompt: string
  url: string
  sourceUrl: string
  error: string
  aspectRatio: string
  resolution: string
  duration: number
}
export interface IAgentChat {
  sessionId: string
  projectId: string
  preview: string
  messages: IAgentChatMessage[]
  images: IAgentChatImage[]
  messageCount: number
  userTurnCount: number
  assistantTurnCount: number
  imageCount: number
  videoCount: number
  cutoutCount: number
  successCount: number
  failCount: number

  title: string
  quality: string
  confirmPolicy: string
  runtime: Record<string, unknown> | null
  lastEventAt: Date
  createdAt: Date
  updatedAt: Date
}
export const AgentChat = defineCollection<IAgentChat>('agent_chats', () => ({
  projectId: '',
  preview: '',
  messages: [],
  images: [],
  messageCount: 0,
  userTurnCount: 0,
  assistantTurnCount: 0,
  imageCount: 0,
  videoCount: 0,
  cutoutCount: 0,
  successCount: 0,
  failCount: 0,

  title: '',
  quality: 'economy',
  confirmPolicy: 'always',
  runtime: null,
  lastEventAt: new Date(),
}), [{ fields: ['sessionId'] }])
