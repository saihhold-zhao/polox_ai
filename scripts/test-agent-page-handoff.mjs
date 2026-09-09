import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, ref, shallowRef, toValue, watch } from 'vue'

const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true)
const declarations = new Map()
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name)
    declarations.set(node.name.text, node.getText(ast))
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations)
      declarations.set(declaration.name.getText(ast), node.getText(ast))
  }
  ts.forEachChild(node, visit)
}
visit(ast)

function compile(names, values) {
  const context = vm.createContext({ computed, ref, shallowRef, toValue, ...values })
  const code = names.map((name) => {
    assert.ok(declarations.has(name), `Missing ${name}`)
    return declarations.get(name)
  }).join('\n')
  vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context
}

test('cached lab follows the new composer project binding after leaving a project page', async () => {
  const oldRouteProject = ref('project-1')
  const selectedProject = ref('project-1')
  const context = compile(['onJobs', 'projectSource', 'projectScope', 'bindOptions'], {
    options: { projectId: computed(() => oldRouteProject.value) },
  })
  const scope = vm.runInContext('projectScope', context)
  const resets = []
  const stop = watch(scope, value => resets.push(value))
  try {
    context.bindOptions({ projectId: selectedProject })
    oldRouteProject.value = ''
    await nextTick()
    assert.equal(scope.value, 'project-1', 'Leaving the previous page must not reset the active lab')
    assert.deepEqual(resets, [])
    selectedProject.value = 'project-2'
    await nextTick()
    assert.equal(scope.value, 'project-2', 'The composer project selector must still change scope')
    assert.deepEqual(resets, ['project-2'])
  }
  finally {
    stop()
  }
})

test('mounting the project page preserves a live turn and resumes remote sync once finished', async () => {
  const calls = []
  const context = compile(['syncRemoteAgents'], {
    activeTurns: 1,
    hydrateRemoteChats: async () => calls.push('chats'),
    hydrateRemoteSessions: async () => calls.push('sessions'),
    hydrateServer: async () => calls.push('server'),
    writeStore: () => calls.push('store'),
  })
  await context.syncRemoteAgents()
  assert.deepEqual(calls, [], 'An archive read must not overwrite the streaming session')
  context.activeTurns = 0
  await context.syncRemoteAgents()
  assert.deepEqual(calls, ['chats', 'sessions', 'server', 'store'])
})

test('new-agent send starts without the previous session and carries only submitted attachments', async () => {
  const attachment = { imageId: 'input', url: '/input.png', status: 'ready' }
  const state = {
    draft: ref('New brief'),
    readyAttachments: ref([attachment]),
    attachments: ref([attachment]),
    images: ref([{ id: 'old-output' }, { id: 'input' }]),
    sessionId: ref('old-session'),
    activeAgentId: ref('old-agent'),
    messages: ref([{ role: 'user', content: 'Old brief' }]),
    confirmation: ref({ id: 'old-confirmation' }),
    attaching: ref(false),
    canCreateAgent: ref(true),
    pending: ref(false),
    status: ref('idle'),
    stopping: ref(false),
    waitingForUserChoice: ref(false),
    waitingForUserConfirm: ref(false),
    waitingForUser: ref(false),
  }
  const runs = []
  const context = compile(['sendMessage'], {
    ...state,
    requireLogin: () => true,
    createAgent: () => {
      assert.equal(state.attachments.value.length, 0, 'Input previews must survive switching agents')
      state.sessionId.value = ''
      state.activeAgentId.value = 'new-agent'
      state.messages.value = []
      state.images.value = []
      state.confirmation.value = null
      state.draft.value = ''
    },
    hydrateServer: () => assert.fail('Must not hydrate the previous session'),
    clearLabError: () => {},
    clearComposerDraft: () => {},
    revokePreview: () => {},
    writeStore: () => {},
    crypto: { randomUUID: () => 'message-id' },
    streamEpoch: 0,
    runAgentTurn: (...args) => runs.push(args),
  })
  assert.equal(await context.sendMessage({ newAgent: true }), true)
  assert.equal(state.sessionId.value, '')
  assert.equal(state.messages.value.length, 1)
  assert.equal(state.messages.value[0].content, 'New brief')
  assert.deepEqual(Array.from(state.messages.value[0].imageIds), ['input'])
  assert.deepEqual(Array.from(state.images.value, image => image.id), ['input'])
  assert.equal(runs[0][1], 'new-agent')
  assert.deepEqual(Array.from(runs[0][3]), ['/input.png'])
})
