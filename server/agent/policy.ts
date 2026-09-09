import { findAgentModelTool } from '~~/shared/utils/agentModels'

export const MAX_STEPS = 12
export const MAX_TRANSCRIPT_MESSAGES = 80
export const SESSION_MEMORY_IDLE_MS = 2 * 60 * 60 * 1000
export const SESSION_ORPHAN_MS = 40 * 60 * 1000

export const GENERATION_TOOLS = new Set(['generate_image', 'generate_video', 'remove_background'])
// concat_videos is free and runs immediately; it must not be mixed with generation tools in the same turn.

export function isGenerationTool(name: string) {
  return GENERATION_TOOLS.has(name) || Boolean(findAgentModelTool(name))
}
