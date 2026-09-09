import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { confirmationMedia, reconcileConfirmationStates } from '../app/utils/agentConfirmationState.ts'

const filename = new URL('../app/composables/useAgentLab.ts', import.meta.url)
const source = readFileSync(filename, 'utf8').replace(/^import .*\n/gm, '').replaceAll('import.meta.client', 'true').replaceAll('import.meta.server', 'false').replaceAll('import.meta.hot', 'false')
// Run the full production composable, with real Vue scopes and SSE parsing.
// Network, storage and timers are isolated so this never launches generation jobs.
function harness() {
  let controller
  const storage = new Map()
  const timers = new Map()
  let timerId = 0
  const mounted = []
  const unmounted = []
  const context = vm.createContext({
  useServiceConnection: () => ({ ensureConnected: async () => true }),
    ...vue,
    confirmationMedia,
    reconcileConfirmationStates,
    exports: {},
    console,
    crypto,
    Response,
    TextDecoder,
    URL,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {},
    window: { setTimeout: () => 0 },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId },
    clearInterval: id => timers.delete(id),
    onMounted: fn => mounted.push(fn),
    onUnmounted: fn => unmounted.push(fn),
    useEventListener: () => {},
    useAgentPreferences: () => ({ qualityPreference: vue.ref('economy'), confirmPolicy: vue.ref('always') }),
    isInternalAgentChatText: () => false,
    publicAgentChatText: t => t,
    publicGenerationFailMessage: t => t,
    agentRecoveryNotice: t => t,
    isDisconnectError: () => false,
    recoverAgentTranscript: (local, remote) => remote.length ? remote : local,
    $fetch: async () => ({ items: [] }),
    fetch: async (url) => {
      if (url.endsWith('/v1/chat'))
        return new Response(new ReadableStream({ start(c) { controller = c } }))
      if (url.includes('/v1/sessions?'))
        return Response.json({ items: [] })
      return Response.json({ busy: false, messages: [], images: [] })
    },
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)

  return {
    context,
    timers,
    unmounted,
    open(projectId) {
      const scope = vue.effectScope()
      const lab = scope.run(() => context.exports.useAgentLab({ projectId }))
      return { scope, lab }
    },
    emit(event) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    },
    async finish() {
      controller.close()
      await setImmediate()
    },
  }
}

test('a delayed archive cannot steal the active ID during composer-to-project navigation', async () => {
  const runtime = harness()
  const home = runtime.open(vue.ref('project'))
  await home.lab.ensureHydrated()
  let releaseArchive
  runtime.context.$fetch = async path => path === '/api/ai/agent-chats'
    ? new Promise((resolve) => { releaseArchive = resolve })
    : {}
  const syncing = home.lab.ensureHydrated()
  home.lab.draft.value = 'hello'
  assert.equal(await home.lab.sendMessage(), true)
  const activeId = home.lab.activeAgentId.value
  runtime.emit({ type: 'session', sessionId: 's1' })
  await setImmediate()
  home.lab.flush()
  releaseArchive({ items: [{ sessionId: 's1', messages: [{ role: 'user', content: 'hello' }], images: [] }] })
  await syncing
  assert.equal(home.lab.activeAgentId.value, activeId, 'Archive must preserve the SSE target ID')
  runtime.context.$fetch = async () => ({ items: [] })
  const project = runtime.open(vue.computed(() => 'project'))
  await project.lab.ensureHydrated()
  home.scope.stop()
  for (const flush of runtime.unmounted) flush()
  assert.equal(home.lab.sessionId.value, project.lab.sessionId.value, 'Both consumers must share the active session')
  runtime.emit({ type: 'text', delta: 'Hello back' })
  runtime.emit({ type: 'status', status: 'idle' })
  runtime.emit({ type: 'done' })
  await runtime.finish()
  assert.equal(project.lab.messages.value.at(-1).content, 'Hello back')
  assert.equal(project.lab.status.value, 'idle')
  assert.equal(project.lab.pending.value, false)
  project.scope.stop()
})

test('recovery polling restarts for later turns after the original composer unmounts', async () => {
  const runtime = harness()
  const home = runtime.open(vue.ref('project'))
  await home.lab.ensureHydrated()
  const project = runtime.open(vue.computed(() => 'project'))
  home.scope.stop()
  for (const flush of runtime.unmounted) flush()
  for (const text of ['first turn', 'second turn']) {
    project.lab.draft.value = text
    assert.equal(await project.lab.sendMessage(), true)
    await vue.nextTick()
    assert.equal([...runtime.timers.values()].filter(timer => timer.delay === 3000).length, 1, 'The cached lab must retain exactly one recovery watcher after page unmount')
    runtime.emit({ type: 'session', sessionId: 's1' })
    runtime.emit({ type: 'text', delta: 'reply' })
    runtime.emit({ type: 'status', status: 'idle' })
    runtime.emit({ type: 'done' })
    await runtime.finish()
    assert.equal(project.lab.pending.value, false)
    assert.equal([...runtime.timers.values()].filter(timer => timer.delay === 3000).length, 0)
  }
  project.scope.stop()
})
