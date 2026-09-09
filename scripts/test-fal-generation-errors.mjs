import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
function load(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  function moduleAt(file) {
    if (cache.has(file))
      return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, {
      module,
            URL,
      exports: module.exports,
      fetch,
      AbortSignal,
      createError: details => Object.assign(new Error(details.statusMessage), details),
      ...globals,
      require: (id) => {
                if (id.endsWith('/serviceSettings')) return {readServiceSettings: () => ({falKey:'test-key',openRouterKey:'test-key',openRouterModel:'test-model'})};
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
          return target.endsWith('.json') ? JSON.parse(readFileSync(target, 'utf8')) : moduleAt(`${target}.ts`)
        }
        return require(id)
      },
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}
const fluxModel = 'blackforestlabs/flux-3/image-to-video'
const policyMessage = 'The content could not be processed because it contained material flagged by a content checker.'

function harness({ model = fluxModel, status = { status: 'COMPLETED' }, error, statusError, result = { video: { url: 'https://example.com/result.mp4' } } } = {}) {
  let polls = 0
  const savedStates = []
  const job = {
    taskId: 'job_regression',
    providerTaskId: 'provider-id',
    model,
    requestBody: {},
    state: 'generating',
    resultUrls: [],
    save: async () => { savedStates.push(job.state) },
  }
  const api = load('server/utils/falGenerate.ts', {
    './generationJobs': { isProviderStarted: () => true, jobProviderId: job => job.providerTaskId },
    './httpError': { toUpstreamApiError: error => error },
    './imageLayerSplitter': {},
    './falFiles': { prepareFalFiles: async input => input },
    './generationResults': { mergeSourceUrls: (job, urls) => { job.sourceUrls = urls } },
  }, {
    console: { error: () => {} },
    useRuntimeConfig: () => ({ apiKeys: { fal: 'test-key' } }),
    $fetch: async (url) => {
      polls++
      if (url.endsWith('/status')) {
        if (statusError)
          throw statusError
        return status
      }
      if (error)
        throw error
      return result
    },
  })
  return { job, sync: () => api.syncJobFromFal(job), counts: () => ({ polls }) }
}

for (const model of [fluxModel, 'blackforestlabs/flux-3/text-to-video', 'blackforestlabs/flux-3/first-last-frame-to-video', 'fal-ai/ideogram/remove-background', 'image-layer-splitter']) {
  test(`${model}: result 422 persists failure and stops polling`, async () => {
    const h = harness({ model, error: { statusCode: 422, data: { detail: [{ loc: ['body', 'prompt'], msg: policyMessage, type: 'content_policy_violation' }] } } })
    await h.sync()
    assert.equal(h.job.state, 'fail')
    assert.equal(h.job.failCode, '422')
    assert.ok(h.job.lastSyncAt)
    assert.ok(h.job.failMsg.includes(policyMessage))
    await h.sync()
    assert.deepEqual(h.counts(), { polls: 2 })
  })
}

test('422 from the status endpoint also terminates the job', async () => {
  const h = harness({ statusError: { status: 422, data: { detail: policyMessage } } })
  await h.sync()
  assert.equal(h.job.state, 'fail')
  assert.equal(h.job.failMsg, policyMessage)
  assert.deepEqual(h.counts(), { polls: 1 })
})

for (const status of ['COMPLETED', 'FAILED', 'CANCELED']) {
  test(`${status} with an explicit error fails without fetching a result`, async () => {
    const h = harness({ status: { status, error: policyMessage } })
    await h.sync()
    assert.equal(h.job.state, 'fail')
    assert.equal(h.job.failMsg, policyMessage)
    assert.deepEqual(h.counts(), { polls: 1 })
  })
}

for (const code of [0, 401, 403, 404, 408, 429, 500, 502, 503, 504]) {
  for (const phase of ['statusError', 'error']) {
    test(`${phase} ${code} remains retryable`, async () => {
      const h = harness({ [phase]: { statusCode: code, message: 'Temporary failure' } })
      await h.sync()
      assert.equal(h.job.state, 'generating')
      assert.ok(h.job.lastSyncAt)
    })
  }
}

test('successful COMPLETED response continues to local archiving', async () => {
  const h = harness({ status: { status: 'COMPLETED', error: null } })
  await h.sync()
  assert.equal(h.job.state, 'archiving')
  assert.equal(h.job.sourceUrls[0], 'https://example.com/result.mp4')
})

for (const [status, state] of [['IN_QUEUE', 'queuing'], ['IN_PROGRESS', 'generating']]) {
  test(`${status} remains active without fetching a result`, async () => {
    const h = harness({ status: { status } })
    await h.sync()
    assert.equal(h.job.state, state)
    assert.deepEqual(h.counts(), { polls: 1 })
  })
}

for (const status of ['COMPLETED', 'FAILED', 'CANCELED']) {
  test(`layer splitter ${status} preserves the provider reason`, async () => {
    const h = harness({ model: 'image-layer-splitter', status: { status, error: policyMessage } })
    await h.sync()
    assert.equal(h.job.failMsg, policyMessage)
    assert.equal(h.job.state, 'fail')
  })
}

test('layer splitter missing provider reason uses a readable fallback', async () => {
  const h = harness({ model: 'image-layer-splitter', status: { status: 'FAILED' } })
  await h.sync()
  assert.equal(h.job.failMsg, 'Fal generation failed')
})
