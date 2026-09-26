import { AGENT_MODELS, agentModelToolName } from '~~/shared/utils/agentModels'
import { EXPORT_ZIP_TOOL } from '../agent/exportZip'
import { MEASURE_VIDEO_DURATION_TOOL } from '../agent/measureVideoDuration'
import {
  ASK_USER_TOOL,
  REQUEST_VOICE_RECORDING_TOOL,
  CONCAT_VIDEO_TOOL,
  EXTRACT_VIDEO_FRAME_TOOL,
  GENERATE_IMAGE_TOOL,
  GENERATE_VIDEO_TOOL,
  REMOVE_BACKGROUND_TOOL,
} from '../agent/tools'

export const LOAD_SKILL_TOOL = 'load_skill'
export const SAVE_USER_SKILL_TOOL = 'save_user_skill'
export const CHECK_SKILL_ID_TOOL = 'check_skill_id'
export const EXIT_SKILL_CREATOR_TOOL = 'exit_skill_creator'
export const INSPECT_WEBSITE_TOOL = 'inspect_website'

/** Tool names L1 user skills may declare in `requires` / invoke. */
export function registeredToolNames(): string[] {
  const preset = [
    ASK_USER_TOOL,
    REQUEST_VOICE_RECORDING_TOOL,
    GENERATE_IMAGE_TOOL,
    REMOVE_BACKGROUND_TOOL,
    GENERATE_VIDEO_TOOL,
    CONCAT_VIDEO_TOOL,
    INSPECT_WEBSITE_TOOL,
    EXPORT_ZIP_TOOL,
    MEASURE_VIDEO_DURATION_TOOL,
    EXTRACT_VIDEO_FRAME_TOOL,
    LOAD_SKILL_TOOL,
    SAVE_USER_SKILL_TOOL,
    CHECK_SKILL_ID_TOOL,
    EXIT_SKILL_CREATOR_TOOL,
  ]
  const models = AGENT_MODELS.map(model => agentModelToolName(model.id))
  return [...new Set([...preset, ...models])].sort()
}

export function isRegisteredToolName(name: string) {
  return registeredToolNames().includes(name)
}
