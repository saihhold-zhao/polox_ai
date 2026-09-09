/** Split explicit thinking blocks before Markdown sanitization removes their tags. */
export function splitAgentThinking(source: string) {
  const thoughts: string[] = []
  const answer = source.replace(/<(think|thinking)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$)/gi, (_, _tag, content: string) => {
    thoughts.push(content.trim())
    return ''
  })
  // Do not flash a partially received opening tag during streaming.
  return { thinking: thoughts.join('\n\n'), answer: answer.replace(/<(?:t(?:h(?:i(?:n(?:k(?:i(?:ng?)?)?)?)?)?)?)?$/i, '').trim() }
}
