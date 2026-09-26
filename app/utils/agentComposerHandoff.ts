/**
 * Pure decision logic for homepage deep-link handoffs (`/?agentSkill=…`, `/?agentModel=…`).
 *
 * The homepage composer wipes its draft once after mount (HomeAgentComposer onMounted →
 * resolveTargetProjectId → ensureHydrated → clearComposerDraft), and a project switch swaps
 * the whole useAgentLab runtime (different `draft` ref). For logged-in users with a real DB
 * those happen hundreds of ms after the first successful insert, so a handoff must stay
 * pending until the composer reported ready AND the inserted command survived a short
 * stability window — not just until the first insert succeeded.
 */

/** Same shape the composer recognizes as a `/skill` command (readSkillCommands). */
const HANDOFF_SKILL_ID_RE = /^[a-z][a-z0-9-]{0,63}$/

export const HANDOFF_STABLE_MS = 1200
export const HANDOFF_MAX_MS = 20_000

export function normalizeHandoffSkillId(raw: unknown): string {
  if (typeof raw !== 'string')
    return ''
  const id = raw.trim()
  return HANDOFF_SKILL_ID_RE.test(id) ? id : ''
}

export function draftHasSkillCommand(draft: string, skillId: string): boolean {
  const id = String(skillId || '').trim()
  if (!id)
    return false
  return String(draft || '').split(/\s+/).filter(Boolean).includes(`/${id}`)
}

export interface HandoffState {
  /** When the handoff was requested (ms). */
  startedAt: number
  /** First time the command was observed in the draft after the composer was ready; null when absent. */
  stableSince: number | null
}

export interface HandoffInput {
  now: number
  /** Command currently present in the live draft. */
  present: boolean
  /** HomeAgentComposer finished its initial hydrate + draft wipe (or skipped it). */
  composerReady: boolean
  stableMs?: number
  maxMs?: number
}

export type HandoffAction = 'apply' | 'wait' | 'done' | 'expire'

/**
 * Returns the next action and the updated state. Never mutates `state`.
 * - apply: command missing → (re)insert it
 * - wait: present but not yet proven stable (composer not ready / window not elapsed)
 * - done: present and stable → clear pending
 * - expire: give up (safety cap so a broken composer can't re-insert forever)
 */
export function nextHandoffStep(state: HandoffState, input: HandoffInput): { action: HandoffAction, state: HandoffState } {
  const stableMs = input.stableMs ?? HANDOFF_STABLE_MS
  const maxMs = input.maxMs ?? HANDOFF_MAX_MS
  if (input.now - state.startedAt >= maxMs)
    return { action: input.present ? 'done' : 'expire', state: { ...state, stableSince: null } }
  if (!input.present)
    return { action: 'apply', state: { ...state, stableSince: null } }
  if (!input.composerReady)
    return { action: 'wait', state: { ...state, stableSince: null } }
  const stableSince = state.stableSince ?? input.now
  if (input.now - stableSince >= stableMs)
    return { action: 'done', state: { ...state, stableSince } }
  return { action: 'wait', state: { ...state, stableSince } }
}
