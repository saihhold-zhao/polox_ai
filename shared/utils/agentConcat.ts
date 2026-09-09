/** Stable id for ffmpeg-stitched agent clips — not a generative model. */
export const AGENT_CONCAT_MODEL = 'agent/concat-videos'

export function isConcatenatedPrompt(prompt?: string) {
  return /^Concatenated \d+ clips$/i.test(String(prompt || '').trim())
}

export function isConcatVideoMode(mode?: string) {
  return String(mode || '').trim() === 'concat'
}

export function isConcatenatedGeneration(job: {
  prompt?: string
  model?: string
  input?: Record<string, unknown> | null
}) {
  if (String(job.model || '').trim() === AGENT_CONCAT_MODEL)
    return true
  if (job.input && typeof job.input === 'object' && job.input.operation === 'concat')
    return true
  return isConcatenatedPrompt(job.prompt)
}
