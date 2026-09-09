export interface AgentHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: string
  imageIds?: string[]
  confirmation?: Record<string, unknown> | null
  resolvedParams?: Record<string, unknown> | null
  confirmationState?: string
  confirmationReason?: string

  choiceState?: string
  choiceAnswers?: Record<string, unknown>[]
}

export interface AgentHistoryImage {
  id: string
  kind: string
  status: 'generating' | 'success' | 'fail'
  prompt: string
  url: string
  sourceUrl?: string
  error?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
}

export interface AgentHistoryPage {
  messages: AgentHistoryMessage[]
  images: AgentHistoryImage[]
  olderCursor: string | null
  newerCursor: string | null
}
