import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { configureDatabase, defineCollection, closeDatabase } from '../server/utils/sqlite.ts'
import { generationConcurrency } from '../server/utils/generationConcurrency.ts'

test('concurrent dispatch uses one local queue and one global generation limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-local-queue-'))
  configureDatabase(join(dir, 'queue.sqlite'))
  try {
    const GenerationJob = defineCollection('generation_jobs', () => ({ state: 'queued', deleted: false }), [{ fields: ['taskId'] }])
    for (let i = 0; i < 12; i++)
      await GenerationJob.create({ taskId: 'agent_' + i, originalRequest: { source: 'agent', holdSlot: true } })
    const source = readFileSync(new URL('../server/utils/generationQueue.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
    const context = vm.createContext({
      exports: {}, console, GenerationJob, generationConcurrency,
      GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating'],
      readErrorMessage: error => error.message,
      isProviderStarted: () => false,
      createFalTask: () => { throw new Error('Test must not call the provider') },
      createFalTask: () => { throw new Error('Test must not call the provider') },
    })
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await Promise.all(Array.from({ length: 12 }, () => context.exports.dispatchQueuedJobs()))
    assert.equal(await GenerationJob.countDocuments({ state: 'generating' }), 10)
    assert.equal(await GenerationJob.countDocuments({ state: 'queued' }), 2)
    await GenerationJob.updateOne({ taskId: 'agent_0' }, { $set: { state: 'success' } })
    await context.exports.dispatchQueuedJobs()
    assert.equal(await GenerationJob.countDocuments({ state: 'generating' }), 10)
    assert.equal(await GenerationJob.countDocuments({ state: 'queued' }), 1)
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})
