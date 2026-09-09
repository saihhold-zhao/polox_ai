import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'

function load(path, globals, exported) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '')
    .replace(/^export /gm, '')
  const context = vm.createContext(globals)
  vm.runInContext(ts.transpileModule(`${source}\nglobalThis.result = ${exported}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.result
}

test('tool request preserves the model, all media roles, settings and selected regions', () => {
  const model = { id: 'test-model', name: 'Test', task: 'Reference to Video' }
  const request = load('../app/utils/toolAgentRequest.ts', {
    AGENT_MODELS: [model],
    modelMention: item => `@[${item.name}](model:${item.id})`,
  }, 'toolAgentRequest')
  const input = {
    prompt: 'Keep the original subject.\nPan left.',
    reference_image_urls: ['https://example.com/image.png'],
    reference_video_urls: ['https://example.com/video.mp4'],
    reference_audio_urls: ['https://example.com/audio.mp3'],
    duration: 10,
    generate_audio: false,
    resolution: '720p',
    regions: [[1, 20, 300, 450], [500, 500, 999, 999]],
  }
  const text = request(model.id, input)
  assert.ok(text.startsWith('@[Test](model:test-model)'))
  assert.deepEqual(JSON.parse(text.slice(text.indexOf('{'))), input)
  assert.throws(() => request('missing-model', input), /not available/)
})

function harness({ allowed = true, sent = true } = {}) {
  const calls = []
  const selectedProjectId = ref('selected-project')
  const lab = {
    draft: ref('Existing agent draft'),
    error: ref('Agent could not start'),
    canCreateAgent: ref(allowed),
    ensureHydrated: async () => calls.push('hydrate'),
    createAgent: () => { calls.push('create'); lab.draft.value = '' },
    sendMessage: async () => { calls.push(['send', lab.draft.value]); return sent },
  }
  const start = load('../app/composables/useToolAgent.ts', {
    useProjects: () => ({ selectedProjectId }),
    useAgentWorkspaceNav: () => ({ resolveTargetProjectId: async () => {
      calls.push('project')
      return selectedProjectId.value
    } }),
    useAgentLab: (options) => {
      assert.equal(options.projectId.value, selectedProjectId.value)
      return lab
    },
    ref,
    useNuxtApp: () => ({ runWithContext: fn => fn() }),
    navigateTo: async path => calls.push(['navigate', path]),
    toolAgentRequest: (id, input) => JSON.stringify({ id, input }),
  }, 'useToolAgent().startToolAgent')
  return { start, calls, lab }
}

test('tool messages display the original prompt with attachments while retaining execution settings', () => {
  const model = { id: 'test-model', name: 'Test', task: 'Image to Image' }
  const { toolAgentRequest, toolAgentMessage } = load('../app/utils/toolAgentRequest.ts', {
    AGENT_MODELS: [model],
    modelMention: item => `@[${item.name}](model:${item.id})`,
  }, '({ toolAgentRequest, toolAgentMessage })')
  const input = {
    prompt: 'edit the background as a blue sky\nKeep the subject.',
    image_urls: ['https://example.com/image.png', 'https://example.com/image.png'],
    reference_video_urls: ['https://example.com/video.mp4'],
    reference_audio_urls: ['https://example.com/audio.mp3'],
    resolution: '2K',
    regions: [[0, 0, 500, 500]],
  }
  const raw = toolAgentRequest(model.id, input)
  const view = toolAgentMessage(raw)
  assert.equal(view.content, `@[Test](model:test-model)\n${input.prompt}`)
  assert.deepEqual(JSON.parse(JSON.stringify(view.attachments)), [
    { url: input.image_urls[0], kind: 'image' },
    { url: input.reference_video_urls[0], kind: 'video' },
    { url: input.reference_audio_urls[0], kind: 'audio' },
  ])
  assert.ok(!view.content.includes('exact parameters'))
  assert.ok(!view.content.includes('https://'))
  assert.deepEqual(JSON.parse(raw.slice(raw.indexOf('{'))), input)
  assert.equal(toolAgentMessage(toolAgentRequest(model.id, { image_url: input.image_urls[0] })).content, '@[Test](model:test-model)\nImage to Image')
  assert.equal(toolAgentMessage('User wrote { "prompt": "literal JSON" }'), null)
  assert.equal(toolAgentMessage(raw.replace('These settings', 'Different settings')), null)
  assert.equal(toolAgentMessage(raw.slice(0, -1)), null)
})

test('submission snapshots input, creates a fresh agent and enters the selected project', async () => {
  const { start, calls } = harness()
  const input = { image_url: 'https://example.com/image.png', regions: [[0, 0, 500, 500]] }
  const pending = start('image-layer-splitter', input)
  input.regions[0][2] = 999
  await pending
  assert.deepEqual(calls, [
    'project',
    'hydrate',
    'create',
    ['send', JSON.stringify({ id: 'image-layer-splitter', input: { image_url: input.image_url, regions: [[0, 0, 500, 500]] } })],
    ['navigate', '/projects/selected-project?mode=agent'],
  ])
})

test('agent limits preserve the existing draft and do not navigate', async () => {
  const { start, calls, lab } = harness({ allowed: false })
  await assert.rejects(start('model', {}), /Cannot create/)
  assert.equal(lab.draft.value, 'Existing agent draft')
  assert.deepEqual(calls, ['project', 'hydrate'])
})

test('failed sends do not navigate and retain the new request', async () => {
  const { start, calls, lab } = harness({ sent: false })
  await assert.rejects(start('model', { prompt: 'test' }), /Agent could not start/)
  assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'navigate'))
  assert.equal(JSON.parse(lab.draft.value).input.prompt, 'test')
})

test('concurrent project hydration callers both wait before starting a new agent', async () => {
  const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
  const section = source.slice(source.indexOf('  let hydrationPromise:'), source.indexOf('  function bindOptions('))
  let finish
  let hydrateCalls = 0
  const context = vm.createContext({
    bootstrapped: false,
    hydrating: false,
    hydrate: () => {
      hydrateCalls++
      context.hydrating = true
      return new Promise((resolve) => { finish = resolve })
    },
    syncRemoteAgents: async () => {},
  })
  vm.runInContext(ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const initial = context.ensureHydrated()
  let ready = false
  const submission = context.ensureHydrated().then(() => { ready = true })
  await Promise.resolve()
  assert.equal(ready, false)
  assert.equal(hydrateCalls, 1)
  finish()
  await Promise.all([initial, submission])
  assert.equal(ready, true)
})
