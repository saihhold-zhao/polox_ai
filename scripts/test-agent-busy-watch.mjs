import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { nextTick, ref, watch } from 'vue'

// Run the production watcher with real Vue scheduling. Event-reducer tests do
// not catch exceptions in the watcher that starts recovery polling.
const filename = new URL('../app/composables/useAgentLab.ts', import.meta.url)
const source = readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true)
let watcher
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'watch') {
    const callback = node.arguments[1]?.getText(ast) || ''
    if (callback.includes('jobSyncTimer = setInterval'))
      watcher = node.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(watcher, 'Agent recovery watcher must exist')

test('thinking and tool calls start recovery polling; waiting for a choice stops it', async () => {
  const status = ref('idle')
  const pending = ref(false)
  const waitingForUser = ref(false)
  let polls = 0
  let timers = 0
  let stop
  const context = vm.createContext({
    status,
    pending,
    waitingForUser,
    images: ref([]),
    confirmation: ref(null),
    shouldAutoApprove: card => card?.approvedBy === 'agent',
    watch: (...args) => { stop = watch(...args) },
    syncGeneratingJobs: () => { polls++ },
    setInterval: () => { timers++; return 1 },
    stopJobSync: () => { context.jobSyncTimer = null },
    jobSyncTimer: null,
  })
  try {
    vm.runInContext(watcher.replaceAll('import.meta.client', 'true'), context)
    status.value = 'thinking'
    pending.value = true
    await nextTick()
    assert.equal(polls, 1)
    assert.equal(timers, 1)
    assert.equal(context.jobSyncTimer, 1)
    status.value = 'calling_tool'
    await nextTick()
    assert.equal(timers, 1, 'Do not duplicate the running timer')
    status.value = 'idle'
    waitingForUser.value = true
    await nextTick()
    assert.equal(context.jobSyncTimer, null)
    waitingForUser.value = false
    status.value = 'thinking'
    await nextTick()
    assert.equal(polls, 2, 'Resume polling for the next question')
    assert.equal(timers, 2)
  }
  finally {
    stop?.()
  }
})
