import type { AgentChatMessage, AgentImage } from '../composables/useAgentLab'

interface ResultMessage extends AgentChatMessage {
  media: AgentImage[]
}

/** Keep job ownership for recovery, but present finished outputs below the reply. */
export function presentAgentResults(messages: AgentChatMessage[], mediaFor: (message: AgentChatMessage) => AgentImage[]): ResultMessage[] {
  const rows = messages.map(message => ({ ...message, media: mediaFor(message) }))
  const removed = new Set<ResultMessage>()
  for (let index = 0; index < rows.length; index++) {
    const card = rows[index]!
    const jobs = card.confirmation?.jobs
    if (!jobs?.length)
      continue
    const outputs = card.media.filter(image => jobs.some(job => image.id === job.id
      || (image.id.startsWith(`${job.id}_`) && /^\d+$/.test(image.id.slice(job.id.length + 1)))))
    if (!outputs.length || outputs.some(image => image.status === 'generating'))
      continue
    const finished = outputs.filter(image => image.status === 'success')
    if (!finished.length)
      continue
    const ids = new Set(finished.map(image => image.id))
    const urls = new Set(finished.map(image => image.url).filter(Boolean))
    const isOutput = (image: AgentImage) => ids.has(image.id) || Boolean(image.url && urls.has(image.url))
    let end = index + 1
    while (end < rows.length && rows[end]!.role === 'assistant' && !rows[end]!.confirmation && !rows[end]!.choice)
      end++
    let target: ResultMessage | undefined
    for (let next = index + 1; next < end; next++) {
      const row = rows[next]!
      const fallback = row.id.replace(/^ui:/, '').startsWith('layers-complete:')
        || /^图层拆分已完成，共 \d+ 个图层（含背景）。结果如下，也已添加到画布。$/.test(row.content)
      if (fallback && row.media.some(isOutput)) {
        removed.add(row)
        continue
      }
      const visibleContent = row.content.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()
      if (!row.kind && visibleContent && !/^<think(?:ing)?>/i.test(visibleContent))
        target = row
    }
    // Detached jobs can finish before the assistant's final reply is recovered.
    // This display-only row disappears once that reply arrives.
    if (!target) {
      target = { id: `results:${card.id}`, role: 'assistant', content: '生成结果如下。', media: [] }
      rows.splice(end, 0, target)
      end++
    }
    for (let next = index; next < end; next++)
      rows[next]!.media = rows[next]!.media.filter(image => !isOutput(image))
    target.media = [...finished, ...target.media]
  }
  return rows.filter(row => !removed.has(row) && (row.content || row.confirmation || row.choice || row.kind || row.media.length))
}
