import { AGENT_MODELS, modelMention } from '~~/shared/utils/agentModels'

export function toolAgentRequest(modelId: string, input: Record<string, unknown>) {
  const model = AGENT_MODELS.find(model => model.id === modelId)
  if (!model)
    throw new Error('This model is not available in Agent.')

  return `${modelMention(model)}\nRun ${model.task} using the exact parameters below. Keep the selected model, prompt, media URLs, and any region coordinates unchanged. These settings were filled in on the tool page.\n\n${JSON.stringify(input, null, 2)}`
}

// Keep the full request for execution and history, but present the user's form input.
// Only recognize our exact envelope; ordinary user text and JSON remain untouched.
export function toolAgentMessage(content: string) {
  const model = AGENT_MODELS.find(model => content.startsWith(`${modelMention(model)}\nRun ${model.task} using the exact parameters below.`))
  if (!model)
    return null
  const prefix = toolAgentRequest(model.id, {}).slice(0, -2)
  if (!content.startsWith(prefix))
    return null
  try {
    const input = JSON.parse(content.slice(prefix.length))
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return null
    const mediaFields = [
      'image_url',
      'image_urls',
      'input_urls',
      'image_input',
      'first_frame_url',
      'last_frame_url',
      'start_image_url',
      'end_image_url',
      'reference_image_urls',
      'reference_video_urls',
      'reference_audio_urls',
      'video_url',
      'audio_url',
    ]
    const seen = new Set<string>()
    const attachments = mediaFields.flatMap((key) => {
      const values = Array.isArray(input[key]) ? input[key] : [input[key]]
      return values.flatMap((url: unknown) => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url))
          return []
        seen.add(url)
        const kind = key.includes('video') ? 'video' as const : key.includes('audio') ? 'audio' as const : 'image' as const
        return [{ url, kind }]
      })
    })
    const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt : model.task
    return { content: `${modelMention(model)}\n${prompt}`, attachments }
  }
  catch {
    return null
  }
}
