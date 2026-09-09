import type { AgentConfirmPolicy, AgentQuality } from '~~/shared/types/agentPreferences'
import {
  DEFAULT_AGENT_CONFIRM_POLICY,
  DEFAULT_AGENT_QUALITY,
  parseUserAgentConfirmPolicy,
  parseUserAgentQuality,
} from '~~/shared/types/agentPreferences'

const QUALITY_STORAGE_KEY = 'polox-agent-quality'
const CONFIRM_POLICY_STORAGE_KEY = 'polox-agent-confirm-policy'

function readStoredQuality(): AgentQuality {
  if (!import.meta.client)
    return DEFAULT_AGENT_QUALITY
  try {
    return parseUserAgentQuality(localStorage.getItem(QUALITY_STORAGE_KEY))
  }
  catch {
    return DEFAULT_AGENT_QUALITY
  }
}

function readStoredConfirmPolicy(): AgentConfirmPolicy {
  if (!import.meta.client)
    return DEFAULT_AGENT_CONFIRM_POLICY
  try {
    return parseUserAgentConfirmPolicy(localStorage.getItem(CONFIRM_POLICY_STORAGE_KEY))
  }
  catch {
    return DEFAULT_AGENT_CONFIRM_POLICY
  }
}

function writeStoredQuality(value: AgentQuality) {
  if (!import.meta.client)
    return
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, value)
  }
  catch {
    // Ignore quota / private mode.
  }
}

function writeStoredConfirmPolicy(value: AgentConfirmPolicy) {
  if (!import.meta.client)
    return
  try {
    localStorage.setItem(CONFIRM_POLICY_STORAGE_KEY, value)
  }
  catch {
    // Ignore quota / private mode.
  }
}

export function useAgentPreferences() {
  const qualityPreference = useState<AgentQuality>('agent-quality-pref', readStoredQuality)
  const confirmPolicy = useState<AgentConfirmPolicy>('agent-confirm-policy-pref', readStoredConfirmPolicy)
  const hydrated = useState('agent-prefs-hydrated', () => false)

  if (import.meta.client && !hydrated.value) {
    hydrated.value = true
    qualityPreference.value = readStoredQuality()
    confirmPolicy.value = readStoredConfirmPolicy()
  }

  if (import.meta.client) {
    watch(qualityPreference, writeStoredQuality)
    watch(confirmPolicy, writeStoredConfirmPolicy)
  }

  return {
    qualityPreference,
    confirmPolicy,
  }
}
