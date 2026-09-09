import { marked } from 'marked'

export function messageMedia<T extends { id: string, url?: string }>(message: { content: string, imageIds?: string[], confirmation?: { jobs?: Array<{ id: string }> } }, images: T[]): T[] {
  const urls = new Set<string>()
  marked.walkTokens(marked.lexer((message.content || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')), (token) => {
    if (token.type === 'link' || token.type === 'image')
      urls.add(token.href)
  })
  const byId = new Map(images.map(image => [image.id, image]))
  const ids = [...new Set([
    ...(message.confirmation?.jobs || []).flatMap(job => images
      .filter(image => image.id === job.id || (image.id.startsWith(`${job.id}_`) && /^\d+$/.test(image.id.slice(job.id.length + 1))))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map(image => image.id)),
    ...(message.imageIds || []),
  ])]
  const candidates = [
    ...ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    ...[...urls].flatMap(url => images.filter(image => image.url === url)),
  ]
  const seen = new Set<string>()
  return candidates.filter((image) => {
    const key = image.url || image.id
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}
