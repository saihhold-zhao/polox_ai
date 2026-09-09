export const AGENT_QUALITIES = ['high', 'economy', 'hobby', 'custom'] as const
export const AGENT_CONFIRM_POLICIES = ['auto', 'when_needed', 'always'] as const

export type AgentQuality = typeof AGENT_QUALITIES[number]
export type AgentConfirmPolicy = typeof AGENT_CONFIRM_POLICIES[number]

export const DEFAULT_AGENT_QUALITY: AgentQuality = 'hobby'
export const DEFAULT_AGENT_CONFIRM_POLICY: AgentConfirmPolicy = 'always'

export function parseUserAgentQuality(value: unknown): AgentQuality {
  if (value === 'high' || value === 'economy' || value === 'hobby' || value === 'custom')
    return value
  if (value === 'draft')
    return 'hobby'
  return DEFAULT_AGENT_QUALITY
}

export function parseUserAgentConfirmPolicy(value: unknown): AgentConfirmPolicy {
  if (value === 'auto' || value === 'when_needed' || value === 'always')
    return value
  return DEFAULT_AGENT_CONFIRM_POLICY
}
