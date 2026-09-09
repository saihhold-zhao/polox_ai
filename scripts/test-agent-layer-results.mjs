import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { confirmationMedia } from '../app/utils/agentConfirmationState.ts'

const source = readFileSync(new URL('../shared/utils/agentLayerResults.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
const context = vm.createContext({ exports: {}, isImageLayerSplitterModel: model => model === 'image-layer-splitter' })
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const { completedLayerResults } = context.exports
const image = { id: 'call_abc', status: 'success', url: 'old', modelId: 'image-layer-splitter' }
const job = { model: 'image-layer-splitter', state: 'success', resultUrls: ['background', 'duck', 'fox'], layers: [{ name: 'Background' }, { name: 'Duck' }, { name: 'Fox' }] }

test('completed split recovers every named layer even if the primary image is already successful', () => {
  const results = completedLayerResults(image, job)
  assert.equal(results.length, 3)
  assert.equal(results[0].id, image.id)
  assert.equal(results[1].id, 'call_abc_1')
  assert.equal(results[1].name, 'Duck')
  assert.equal(results[2].url, 'fox')
  assert.equal(results[2].status, 'success')
  assert.equal(image.url, 'old')
  assert.equal(JSON.stringify(results), JSON.stringify(completedLayerResults(image, job)))
})

test('pending and failed jobs do not announce completion; unrelated models are unchanged', () => {
  for (const state of ['generating', 'archiving', 'moderating', 'fail'])
    assert.equal(completedLayerResults(image, { ...job, state }).length, 0)
  assert.equal(completedLayerResults(image, { ...job, model: 'other' }).length, 0)
  assert.equal(completedLayerResults(image, { ...job, resultUrls: [] }).length, 0)
})

function createPollingState(messages = []) {
  const source = ts.createSourceFile('useAgentLab.ts', readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let fn
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyJobToImage')
      fn = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(fn)
  let saves = 0
  const state = {
    completedLayerResults,
    confirmationMedia,
    images: { value: [{ ...image, id: 'call_abc' }] },
    messages: { value: messages },
    autoRetries: new Map(),
    agentJobTaskId: id => `agent_${id}`,

    persistChat: () => { saves++ },
  }
  vm.createContext(state)
  vm.runInContext(ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 }), state)
  return { state, saves: () => saves }
}

const savedJob = { ...job, taskId: 'agent_call_abc' }

test('job polling appends all layer thumbnails and exactly one fallback when no owner exists', () => {
  const { state, saves } = createPollingState()
  state.applyJobToImage(savedJob)
  state.applyJobToImage(savedJob)
  assert.equal(state.images.value.length, 3)
  assert.equal(state.messages.value.length, 1)
  assert.equal(state.messages.value[0].imageIds.length, 3)
  assert.match(state.messages.value[0].content, /拆分已完成/)
  assert.equal(saves(), 1)
})

test('polling completes the original confirmation without adding a second result row', () => {
  const owner = { id: 'card', role: 'assistant', content: '', confirmation: { id: 'confirm', jobs: [{ id: image.id }] }, imageIds: [image.id] }
  const summary = { id: 'summary', role: 'assistant', content: '图像图层已成功拆分。' }
  const { state, saves } = createPollingState([owner, summary])
  state.applyJobToImage(savedJob)
  state.applyJobToImage(savedJob)
  assert.equal(state.messages.value.length, 2)
  assert.equal(owner.imageIds.length, 3)
  assert.equal(summary.imageIds, undefined)
  assert.equal(saves(), 1)
})

test('a later owner replaces a saved fallback while keeping unrelated results and user attachments', () => {
  const { state } = createPollingState()
  state.applyJobToImage(savedJob)
  state.messages.value[0].id = `ui:${state.messages.value[0].id}`
  const owner = { id: 'card', role: 'assistant', content: '', confirmation: { id: 'confirm', jobs: [{ id: image.id }] }, imageIds: ['other-job'] }
  const user = { id: 'user', role: 'user', content: 'Use this layer', imageIds: [image.id] }
  state.messages.value.push(owner, user)
  state.applyJobToImage(savedJob)
  assert.equal(state.messages.value.length, 2)
  assert.equal(state.messages.value[0], owner)
  assert.deepEqual(Array.from(owner.imageIds), ['other-job', image.id, `${image.id}_1`, `${image.id}_2`])
  assert.equal(state.messages.value[1], user)
})

test('transcript media owns recovered layers even without a confirmation card', () => {
  const owner = { id: 'history:result', role: 'assistant', content: 'Done', imageIds: [image.id] }
  const { state } = createPollingState([owner])
  state.applyJobToImage(savedJob)
  assert.equal(state.messages.value.length, 1)
  assert.equal(owner.imageIds.length, 3)
})
