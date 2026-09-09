import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { confirmedLayerSelections } from '../server/agent/layerSplitBrief.ts'
import { validateLayerSelection, validateLayerSelections } from '../shared/utils/agentLayerSelection.ts'

const urls = ['https://example.com/first.png', 'https://example.com/second.png']
const boxes = [[[0, 0, 300, 300]], [[100, 100, 500, 500], [500, 500, 900, 900]]]
const normalize = value => JSON.parse(JSON.stringify(value))
function loadFunction(file, name, context) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  vm.runInContext(ts.transpileModule(fn.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

test('switching image tabs preserves boxes and submits both images through the HTTP parser', async () => {
  const question = { id: 'layer_selection_method', options: [{ id: 'draw_boxes', label: 'Draw boxes' }] }
  const props = reactive({ choice: { id: 'batch', questions: [question] }, sourceImages: urls.map((url, i) => ({ id: String(i), url })), pending: false })
  const events = []
  const context = vm.createContext({
    computed,
    ref,
    watch,
    defineProps: () => props,
    withDefaults: value => value,
    defineEmits: () => (...event) => events.push(event),
    withCustomChoiceOption: options => options,
    validateLayerSelection,
    validateLayerSelections,
  })
  const source = readFileSync(new URL('../app/components/agent-lab/AgentLabChoiceCard.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context)
  vm.runInContext('selectOption(questions.value[0], \'draw_boxes\')', context)
  context.boxes = boxes
  context.urls = urls
  vm.runInContext('regions.value = boxes[0]', context)
  assert.equal(vm.runInContext('canSubmit.value', context), false, 'Both attached images need selections')
  vm.runInContext('sourceUrl.value = urls[1]; regions.value = boxes[1]; sourceUrl.value = urls[0]', context)
  await nextTick()
  assert.deepEqual(normalize(vm.runInContext('regions.value', context)), boxes[0])
  vm.runInContext('emitSubmit()', context)
  const imageSelections = urls.map((imageUrl, i) => ({ imageUrl, regions: boxes[i] }))
  assert.deepEqual(normalize(events[0][1][0].imageSelections), imageSelections)
  loadFunction('../server/agent/router.ts', 'parseChoiceBody', context)
  loadFunction('../server/agent/loop.ts', 'formatChoiceResult', context)
  context.body = { action: 'submit', choiceId: 'batch', answers: events[0][1] }
  context.payload = props.choice
  const result = vm.runInContext('formatChoiceResult(payload, parseChoiceBody(body), urls)', context)
  const saved = JSON.parse(result)
  assert.deepEqual(saved.answers[0].imageSelections, imageSelections)
  assert.deepEqual(confirmedLayerSelections([{ role: 'tool', content: result }]), imageSelections)
  props.answers = saved.answers
  props.choice = { ...props.choice, id: 'restored' }
  await nextTick()
  assert.deepEqual(normalize(vm.runInContext('imageSelections.value', context)), imageSelections)
})

test('batch rejects duplicate images, missing boxes, and foreign URLs', () => {
  const selection = { imageUrl: urls[0], regions: boxes[0] }
  for (const invalid of [[], null, [selection, selection], [{ ...selection, regions: [] }], [{ ...selection, imageUrl: 'https://example.com/foreign.png' }]])
    assert.throws(() => validateLayerSelections(invalid, urls))
})

test('failed layer splits never enter the generic automatic LLM retry path', async () => {
  const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('  async function retryFailedMedia('), source.indexOf('  function notifyFailedMedia('))
  const context = vm.createContext({
    isRetryableJobFail: () => true,
    autoRetries: new Map(),
    AUTO_RETRY_LIMIT: 3,
    items: [{ id: 'failed-layer', modelId: 'image-layer-splitter', error: 'Image dimensions are too small' }],
  })
  vm.runInContext(ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  assert.equal(await vm.runInContext('retryFailedMedia(items)', context), false)
  assert.equal(context.autoRetries.size, 0)
})
