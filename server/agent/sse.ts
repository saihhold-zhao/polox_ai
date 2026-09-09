import type { AgentEvent } from './types'

export function encodeSseEvent(event: AgentEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function createAgentEventStream(
  run: (emit: (event: AgentEvent) => void) => Promise<void>,
) {
  const encoder = new TextEncoder()
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        if (closed)
          return
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event)))
        }
        catch {
          closed = true
        }
      }
      // Keep proxies from timing out while generation produces no SSE events.
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          }
          catch {
            closed = true
            clearInterval(heartbeat)
          }
        }
      }, 15_000)
      try {
        await run(emit)
      }
      catch (error) {
        const aborted = error instanceof Error && (
          error.name === 'AbortError'
          || error.message === 'Aborted'
          || error.message === 'Generation aborted'
        )
        if (!aborted && !closed) {
          const message = error instanceof Error ? error.message : 'Agent service error'
          emit({ type: 'error', message })
          emit({ type: 'done' })
        }
      }
      finally {
        clearInterval(heartbeat)
        if (!closed) {
          closed = true
          try {
            controller.close()
          }
          catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      clearInterval(heartbeat)
      closed = true
    },
  })
}
