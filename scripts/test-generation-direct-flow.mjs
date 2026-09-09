import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module,
            URL,
    exports: module.exports,
    console,
    ...globals,
  })
  return module.exports
}

const input = { prompt: 'A portrait', input_urls: ['https://example.com/reference.png'] }
test('generator queues prompt and reference images directly without classification services', async () => {
  let created
  let dispatched = 0
  const api = load('../server/api/ai/generate.post.ts', {
    defineEventHandler: fn => fn,
    readBody: async () => ({ model: 'image-model', input }),
    isFalGenerateModel: () => true,
    falEndpoint: model => model,
    sanitizeGenerateInput: (_model, value) => value,
    isImageLayerSplitterModel: () => false,
    isWan30GenerateModel: () => false,
    connectDatabase: async () => {},
    resolveProject: async () => ({ _id: 'local-project' }),
    newLocalTaskId: () => 'job_direct',
    GenerationJob: {
      create: async (value) => { created = { ...value, _id: 'job' }; return created },
      findById: async () => created,
    },
    dispatchQueuedJobs: async () => { dispatched++ },
    toPublicJob: job => job,
    toPublicApiError: error => error,
  })
  const job = await api.default({})
  assert.equal(job.state, 'queued')
  assert.deepEqual(job.requestBody.input, input)
  assert.equal(dispatched, 1)
})

test('reference videos are queued without local duration probing', async () => {
  const input = { prompt: "Continue the scene", video_urls: ["https://example.com/long-video.mp4"], duration: 10 }
  let created
  let dispatched = 0
  const api = load('../server/api/ai/generate.post.ts', {
    defineEventHandler: fn => fn,
    readBody: async () => ({ model: 'wan/test', input }),
    isFalGenerateModel: () => true,
    falEndpoint: model => model,
    sanitizeGenerateInput: (_model, value) => value,
    isImageLayerSplitterModel: () => false,
    isWan30GenerateModel: () => false,
    connectDatabase: async () => {},
    resolveProject: async () => ({ _id: 'local-project' }),
    newLocalTaskId: () => 'job_direct',
    GenerationJob: {
      create: async (value) => { created = { ...value, _id: 'job' }; return created },
      findById: async () => created,
    },
    dispatchQueuedJobs: async () => { dispatched++ },
    toPublicJob: job => job,
    toPublicApiError: error => error,
  })
  const job = await api.default({})
  assert.equal(job.state, 'queued')
  assert.deepEqual(job.requestBody.input, input)
  assert.equal(dispatched, 1)
})

test('Agent accepts prompt and reference images and completes an image without classification services', async () => {
  let job
  let dispatched = 0
  const api = load('../server/utils/agentSlots.ts', {
    AGENT_MODELS: [],
    GENERATION_ACTIVE_STATES: ['generating', 'archiving'],
    connectDatabase: async () => {},
    resolveProject: async () => ({ _id: 'local-project' }),
    agentResultTaskId: id => `agent_${id}`,
    httpUrlList: values => (values || []).filter(Boolean),
    GenerationJob: {
      findOne: async () => job,
      create: async (value) => { job = { ...value, save: async () => {} }; return job },
      countDocuments: async () => 0,
    },
    generationConcurrency: async () => 10,
    countActiveGenerationJobs: async () => 0,
    dispatchQueuedJobs: async () => { dispatched++ },
    syncAgentRuntimeFromJob: async () => {},
  })
  const result = await api.acquireAgentSlot({ sessionId: 'session', callId: 'image', prompt: input.prompt, inputUrls: input.input_urls })
  assert.equal(result.state, 'queued')
  assert.equal(job.input.prompt, input.prompt)
  assert.deepEqual(job.input.input_urls, input.input_urls)
  const completed = await api.completeAgentSlot({ callId: 'image', url: 'https://example.com/result.png' })
  assert.equal(completed.state, 'success')
  assert.equal(job.resultUrls[0], 'https://example.com/result.png')
  assert.equal(dispatched, 2)
})


test('video uploads save and forward bytes without probing duration', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' })
  const form = new FormData()
  form.set('file', file)
  const writes = []
  const api = load('../server/api/uploads.post.ts', {
    File,
    crypto: { randomUUID: () => 'video-upload' },
    defineEventHandler: fn => fn,
    readFormData: async () => form,
    saveMediaFile: async (...args) => writes.push(args),
    uploadFalFile: async (bytes, type) => {
      assert.deepEqual(Array.from(bytes), [1, 2, 3])
      assert.equal(type, 'video/mp4')
      return 'https://cdn.fal.media/clip.mp4'
    },
  })
  const result = await api.default({})
  assert.equal(result.url, 'https://cdn.fal.media/clip.mp4')
  assert.equal('duration' in result, false)
  assert.equal(writes.length, 1)
})
