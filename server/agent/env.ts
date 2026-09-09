import { readServiceSettings } from '../utils/serviceSettings'

export const agentEnv = {
  get openRouterApiKey() { return readServiceSettings().openRouterKey },
  get falApiKey() { return readServiceSettings().falKey },
  get model() { return readServiceSettings().openRouterModel },
}
export function assertAgentSecrets() {
  if (!agentEnv.openRouterApiKey || !agentEnv.falApiKey)
    throw new Error('Configure OpenRouter and fal using Service connection in the top-right corner.')
}
