import type { AgentRuntimeSnapshot } from '../utils/agentSessionRuntime'
import type { AgentConfirmPolicy, AgentImage, AgentQuality, ChatMessage, ChoicePayload, ConfirmationPayload } from './types'
import { getAgentRuntime, listAgentRuntimes, listInflightAgentRuntimes, listPendingConfirmAgentRuntimes, listRecentAutoAgentRuntimes, upsertAgentRuntime } from '../utils/agentSessionRuntime'
import { parseAgentConfirmPolicy, parseAgentQuality } from './quality'

export interface RemotePendingConfirmation {
  payload: ConfirmationPayload
  items: Array<{
    toolCallId: string
    tool: string
    argsJson: string
  }>
}
export interface RemotePendingChoice {
  payload: ChoicePayload
  items: Array<{
    toolCallId: string
    tool: string
    argsJson: string
  }>
}
export interface StoredSessionSnapshot {
  id: string
  projectId?: string
  title?: string
  quality: AgentQuality
  confirmPolicy: AgentConfirmPolicy
  messages: ChatMessage[]
  images: AgentImage[]
  pendingConfirmation: RemotePendingConfirmation | null
  pendingChoice: RemotePendingChoice | null
  updatedAt: number
}
function asSnapshot(raw: AgentRuntimeSnapshot): StoredSessionSnapshot {
  return {
    id: raw.sessionId,
    projectId: raw.projectId || '',
    title: raw.title || '',
    quality: parseAgentQuality(raw.quality),
    confirmPolicy: parseAgentConfirmPolicy(raw.confirmPolicy),
    messages: Array.isArray(raw.messages) ? raw.messages as ChatMessage[] : [],
    images: Array.isArray(raw.images) ? raw.images as AgentImage[] : [],
    pendingConfirmation: raw.pendingConfirmation && typeof raw.pendingConfirmation === 'object'
      ? raw.pendingConfirmation as RemotePendingConfirmation
      : null,
    pendingChoice: raw.pendingChoice && typeof raw.pendingChoice === 'object'
      ? raw.pendingChoice as RemotePendingChoice
      : null,
    updatedAt: Number(raw.updatedAt) || Date.now(),
  }
}
export async function fetchStoredSession(sessionId: string, _bffUrl?: string) {
  const runtime = await getAgentRuntime(sessionId)
  return runtime ? asSnapshot(runtime) : null
}
export async function fetchRemoteInflightSessions() {
  const items = await listInflightAgentRuntimes(40)
  return items.map(asSnapshot)
}
export async function fetchRemotePendingConfirmSessions() {
  const items = await listPendingConfirmAgentRuntimes(40)
  return items.map(asSnapshot)
}
export async function fetchRemoteRecentAutoSessions() {
  const items = await listRecentAutoAgentRuntimes(40)
  return items.map(asSnapshot)
}
export async function fetchStoredSessionList(projectId = '', _bffUrl?: string) {
  const items = await listAgentRuntimes(projectId)
  return items.map(asSnapshot)
}
export async function putStoredSession(input: {
  id: string
  projectId?: string
  title?: string
  quality: AgentQuality
  confirmPolicy: AgentConfirmPolicy
  messages: ChatMessage[]
  images: AgentImage[]
  pendingConfirmation: RemotePendingConfirmation | null
  pendingChoice: RemotePendingChoice | null
  updatedAt: number
  bffUrl?: string
}) {
  try {
    await upsertAgentRuntime({
      sessionId: input.id,
      projectId: input.projectId || '',
      title: input.title || '',
      quality: input.quality,
      confirmPolicy: input.confirmPolicy,
      messages: input.messages,
      images: input.images,
      pendingConfirmation: input.pendingConfirmation,
      pendingChoice: input.pendingChoice,
      updatedAt: input.updatedAt,
    })
  }
  catch (error) {
    console.error('[agent session persist]', input.id, error)
  }
}
