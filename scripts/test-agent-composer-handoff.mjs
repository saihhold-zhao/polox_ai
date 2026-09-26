import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  draftHasSkillCommand,
  HANDOFF_MAX_MS,
  HANDOFF_STABLE_MS,
  nextHandoffStep,
  normalizeHandoffSkillId,
} from '../app/utils/agentComposerHandoff.ts'

// Bug (ported from commercial): /?agentSkill= inserted the skill, pending was cleared on the first
// successful insert, then HomeAgentComposer's onMounted (awaiting /api/projects for logged-in
// users) switched the lab runtime + clearComposerDraft() wiped it with nobody left to re-apply.

const root = resolve(import.meta.dirname, '..')

function simulate(events, { stableMs = HANDOFF_STABLE_MS } = {}) {
  // events: [{ t, draft?, ready? }] applied in order; handoff ticks every 100ms until done.
  let draft = ''
  let ready = false
  let state = { startedAt: 0, stableSince: null }
  const log = []
  const queue = [...events].sort((a, b) => a.t - b.t)
  for (let t = 0; t <= 5000; t += 50) {
    while (queue.length && queue[0].t <= t) {
      const e = queue.shift()
      if ('draft' in e)
        draft = e.draft
      if ('ready' in e)
        ready = e.ready
    }
    const step = nextHandoffStep(state, { now: t, present: draftHasSkillCommand(draft, 'poster'), composerReady: ready, stableMs })
    state = step.state
    log.push(step.action)
    if (step.action === 'apply')
      draft = ['/poster', draft].filter(Boolean).join(' ')
    if (step.action === 'done' || step.action === 'expire')
      return { draft, t, action: step.action, log }
  }
  return { draft, t: Infinity, action: 'timeout', log }
}

test('normalizeHandoffSkillId accepts builtin and community ids, rejects junk', () => {
  assert.equal(normalizeHandoffSkillId('poster'), 'poster')
  assert.equal(normalizeHandoffSkillId(' my-cool-skill '), 'my-cool-skill')
  assert.equal(normalizeHandoffSkillId('untitled-abc123'), 'untitled-abc123')
  assert.equal(normalizeHandoffSkillId('../etc'), '')
  assert.equal(normalizeHandoffSkillId('Poster'), '')
  assert.equal(normalizeHandoffSkillId('1abc'), '')
  assert.equal(normalizeHandoffSkillId(['poster']), '')
  assert.equal(normalizeHandoffSkillId(undefined), '')
  assert.equal(normalizeHandoffSkillId(`a${'b'.repeat(64)}`), '')
})

test('draftHasSkillCommand matches whole tokens only', () => {
  assert.equal(draftHasSkillCommand('/poster make it red', 'poster'), true)
  assert.equal(draftHasSkillCommand('hi /poster', 'poster'), true)
  assert.equal(draftHasSkillCommand('/poster-pro', 'poster'), false)
  assert.equal(draftHasSkillCommand('', 'poster'), false)
})

test('does not finish before the composer reported ready, even when present', () => {
  const s = { startedAt: 0, stableSince: null }
  const step = nextHandoffStep(s, { now: 5000, present: true, composerReady: false })
  assert.equal(step.action, 'wait')
  assert.equal(step.state.stableSince, null)
})

test('prod race: late composer wipe after first insert is re-applied (old logic lost it)', () => {
  // t=0 insert; t=450 lab runtime switch → empty draft; t=700 clearComposerDraft + ready.
  const r = simulate([{ t: 450, draft: '' }, { t: 700, draft: '', ready: true }])
  assert.equal(r.action, 'done')
  assert.ok(draftHasSkillCommand(r.draft, 'poster'), 'skill survives the late wipe')
  assert.ok(r.t >= 700 + HANDOFF_STABLE_MS, 'waits a stability window after ready')
  assert.ok(r.log.filter(a => a === 'apply').length >= 2, 're-applied after the wipe')
})

test('wipe inside the stability window resets it and re-applies', () => {
  const r = simulate([{ t: 100, ready: true }, { t: 600, draft: '' }])
  assert.equal(r.action, 'done')
  assert.ok(draftHasSkillCommand(r.draft, 'poster'))
  assert.ok(r.t >= 600 + HANDOFF_STABLE_MS)
})

test('local fast path (composer ready immediately) finishes after one window', () => {
  const r = simulate([{ t: 0, ready: true }])
  assert.equal(r.action, 'done')
  assert.ok(r.t <= HANDOFF_STABLE_MS + 100)
})

test('safety cap: expire when never insertable, done when present', () => {
  const s = { startedAt: 0, stableSince: null }
  assert.equal(nextHandoffStep(s, { now: HANDOFF_MAX_MS, present: false, composerReady: true }).action, 'expire')
  assert.equal(nextHandoffStep(s, { now: HANDOFF_MAX_MS, present: true, composerReady: false }).action, 'done')
})

test('wiring: homepage keeps handoffs pending until composer ready (local, no login / favorites)', () => {
  const index = readFileSync(resolve(root, 'app/pages/index.vue'), 'utf8')
  const home = readFileSync(resolve(root, 'app/components/home/HomeAgentComposer.vue'), 'utf8')
  assert.match(index, /@ready="onComposerReady"/)
  assert.match(index, /@send-start="onComposerSendStart"/)
  assert.doesNotMatch(index, /!PUBLIC_AGENT_SKILLS\.some\(skill => skill\.id === skillId\)/, 'no builtin-only deep-link guard')
  assert.match(index, /normalizeHandoffSkillId\(raw\)/)
  assert.match(index, /resolveDeepLinkSkill\(skillId\)/)
  assert.match(home, /finally \{\s*emit\('ready'\)/)
  assert.match(home, /emit\('sendStart'\)/)
  for (const source of [index, home])
    assert.doesNotMatch(source, /useLoginDialog|useUserSession|favoriteSkillForUse|HomeBlog/)
})
