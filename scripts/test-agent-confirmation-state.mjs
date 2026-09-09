import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { confirmationWorking, reconcileConfirmationStates } from '../app/utils/agentConfirmationState.ts'

const card = (id, state = 'confirmed') => ({ id, confirmation: { id, jobs: [{ id: `${id}-job` }] }, confirmationState: state })
const media = (id, status) => ({ id: `${id}-job`, kind: 'video', status })

test('two batches: only the batch owning running jobs shows Generating, including after recovery', () => {
  const messages = [card('previous'), card('current', 'cancelled')]
  const images = [media('previous', 'success'), media('current', 'generating')]
  reconcileConfirmationStates(messages, images)
  assert.equal(messages[1].confirmationState, 'confirmed')
  assert.equal(confirmationWorking(messages[0], images, true), false)
  assert.equal(confirmationWorking(messages[1], images, false), true)
  images[1].status = 'fail'
  assert.equal(confirmationWorking(messages[1], images, true), false)
})

test('unrelated tasks do not confirm cancelled cards and queued submission can show progress before media arrives', () => {
  const message = card('current', 'cancelled')
  reconcileConfirmationStates([message], [media('other', 'generating')])
  assert.equal(message.confirmationState, 'cancelled')
  assert.equal(confirmationWorking(message, [], true), false)
  message.confirmationState = 'confirmed'
  assert.equal(confirmationWorking(message, [], true), true)
  assert.equal(confirmationWorking(message, [], false), false)
})

function extractFunction(name) {
  const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true)
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found)
  return ts.transpile(found.getText(ast), { target: ts.ScriptTarget.ES2022 })
}

test('late pending snapshot cannot downgrade approval; detached jobs recover the correct card', async () => {
  const current = card('current')
  const snapshot = { pendingConfirmation: current.confirmation, images: [], busy: true }
  const context = vm.createContext({
    sessionId: { value: 'session' },
    activeAgentId: { value: 'agent' },
    streamEpoch: 0,
    activeTurns: 0,
    baseUrl: '',
    agentWriteRetryAt: Infinity,
    messages: { value: [card('previous'), current] },
    images: { value: [] },
    error: { value: '' },
    status: { value: 'generating' },
    pending: { value: true },
    confirmation: { value: null },
    choice: { value: null },
    queueNotice: { value: '' },
    fetch: async () => ({ ok: true, json: async () => snapshot }),
    shouldAutoApprove: () => false,
    syncLabBusyFromImages: () => {},

    unionSessionImages: (_, incoming) => incoming,
    reconcileConfirmationStates,
  })
  vm.runInContext(extractFunction('hydrateServer'), context)
  await context.hydrateServer()
  assert.equal(current.confirmationState, 'confirmed')
  // Simulate an older saved card that was already downgraded before reconnecting.
  current.confirmationState = 'pending'
  snapshot.pendingConfirmation = null
  snapshot.images = [media('previous', 'success'), media('current', 'generating')]
  await context.hydrateServer()
  assert.equal(current.confirmationState, 'confirmed')
  assert.equal(confirmationWorking(context.messages.value[0], snapshot.images, true), false)
  assert.equal(confirmationWorking(current, snapshot.images, false), true)
})

test('confirmation replay preserves approval and subsequent cards do not overwrite previous batches', () => {
  const context = vm.createContext({

    shouldAutoApprove: () => false,
    crypto: { randomUUID: () => 'new-message' },
  })
  vm.runInContext(extractFunction('applyEventToState'), context)
  const previous = card('previous')
  previous.role = 'assistant'
  const state = { messages: [previous], images: [] }
  context.applyEventToState({ type: 'confirmation', confirmation: previous.confirmation }, state)
  assert.equal(previous.confirmationState, 'confirmed')
  context.applyEventToState({ type: 'confirmation', confirmation: card('current').confirmation }, state)
  assert.equal(state.messages.length, 2)
  assert.equal(previous.confirmation.id, 'previous')
  assert.equal(state.messages[1].confirmation.id, 'current')
})

test('a new confirmation does not wrap the previous batch thumbnails', () => {
  const context = vm.createContext({

    shouldAutoApprove: () => false,
    crypto: { randomUUID: () => 'new-message' },
  })
  vm.runInContext(extractFunction('applyEventToState'), context)
  const previous = { id: 'previous', role: 'assistant', content: '', imageIds: ['previous-job'] }
  const state = { messages: [previous], images: [] }
  context.applyEventToState({ type: 'confirmation', confirmation: card('current').confirmation }, state)
  assert.equal(state.messages.length, 2)
  assert.equal(previous.confirmation, undefined)
  assert.equal(state.messages[1].imageIds, undefined)
})

test('multi-output job suffixes also prove approval after the base output was trimmed', () => {
  const message = card('current', 'cancelled')
  const images = [{ id: 'current-job_1', status: 'generating' }]
  reconcileConfirmationStates([message], images)
  assert.equal(message.confirmationState, 'confirmed')
  assert.equal(confirmationWorking(message, images, false), true)
})
