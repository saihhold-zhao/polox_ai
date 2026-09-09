import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isHiddenFromUserJob, visibleJobsFilter } from '../server/utils/generationJobs.ts'
import { publicGenerationFailMessage } from '../shared/types/generation.ts'

test('provider failures are visible unless the job is explicitly hidden', () => {
  assert.equal(isHiddenFromUserJob({ failCode: 'provider_rejected' }), false)
  assert.equal(isHiddenFromUserJob({ hiddenFromUser: true }), true)
  assert.equal('failCode' in visibleJobsFilter(), false)
})
test('ordinary provider reasons remain readable and database internals remain private', () => {
  assert.equal(publicGenerationFailMessage('Provider rejected the request'), 'Provider rejected the request')
  assert.equal(publicGenerationFailMessage('SQLITE_ERROR: internal details'), 'Generation failed')
})
