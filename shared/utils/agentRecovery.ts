import { isAgentTransientMessage } from './agentHistoryVisibility.ts'

interface RecoveryCards {
  confirmation?: { id: string, jobs?: Array<{ id: string }> }
  confirmationState?: string
  resolvedParams?: unknown
  choice?: { id: string }
  choiceState?: string
  choiceAnswers?: unknown[]
}

export interface RecoveryMessage extends RecoveryCards {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: string
  streaming?: boolean
  imageIds?: string[]
}

export interface TranscriptMessage extends RecoveryCards {
  id?: string
  kind?: string
  role: 'user' | 'assistant'
  content: string
  imageIds?: string[]
}

export function isAgentDisconnectError(error: unknown) {
  if (!error)
    return false
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return true
  const message = error instanceof Error ? error.message : String(error)
  return /server temporarily unavailable|internal server error|^server error$|\b50[234]\b|load failed|failed to fetch|network\s*error|network request failed|the user aborted|this operation was aborted|generation aborted|^aborted$/i.test(message)
}

const comparable = (value: string) => value.replace(/<\/?think(?:ing)?\s*>/gi, '').replace(/\s+/g, '')

/** Merge completed server turns without throwing away local cards or attachments. */
export function recoverAgentTranscript<T extends RecoveryMessage, R extends TranscriptMessage>(
  local: T[],
  remote: R[],
  createMessage: (message: R) => T,
): T[] {
  const result = local.filter(item => !isAgentTransientMessage(item) && !(item.kind === 'error' && isAgentDisconnectError(item.content))).map(item => ({ ...item }))
  let cursor = 0
  for (const row of remote) {
    if (isAgentTransientMessage(row) || (row.role !== 'user' && row.role !== 'assistant') || (row.kind === 'error' && isAgentDisconnectError(row.content)))
      continue
    const content = comparable(row.content || '')
    const ownsOutput = (item: T, id: string) => item.confirmation?.jobs?.some(job =>
      id === job.id || (id.startsWith(`${job.id}_`) && /^\d+$/.test(id.slice(job.id.length + 1))),
    )
    const compatible = (item: T) => item.role === row.role && item.kind === row.kind
      && !(row.confirmation && item.confirmation && row.confirmation.id !== item.confirmation.id)
      && !(row.choice && item.choice && row.choice.id !== item.choice.id)
    // Runtime tool turns and browser cards have different message IDs. Their
    // output IDs identify the same turn even when text is empty or rewritten.
    const ownerIndex = row.role === 'assistant' && row.imageIds?.length
      ? result.findIndex(item => compatible(item) && row.imageIds!.some(id => ownsOutput(item, id)))
      : -1
    const identityIndex = result.findIndex(item => compatible(item) && (
      (row.id && row.id.replace(/^ui:/, '') === item.id.replace(/^ui:/, ''))
      || (row.confirmation?.id && row.confirmation.id === item.confirmation?.id)
      || (row.choice?.id && row.choice.id === item.choice?.id)
    ))
    let index = ownerIndex >= 0 ? ownerIndex : identityIndex
    if (index < 0) {
      index = result.findIndex((item, i) => {
        if (i < cursor || item.role !== row.role || item.kind !== row.kind)
          return false
        if (row.kind === 'error') {
        // UI archives prefix browser IDs; refreshing must merge the same error.
          const identity = (id?: string) => id?.replace(/^ui:/, '')
          return row.id ? identity(row.id) === identity(item.id) : comparable(item.content || '') === content
        }
        if ((row.id && row.id === item.id) || (row.choice?.id && row.choice.id === item.choice?.id) || (row.confirmation?.id && row.confirmation.id === item.confirmation?.id))
          return true
        if ((row.choice && item.choice && row.choice.id !== item.choice.id) || (row.confirmation && item.confirmation && row.confirmation.id !== item.confirmation.id))
          return false
        if (row.imageIds?.length && item.confirmation?.jobs?.length && !row.imageIds.some(id => ownsOutput(item, id)))
          return false
        if (row.imageIds?.length && item.imageIds?.length) {
          if (row.imageIds.some(id => item.imageIds!.includes(id)))
            return true
          return false
        }
        const existing = comparable(item.content || '')
        if (!content)
          return !existing && Boolean(row.imageIds?.some(id => item.imageIds?.includes(id)))
        return existing === content || Boolean(item.role === 'assistant' && existing && (content.startsWith(existing) || existing.startsWith(content)))
      })
    }
    if (index >= 0) {
      const item = result[index]!
      if (row.id?.startsWith('history:'))
        item.id = row.id
      if (comparable(row.content || '').length >= comparable(item.content || '').length)
        item.content = row.content
      for (const key of ['confirmation', 'confirmationState', 'resolvedParams', 'choice', 'choiceState', 'choiceAnswers'] as const) {
        if ((key === 'choiceState' || key === 'confirmationState') && row[key] === 'pending' && item[key] && item[key] !== 'pending')
          continue
        if (row[key] != null && !(Array.isArray(row[key]) && !row[key].length))
          Object.assign(item, { [key]: row[key] })
      }
      item.streaming = false
      item.imageIds = [...new Set([...(item.imageIds || []), ...(row.imageIds || [])])]
      if (ownerIndex >= 0) {
        const outputIds = new Set(row.imageIds)
        for (const other of result) {
          if (other === item || other.role !== 'assistant' || !other.imageIds?.length)
            continue
          other.imageIds = other.imageIds.filter(id => !outputIds.has(id))
        }
      }
      cursor = Math.max(cursor, index + 1)
    }
    else if (content || row.imageIds?.length || row.choice || row.confirmation) {
      // Keep preceding tool/media cards with their original assistant turn.
      while (cursor < result.length && result[cursor]?.role === 'assistant' && !result[cursor]?.content)
        cursor++
      result.splice(cursor++, 0, { ...createMessage(row), streaming: false, imageIds: [...(row.imageIds || [])] })
    }
  }
  return result.filter(item => item.content || item.confirmation || item.choice || item.imageIds?.length || item.kind)
}

export function agentRecoveryNotice(message: string) {
  return isAgentDisconnectError(message)
    ? 'Server temporarily unavailable. Please wait a moment and refresh the page. We will check the saved task status when the connection returns.'
    : message
}
