import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

test('history windows abort stale requests, prepend messages, and keep failed pages available for retry', async () => {
  const source = readFileSync(new URL('../app/components/agent-lab/AgentLabHistoryPanel.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*\n/gm, '').replaceAll('import.meta.client', 'true')
  const requests = []
  const props = reactive({ endpoint: '/history/first', beforeId: '' })
  let dispose
  const scope = effectScope()
  const context = vm.createContext({
    defineProps: () => props,
    defineExpose: () => {},
    defineEmits: () => () => {},
    ref,
    shallowRef,
    computed,
    watch,
    nextTick,
    onBeforeUnmount: (fn) => { dispose = fn },
    AbortController,
    requestAnimationFrame: fn => fn(),
    $fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  })
  const js = ts.transpileModule(`${source}\nglobalThis.api = { page, load, loading, error };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  scope.run(() => vm.runInContext(js, context))
  const page = value => ({ messages: [{ id: value, role: 'user', content: value }], images: [], olderCursor: 'older', newerCursor: null })
  props.endpoint = '/history/second'
  await nextTick()
  assert.equal(requests[0].options.signal.aborted, true)
  requests[1].resolve(page('second'))
  await nextTick()
  await nextTick()
  await setImmediate()
  requests[0].resolve(page('stale first'))
  await nextTick()
  assert.equal(context.api.page.value.messages[0].id, 'second')
  const failed = context.api.load('older')
  requests[2].reject(new Error('Offline'))
  await failed
  assert.equal(context.api.page.value.messages[0].id, 'second')
  assert.ok(context.api.error.value)
  const retry = context.api.load('older')
  requests[3].resolve({ ...page('older page'), olderCursor: 'oldest-cursor' })
  await retry
  assert.equal(context.api.page.value.messages.length, 2)
  assert.equal(context.api.page.value.messages[0].id, 'older page')
  assert.equal(context.api.page.value.messages[1].id, 'second')
  const pending = context.api.load('older')
  dispose()
  assert.equal(requests[4].options.signal.aborted, true)
  requests[4].resolve(page('unmounted'))
  await pending
  assert.equal(context.api.page.value.messages[0].id, 'older page')
  scope.stop()
})

test('embedded history loads lazily, preserves the reading position, deduplicates, and stops silently at the beginning', async () => {
  const source = readFileSync(new URL('../app/components/agent-lab/AgentLabHistoryPanel.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*\n/gm, '').replaceAll('import.meta.client', 'true')
  const requests = []
  const node = { scrollTop: 12, scrollHeight: 500 }
  const props = reactive({ endpoint: '/history', beforeId: 'live-first', embedded: true, scrollContainer: node })
  const scope = effectScope()
  const context = vm.createContext({
    defineProps: () => props,
    defineExpose: () => {},
    ref,
    shallowRef,
    computed,
    watch,
    nextTick: async () => { node.scrollHeight += 200 },
    onBeforeUnmount: () => {},
    AbortController,
    requestAnimationFrame: fn => fn(),
    $fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  })
  const js = ts.transpileModule(`${source}\nglobalThis.api = { page, load };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  scope.run(() => vm.runInContext(js, context))
  assert.equal(requests.length, 0)
  const initial = context.api.load()
  assert.equal(requests[0].options.query.beforeId, 'live-first')
  await context.api.load()
  assert.equal(requests.length, 1)
  requests[0].resolve({ messages: [{ id: 'recent' }], images: [{ id: 'image' }], olderCursor: 'cursor', newerCursor: null })
  await initial
  assert.equal(node.scrollTop, 212)
  const older = context.api.load()
  assert.equal(requests[1].options.query.before, 'cursor')
  requests[1].resolve({ messages: [{ id: 'oldest' }, { id: 'recent' }], images: [{ id: 'image' }], olderCursor: null, newerCursor: null })
  await older
  assert.equal(node.scrollTop, 412)
  assert.deepEqual(Array.from(context.api.page.value.messages, item => item.id), ['oldest', 'recent'])
  assert.equal(context.api.page.value.images.length, 1)
  await context.api.load()
  assert.equal(requests.length, 2)
  props.beforeId = 'updated-live-boundary'
  await nextTick()
  await context.api.load()
  assert.equal(requests.length, 2, 'Live snapshot changes must not restart exhausted history')
  scope.stop()
})

test('scrolling up reveals cached turns before requesting archived history', async () => {
  const source = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')
    .split('const pinnedToBottom =')[1]
    .split('function scrollToBottom()')[0]
  const scope = effectScope()
  const context = vm.createContext({
    props: reactive({ messages: Array.from({ length: 95 }, (_, i) => ({ id: String(i) })), sessionId: 'session' }),
    ref,
    computed,
    watch,
    nextTick: async () => { context.api.scroller.value.scrollHeight += 400 },
  })
  const js = ts.transpileModule(`const pinnedToBottom =${source}\nglobalThis.api = { visibleMessages, openHistory, scroller, historyPanel, onScrollerWheel };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  scope.run(() => vm.runInContext(js, context))
  let requests = 0
  context.api.historyPanel.value = { load: async () => { requests++ } }
  context.api.scroller.value = { scrollTop: 100, scrollHeight: 500 }
  assert.equal(context.api.visibleMessages.value.length, 40)
  context.api.onScrollerWheel({ deltaY: -10 })
  await setImmediate()
  assert.equal(context.api.visibleMessages.value.length, 80)
  assert.equal(context.api.scroller.value.scrollTop, 500)
  assert.equal(requests, 0)
  await context.api.openHistory()
  assert.equal(context.api.visibleMessages.value.length, 95)
  assert.equal(requests, 0)
  await context.api.openHistory()
  assert.equal(requests, 1)
  scope.stop()
})
