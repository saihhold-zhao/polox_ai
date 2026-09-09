import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
const file = readFileSync(new URL('../app/pages/projects/[id].vue', import.meta.url), 'utf8')
const source = ts.createSourceFile('page.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
function extract(name) {
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  return ts.transpile(node.getText(source), { target: ts.ScriptTarget.ES2022 })
}
test('bulk actions wait for confirmation and retain only failed tasks for retries', async () => {
  const calls = []
  const removed = []
  const state = { bulkAction: { value: null }, bulkTaskIds: { value: [] }, bulkPending: { value: false }, items: { value: [{taskId:'a'}, {taskId:'b'}] }, total: {value:2}, toast: {error: () => {}}, removeAgentResult: id => removed.push(id), loadJobs: async () => {}, loadProjects: async () => {}, $fetch: async (url, options) => { calls.push([url, options.method]); if(url.endsWith('/b')) throw new Error('network') } }
  vm.createContext(state)
  vm.runInContext(extract('requestBulk') + extract('confirmBulk'), state)
  state.requestBulk('delete', ['a', 'b', 'a'])
  assert.equal(calls.length, 0)
  await state.confirmBulk()
  assert.deepEqual(removed, ['a'])
  assert.equal(state.bulkTaskIds.value.join(','), 'b')
  assert.equal(state.bulkAction.value, 'delete')
  assert.equal(state.bulkPending.value, false)
  state.$fetch = async (url, options) => calls.push([url, options.method])
  await state.confirmBulk()
  assert.equal(state.bulkAction.value, null)
  assert.equal(calls.filter(([url]) => url.endsWith('/a')).length, 1)
})
