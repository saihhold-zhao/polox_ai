import type { ChoiceBody, ConfirmBody } from './types'
import { assertAgentSecrets } from './env'
import { handleChat, handleChoice, handleConfirm, handleStop, handleUpload } from './loop'
import { scheduleSessionResume } from './resume'
import { createSession, getSession, listSessions, loadSession, publicSession, touch } from './session'
import { createAgentEventStream } from './sse'
import { summarizeSessionTitle } from './title'

export class AgentHttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
function parseConfirmBody(body: Record<string, unknown>): ConfirmBody {
  const action = body.action === 'cancel' || body.action === 'abort' || body.action === 'confirm'
    ? body.action
    : ''
  if (!action)
    throw new Error('action must be confirm, cancel, or abort')
  const confirmationId = String(body.confirmationId || '').trim()
  if (!confirmationId)
    throw new Error('confirmationId is required')
  const params = body.params && typeof body.params === 'object'
    ? body.params as Record<string, unknown>
    : undefined
  const duration = params ? Math.floor(Number(params.duration)) : Number.NaN
  return {
    confirmationId,
    action,
    params: params
      ? {
          prompt: typeof params.prompt === 'string' ? params.prompt : undefined,
          aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : undefined,
          resolution: typeof params.resolution === 'string' ? params.resolution : undefined,
          duration: Number.isFinite(duration) ? duration : undefined,
        }
      : undefined,
  }
}
function parseChoiceBody(body: Record<string, unknown>): ChoiceBody {
  const action = body.action === 'skip' || body.action === 'submit'
    ? body.action
    : ''
  if (!action)
    throw new Error('action must be submit or skip')
  const choiceId = String(body.choiceId || '').trim()
  if (!choiceId)
    throw new Error('choiceId is required')
  const answers = Array.isArray(body.answers)
    ? body.answers.flatMap((item) => {
        if (!item || typeof item !== 'object')
          return []
        const row = item as Record<string, unknown>
        const questionId = String(row.questionId || '').trim()
        if (!questionId)
          return []
        return [{
          questionId,
          textEdits: row.textEdits as import('~~/shared/utils/imageTextEditor').ImageTextEdit[] | undefined,
          textLines: Array.isArray(row.textLines) ? row.textLines as import('~~/shared/utils/imageTextEditor').ImageTextLine[] : undefined,
          optionId: typeof row.optionId === 'string' ? row.optionId : undefined,
          imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
          regions: Array.isArray(row.regions) ? row.regions as number[][] : undefined,
          imageSelections: row.imageSelections as {
            imageUrl: string
            regions: number[][]
          }[] | undefined,
          text: typeof row.text === 'string' ? row.text : undefined,
          skipped: row.skipped === true,
        }]
      })
    : undefined
  return {
    choiceId,
    action,
    answers,
  }
}
export type AgentDispatchResult = {
  kind: 'json'
  status: number
  body: unknown
} | {
  kind: 'sse'
  stream: ReadableStream<Uint8Array>
}
export async function dispatchAgentRequest(input: {
  method: string
  path: string
  projectId?: string
  query?: Record<string, unknown>
  body?: Record<string, unknown>
  rawBody?: Uint8Array | string | null
  contentType?: string
  file?: {
    bytes: Uint8Array
    fileName: string
    mime: string
  }
}): Promise<AgentDispatchResult> {
  assertAgentSecrets()
  const method = input.method.toUpperCase()
  const path = input.path.startsWith('/') ? input.path : `/${input.path}`
  const projectId = String(input.projectId || '').trim()
  if (method === 'GET' && path === '/health') {
    return {
      kind: 'json',
      status: 200,
      body: {
        ok: true,
        inProcess: true,
        tools: ['generate_image', 'remove_background', 'generate_video', 'concat_videos', 'ask_user'],
      },
    }
  }
  if (method === 'GET' && path === '/v1/sessions') {
    const queryProject = String(input.query?.projectId || projectId || '')
    const knownIds = String(input.query?.knownSessionIds || '').split(',').filter(Boolean).slice(0, 20)
    const excludedSessionIds = knownIds.filter((id) => {
      const session = getSession(id)
      return session && queryProject && String(session.projectId || '') !== queryProject
    })
    return {
      kind: 'json',
      status: 200,
      body: {
        items: (await listSessions(queryProject)).map(publicSession),
        excludedSessionIds,
      },
    }
  }
  if (method === 'POST' && path === '/v1/sessions') {
    return {
      kind: 'json',
      status: 200,
      body: publicSession(createSession({ projectId })),
    }
  }
  const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/)
  if (method === 'GET' && sessionMatch) {
    const session = await loadSession(decodeURIComponent(sessionMatch[1] || ''))
    if (!session)
      throw new AgentHttpError('Session not found', 404)
    scheduleSessionResume(session)
    return { kind: 'json', status: 200, body: publicSession(session) }
  }
  const titleMatch = path.match(/^\/v1\/sessions\/([^/]+)\/title$/)
  if (method === 'POST' && titleMatch) {
    const session = await loadSession(decodeURIComponent(titleMatch[1] || ''))
    if (!session)
      throw new AgentHttpError('Session not found', 404)
    const title = await summarizeSessionTitle(session.messages)
    session.title = title
    touch(session)
    return { kind: 'json', status: 200, body: { title } }
  }
  if (method === 'POST' && path === '/v1/uploads') {
    if (!input.file)
      throw new AgentHttpError('image file is required', 400)
    const requestedSession = String(input.query?.sessionId || '').trim()
    const uploaded = await handleUpload(requestedSession || undefined, input.file)
    return { kind: 'json', status: 200, body: uploaded }
  }
  const stopMatch = path.match(/^\/v1\/sessions\/([^/]+)\/stop$/)
  if (method === 'POST' && stopMatch) {
    const body = await handleStop(decodeURIComponent(stopMatch[1] || ''))
    return { kind: 'json', status: 200, body }
  }
  if (method === 'POST' && path === '/v1/chat') {
    const body = input.body || {}
    const stream = createAgentEventStream(async (emit) => {
      await handleChat(String(body.message || ''), typeof body.sessionId === 'string' ? body.sessionId : undefined, body.attachments, emit, undefined, body.quality, body.confirmPolicy, {
        projectId,
        history: body.history,
        images: body.images,
      })
    })
    return { kind: 'sse', stream }
  }
  const confirmMatch = path.match(/^\/v1\/sessions\/([^/]+)\/confirm$/)
  if (method === 'POST' && confirmMatch) {
    const body = parseConfirmBody(input.body || {})
    const stream = createAgentEventStream(async (emit) => {
      await handleConfirm(decodeURIComponent(confirmMatch[1] || ''), body, emit, undefined, { projectId })
    })
    return { kind: 'sse', stream }
  }
  const choiceMatch = path.match(/^\/v1\/sessions\/([^/]+)\/choice$/)
  if (method === 'POST' && choiceMatch) {
    const body = parseChoiceBody(input.body || {})
    const stream = createAgentEventStream(async (emit) => {
      await handleChoice(decodeURIComponent(choiceMatch[1] || ''), body, emit, undefined, { projectId })
    })
    return { kind: 'sse', stream }
  }
  throw new AgentHttpError('Not found', 404)
}
export function agentErrorStatus(error: unknown) {
  if (error instanceof AgentHttpError)
    return error.status
  const message = error instanceof Error ? error.message : ''
  if (/not found/i.test(message))
    return 404
  if (/already running|pending/i.test(message))
    return 409
  if (/unauthorized/i.test(message))
    return 401
  return 400
}
