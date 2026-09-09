import { publicServiceStatus } from './serviceSettings'
import type { H3Event } from 'h3'
import { setHeader } from 'h3'
import { snapshotAgentChatFromService } from './agentChats'
import { assertAgentRateLimit, beginAgentIdempotency, beginAgentTurn } from './agentRateLimit'

const ARCHIVE_SNAPSHOT_MS = 8000
function agentPath(event: H3Event) {
  const raw = getRouterParam(event, 'path') || ''
  const joined = Array.isArray(raw) ? raw.join('/') : String(raw)
  return `/${joined.replace(/^\/+/, '')}`
}
function agentProjectId(event: H3Event) {
  return String(getHeader(event, 'x-agent-project-id') || '').trim()
}
async function drainAgentSseForArchive(input: {
  projectId: string
  sessionId: string

  stream: ReadableStream<Uint8Array>
}) {
  const reader = input.stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sessionId = input.sessionId
  let lastSnapshot = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true })
      if (!sessionId) {
        const match = /"sessionId"\s*:\s*"([0-9a-f-]{36})"/i.exec(buffer)
        if (match?.[1])
          sessionId = match[1]
      }
      const now = Date.now()
      if (sessionId && now - lastSnapshot >= ARCHIVE_SNAPSHOT_MS) {
        lastSnapshot = now
        await snapshotAgentChatFromService({
          sessionId,
          projectId: input.projectId,
        })
      }
      if (buffer.length > 12000)
        buffer = buffer.slice(-6000)
    }
    if (sessionId) {
      await snapshotAgentChatFromService({
        sessionId,
        projectId: input.projectId,

      })
    }
  }
  catch (error) {
    console.error('[agent stream archive]', error)
    if (sessionId) {
      try {
        await snapshotAgentChatFromService({
          sessionId,
          projectId: input.projectId,

        })
      }
      catch (snapshotError) {
        console.error('[agent stream archive snapshot]', snapshotError)
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}
function archiveAgentStream(input: {
  projectId: string
  sessionId: string

  stream: ReadableStream<Uint8Array>
}) {
  return drainAgentSseForArchive(input)
}
/**
 * Like tee(), but cancelling the browser branch does not cancel the upstream
 * agent stream. Archive keeps draining so long jobs survive tab close / Load failed.
 */
function forkAgentStream(upstream: ReadableStream<Uint8Array>) {
  const reader = upstream.getReader()
  type Waiter = () => void
  const archiveQueue: Array<Uint8Array | null> = []
  const browserQueue: Array<Uint8Array | null> = []
  let archiveWait: Waiter | null = null
  let browserWait: Waiter | null = null
  let browserCancelled = false
  let pumping = false
  function notify(kind: 'archive' | 'browser') {
    if (kind === 'archive') {
      archiveWait?.()
      archiveWait = null
    }
    else {
      browserWait?.()
      browserWait = null
    }
  }
  function pushArchive(chunk: Uint8Array | null) {
    archiveQueue.push(chunk)
    notify('archive')
  }
  function pushBrowser(chunk: Uint8Array | null) {
    if (browserCancelled)
      return
    browserQueue.push(chunk)
    notify('browser')
  }
  async function pump() {
    if (pumping)
      return
    pumping = true
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          pushArchive(null)
          pushBrowser(null)
          break
        }
        pushArchive(value)
        pushBrowser(value)
      }
    }
    catch (error) {
      console.error('[agent sse pump]', error)
      pushArchive(null)
      pushBrowser(null)
    }
    finally {
      try {
        reader.releaseLock()
      }
      catch {
        // already released
      }
    }
  }
  function makeStream(queue: Array<Uint8Array | null>, setWait: (wait: Waiter | null) => void, onCancel?: () => void) {
    return new ReadableStream<Uint8Array>({
      start() {
        void pump()
      },
      async pull(controller) {
        while (!queue.length) {
          await new Promise<void>((resolve) => {
            setWait(resolve)
          })
        }
        const chunk = queue.shift()
        if (chunk == null) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
      cancel() {
        onCancel?.()
      },
    })
  }
  return {
    browser: makeStream(browserQueue, (wait) => { browserWait = wait }, () => {
      browserCancelled = true
      browserQueue.length = 0
      notify('browser')
    }),
    archive: makeStream(archiveQueue, (wait) => { archiveWait = wait }),
  }
}
function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError'
    || error.message === 'This operation was aborted')
}
export async function proxyAgentRequest(event: H3Event) {
  try {
    assertAgentRateLimit(event.method)
  }
  catch (error) {
    setHeader(event, 'retry-after', 60)
    throw error
  }
  const path = agentPath(event)
  const method = event.method.toUpperCase()
  if (method === 'POST' && path === '/v1/chat' && !publicServiceStatus().connected) {
    throw createError({ statusCode: 503, statusMessage: 'Configure and test OpenRouter and fal before sending a message.', data: { code: 'SERVICES_NOT_CONNECTED' } })
  }
  const confirmMatch = path.match(/^\/v1\/sessions\/([^/]+)\/confirm$/)
  const choiceMatch = path.match(/^\/v1\/sessions\/([^/]+)\/choice$/)
  let releaseTurn = () => { }
  let confirmBody: Record<string, unknown> | undefined
  let idempotencyKey = method === 'POST' ? getHeader(event, 'idempotency-key') : undefined
  if (confirmMatch && method === 'POST') {
    confirmBody = await readBody<Record<string, unknown>>(event) || {}
    const confirmationId = String(confirmBody.confirmationId || '').trim()
    if (confirmBody.action === 'confirm' && confirmationId)
      idempotencyKey = `confirm:${confirmMatch[1]}:${confirmationId}`
  }
  else if (choiceMatch && method === 'POST') {
    confirmBody = await readBody<Record<string, unknown>>(event) || {}
    const choiceId = String(confirmBody.choiceId || '').trim()
    if (choiceId)
      idempotencyKey = `choice:${choiceMatch[1]}:${choiceId}:${String(confirmBody.action || '')}`
  }
  const idempotency = method === 'POST'
    ? beginAgentIdempotency(idempotencyKey)
    : { finish() { }, release() { } }
  try {
    const projectId = agentProjectId(event)
    const incomingQuery = getQuery(event) as Record<string, unknown>
    let body: Record<string, unknown> | undefined = confirmBody
    let hintedSessionId = confirmMatch
      ? decodeURIComponent(confirmMatch[1] || '')
      : choiceMatch
        ? decodeURIComponent(choiceMatch[1] || '')
        : ''
    let uploadFile: {
      bytes: Uint8Array
      fileName: string
      mime: string
    } | undefined
    if (method !== 'GET' && method !== 'HEAD' && !confirmBody) {
      const contentType = String(getHeader(event, 'content-type') || '')
      if (path === '/v1/uploads' || contentType.includes('multipart/form-data')) {
        const parts = await readMultipartFormData(event)
        const filePart = parts?.find(part => part.name === 'file' || part.name === 'image' || Boolean(part.filename))
        if (!filePart?.data) {
          throw createError({
            statusCode: 400,
            statusMessage: 'image file is required',
          })
        }
        uploadFile = {
          bytes: filePart.data,
          fileName: String(filePart.filename || 'upload.bin'),
          mime: String(filePart.type || 'application/octet-stream'),
        }
      }
      else {
        body = await readBody<Record<string, unknown>>(event) || {}
        if (!hintedSessionId)
          hintedSessionId = String(body.sessionId || '').trim()
      }
    }
    if (method === 'POST' && (path === '/v1/chat' || Boolean(confirmMatch) || Boolean(choiceMatch)))
      releaseTurn = beginAgentTurn(hintedSessionId)
    const { agentErrorStatus, dispatchAgentRequest } = await import('../agent/router')
    let dispatched
    try {
      dispatched = await dispatchAgentRequest({
        method,
        path,
        projectId,
        query: incomingQuery,
        body,
        file: uploadFile,
      })
    }
    catch (error) {
      idempotency.release()
      const message = error instanceof Error ? error.message : 'Agent request failed'
      throw createError({
        statusCode: agentErrorStatus(error),
        statusMessage: message,
      })
    }
    // Confirm / cancel must not depend on the browser holding a long SSE open.
    if (confirmMatch && method === 'POST' && dispatched.kind === 'sse') {
      const holdTurn = releaseTurn
      releaseTurn = () => { }
      void archiveAgentStream({
        projectId,
        sessionId: hintedSessionId,

        stream: dispatched.stream,
      }).finally(holdTurn)
      idempotency.finish()
      setResponseStatus(event, 200)
      setHeader(event, 'content-type', 'application/json; charset=utf-8')
      return {
        ok: true,
        sessionId: hintedSessionId,
        status: confirmBody?.action === 'confirm' ? 'generating' : 'idle',
        detached: true,
      }
    }
    idempotency.finish()
    if (dispatched.kind === 'sse') {
      const { browser, archive } = forkAgentStream(dispatched.stream)
      void archiveAgentStream({
        projectId,
        sessionId: hintedSessionId,

        stream: archive,
      })
      setResponseStatus(event, 200)
      setHeader(event, 'content-type', 'text/event-stream; charset=utf-8')
      setHeader(event, 'cache-control', 'no-cache, no-transform')
      setHeader(event, 'connection', 'keep-alive')
      setHeader(event, 'x-accel-buffering', 'no')
      return sendStream(event, browser)
    }
    setResponseStatus(event, dispatched.status)
    setHeader(event, 'content-type', 'application/json; charset=utf-8')
    return dispatched.body
  }
  catch (error) {
    idempotency.release()
    if (isAbortError(error)) {
      if (!event.node.res.headersSent && !event.node.res.writableEnded) {
        throw createError({
          statusCode: 499,
          statusMessage: 'Client Closed Request',
        })
      }
      return
    }
    throw error
  }
  finally {
    releaseTurn()
  }
}
