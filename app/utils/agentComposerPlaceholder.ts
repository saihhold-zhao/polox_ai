import type { AiModelConfig } from '~~/shared/types/aiModel'

export function agentComposerPlaceholder(models: Pick<AiModelConfig, 'task'>[]) {
  if (!models.length)
    return 'Type @ to choose a model, or share your idea and I’ll help you plan it.'
  return 'What do you want to create next?'
}
