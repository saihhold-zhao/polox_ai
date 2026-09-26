import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  eligibleAutoRetryFails,
  formatAutoRetryIds,
  isFailSuperseded,
  parseAutoRetryIds,
  stripAutoRetryIds,
} from '../shared/utils/agentAutoRetry.ts'
import { isAgentTransientMessage } from '../shared/utils/agentHistoryVisibility.ts'

function extractFunctions(relativePath, names) {
  const filename = new URL(relativePath, import.meta.url)
  const source = readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true)
  const found = new Map()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
      found.set(node.name.text, node.getText(ast).replace(/^export\s+/, ''))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const name of names)
    assert.ok(found.has(name), `${name} must exist in ${relativePath}`)
  return ts.transpile(names.map(name => found.get(name)).join('\n'), { target: ts.ScriptTarget.ES2022 })
}

const MIN = 60 * 1000

test('auto-retry id line round-trips and is stripped before the LLM', () => {
  const line = formatAutoRetryIds(['call_a', 'call_b', 'call_a', 'bad id!'])
  assert.equal(line, '<<<AUTO_RETRY_IDS:call_a,call_b>>>')
  const text = `<<<INTERNAL_AUTO_RETRY>>>\nA shot just failed.\n${line}`
  assert.deepEqual(parseAutoRetryIds(text), ['call_a', 'call_b'])
  assert.equal(stripAutoRetryIds(text), '<<<INTERNAL_AUTO_RETRY>>>\nA shot just failed.')
  assert.deepEqual(parseAutoRetryIds('no ids here'), [])
  assert.equal(formatAutoRetryIds([]), '')
})

test('server only honors fresh, unhandled failures (old fails are ignored)', () => {
  const now = Date.now()
  const images = [
    { id: 'replacement', status: 'success', prompt: 'shot 3', kind: 'video' },
    { id: 'fresh', status: 'fail', prompt: 'shot 4', kind: 'video', failedAt: now - MIN },
    { id: 'old', status: 'fail', prompt: 'shot 3', kind: 'video', failedAt: now - 24 * 60 * MIN },
    { id: 'legacy', status: 'fail', prompt: 'shot 2', kind: 'video' },
    { id: 'handled', status: 'fail', prompt: 'shot 1', kind: 'video', failedAt: now - MIN, autoRetryHandled: true },
  ]
  const ids = list => eligibleAutoRetryFails(images, { ids: list, text: '', now }).map(item => item.id)
  assert.deepEqual(ids(['fresh']), ['fresh'])
  assert.deepEqual(ids(['old']), [], 'failure from yesterday (deploy interruption) must not be retried')
  assert.deepEqual(ids(['legacy']), [], 'fail without failedAt predates the guard and counts as old')
  assert.deepEqual(ids(['handled']), [], 'already auto-retried once')
  assert.deepEqual(ids(['replacement', 'missing']), [])
  // Legacy client without the id line: match by prompt text.
  const legacy = eligibleAutoRetryFails(images, { ids: [], text: 'A shot just failed ... Failed shot: shot 3', now })
  assert.deepEqual(legacy, [])
  const legacyFresh = eligibleAutoRetryFails(images, { ids: [], text: 'Failed shot: shot 4', now })
  assert.deepEqual(legacyFresh.map(item => item.id), ['fresh'])
})

test('supersession ignores same-batch siblings but catches a later regeneration', () => {
  const fail = { id: 'a', status: 'fail', prompt: 'Cat  on roof', kind: 'still' }
  const sibling = { id: 'b', status: 'success', prompt: 'cat on roof', kind: 'still' }
  assert.equal(isFailSuperseded(fail, [fail, sibling]), true)
  assert.equal(isFailSuperseded(fail, [fail, sibling], new Set(['a', 'b'])), false)
  assert.equal(isFailSuperseded(fail, [fail, { ...sibling, kind: 'video' }]), false)
  assert.equal(isFailSuperseded(fail, [fail, { ...sibling, status: 'fail' }]), false)
})

test('upsertImage stamps failedAt once and keeps the auto-retry marker', () => {
  const context = vm.createContext({ allocateAssetName: item => item.name || 'x', touch: () => {}, Date })
  vm.runInContext(extractFunctions('../server/agent/session.ts', ['upsertImage']), context)
  const session = { images: [] }
  context.upsertImage(session, { id: 'i', status: 'generating', prompt: 'p' })
  assert.equal(session.images[0].failedAt, undefined)
  context.upsertImage(session, { id: 'i', status: 'fail', prompt: 'p' })
  const stamped = session.images[0].failedAt
  assert.ok(stamped > 0)
  session.images[0].autoRetryHandled = true
  context.upsertImage(session, { id: 'i', status: 'fail', prompt: 'p', error: 'again' })
  assert.equal(session.images[0].failedAt, stamped)
  assert.equal(session.images[0].autoRetryHandled, true)
})

function createFailState() {
  const code = extractFunctions('../app/composables/useAgentLab.ts', ['trackSnapshotFails', 'failSupersededInChat', 'isFreshFail', 'unnotifiedFails'])
  const context = vm.createContext({
    failBaselineReady: false,
    failBaselineAt: Date.now(),
    FAIL_BASELINE_SLACK_MS: 2 * MIN,
    baselineFailIds: new Set(),
    liveObservedIds: new Set(),
    notifiedFails: new Set(),
    messages: { value: [] },
    images: { value: [] },
    confirmationMedia: () => [],
    isFailSuperseded,
  })
  vm.runInContext(code, context)
  // `let` bindings are script-scoped in vm; expose setters for the test.
  vm.runInContext('globalThis.state = { get ready() { return failBaselineReady } }', context)
  return context
}

test('reloaded history fails are never retried or announced; live transitions are, once', () => {
  const ctx = createFailState()
  const old = { id: 'old', status: 'fail', prompt: 'shot 3', kind: 'video', error: 'Generation was interrupted' }
  const running = { id: 'live', status: 'generating', prompt: 'shot 4', kind: 'video' }
  ctx.images.value = [old, running]
  // First server snapshot after load: history baseline.
  ctx.trackSnapshotFails(ctx.images.value)
  assert.equal(ctx.state.ready, true)
  assert.deepEqual(ctx.unnotifiedFails(ctx.images.value).map(item => item.id), [])
  // Later: the running shot fails while the page is open.
  const failed = { ...running, status: 'fail', error: 'Generation was interrupted', failedAt: Date.now() }
  ctx.images.value = [old, failed]
  assert.deepEqual(ctx.unnotifiedFails([failed, ...ctx.images.value]).map(item => item.id), ['live'])
  assert.deepEqual(ctx.unnotifiedFails(ctx.images.value).map(item => item.id), [], 'second pass is a no-op')
})

test('fails are ignored before the first server snapshot, when already handled, stale, or superseded', () => {
  const ctx = createFailState()
  const early = { id: 'early', status: 'fail', prompt: 'p', kind: 'still' }
  ctx.liveObservedIds.add('early')
  assert.deepEqual(ctx.unnotifiedFails([early]), [], 'no baseline yet')
  ctx.trackSnapshotFails([])
  for (const id of ['handled', 'stale', 'superseded'])
    ctx.liveObservedIds.add(id)
  const handled = { id: 'handled', status: 'fail', prompt: 'h', kind: 'still', autoRetryHandled: true }
  const stale = { id: 'stale', status: 'fail', prompt: 's', kind: 'still', failedAt: Date.now() - 24 * 60 * MIN }
  const superseded = { id: 'superseded', status: 'fail', prompt: 'same shot', kind: 'still' }
  const replacement = { id: 'replacement', status: 'success', prompt: 'same shot', kind: 'still' }
  ctx.images.value = [handled, stale, superseded, replacement]
  assert.deepEqual(ctx.unnotifiedFails(ctx.images.value), [])
})

test('auto-approve POSTs once per confirmation id and stops after a stale 409', async () => {
  const code = extractFunctions('../app/composables/useAgentLab.ts', ['maybeAutoApprove'])
  let posts = 0
  let outcome = 'stale'
  const context = vm.createContext({
    Date,
    agentWriteRetryAt: 0,
    stopping: { value: false },
    confirmation: { value: { id: 'c1', params: {} } },
    sessionId: { value: 'session' },
    autoApprovingIds: new Set(),
    autoApprovedIds: new Set(),
    autoApproveAttempts: new Map(),
    AUTO_APPROVE_MAX_ATTEMPTS: 3,
    shouldAutoApprove: () => true,
    resolveConfirmation: async () => { posts++; return outcome },
  })
  vm.runInContext(code, context)
  await Promise.all([context.maybeAutoApprove(), context.maybeAutoApprove()])
  for (let i = 0; i < 9; i++)
    await context.maybeAutoApprove()
  assert.equal(posts, 1, 'a stale/accepted confirmation id is never re-posted')
  // Failures (network/lock) retry, but are capped.
  context.confirmation.value = { id: 'c2', params: {} }
  outcome = 'failed'
  for (let i = 0; i < 9; i++)
    await context.maybeAutoApprove()
  assert.equal(posts, 1 + 3)
})

test('auto-approve 409 "No matching confirmation" is silent and does not loop', async () => {
  const code = extractFunctions('../app/composables/useAgentLab.ts', ['resolveConfirmation'])
  let fetches = 0
  const errors = []
  const context = vm.createContext({
    confirmation: { value: { id: 'c1', kind: 'video', params: {} } },
    sessionId: { value: 'session' },
    messages: { value: [{ id: 'm', confirmation: { id: 'c1', approvedBy: 'agent' }, confirmationState: 'confirmed' }] },
    pending: { value: false },
    status: { value: 'idle' },
    activeAgentId: { value: 'agent' },
    streamEpoch: 0,
    activeTurns: 0,
    baseUrl: '/api/agent',
    crypto: { randomUUID: () => 'uuid' },
    labHeaders: () => ({}),
    fetch: async () => { fetches++; return { status: 409, ok: false } },
    parseError: async () => 'No matching confirmation',
    hydrateServer: async () => {},
    persistCanvasResults: async () => {},
    trimLab: () => {},
    persistChat: async () => {},
    maybeAutoApprove: async () => {},
    // Probes for the *next* auto card; maybeAutoApprove refuses this id afterwards.
    scheduleAutoApproveRetry: () => {},
    shouldAutoApprove: () => true,
    finishTurnBusy: async () => {},
    clearLabError: () => {},
    setLabError: message => errors.push(message),
    isSessionLockError: () => false,
    gptImage2ComboError: () => '',
    consumeSse: async () => false,
    setTimeout,
  })
  vm.runInContext(code, context)
  const result = await context.resolveConfirmation('confirm', {}, 'agent')
  assert.equal(result, 'stale')
  assert.equal(fetches, 1)
  assert.deepEqual(errors, [])
  assert.equal(context.confirmation.value, null)
})

test('"No matching confirmation" is transient UI state, not a saved red chat turn', () => {
  assert.equal(isAgentTransientMessage({ kind: 'error', content: 'No matching confirmation' }), true)
  assert.equal(isAgentTransientMessage({ kind: 'error', content: 'Generation failed' }), false)
})

test('a fail from earlier in a long video batch is still retryable when the batch settles', () => {
  const now = Date.now()
  const images = [{ id: 'early', status: 'fail', prompt: 'shot 1', kind: 'video', failedAt: now - 20 * MIN }]
  assert.deepEqual(eligibleAutoRetryFails(images, { ids: ['early'], text: '', now }).map(item => item.id), ['early'])
})
