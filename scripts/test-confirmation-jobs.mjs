import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile('loop.ts', readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
function extract(name) {
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn)
  return ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 })
}

test('batch confirmation includes each distinct prompt, name, reference and duration', () => {
  const session = { images: [], messages: [] }
  const sandbox = {
    findAgentModelTool: () => undefined,
    requireSession: () => session,
    crypto: { randomUUID: () => 'confirmation' },
    GENERATE_IMAGE_TOOL: 'image',
    GENERATE_VIDEO_TOOL: 'video',
    REMOVE_BACKGROUND_TOOL: 'cutout',
    parseGenerateVideoArgs: JSON.parse,
    clampVideoToFamily: value => value,
    resolveGenerateVideoArgs: value => value,
    quoteTool: () => 3,
    confirmationKind: () => 'video',
    confirmationModel: () => ({ modelName: 'Wan 3.0', task: 'Image to Video' }),
    confirmationInputUrls: (image, video) => [video.first_frame_url],
    touch: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(extract('queueGenerationWork'), sandbox)
  const items = [1, 2].map(i => ({ toolCallId: `task_${i}`, tool: 'video', argsJson: JSON.stringify({ name: `shot_${i}`, prompt: `Motion ${i}`, duration: i * 5, first_frame_url: `https://example.com/${i}.png` }) }))
  sandbox.queueGenerationWork('session', items, () => {})
  const jobs = session.pendingConfirmation.payload.jobs
  assert.equal(jobs.length, 2)
  jobs.forEach((job, i) => {
    assert.equal(job.name, `shot_${i + 1}`)
    assert.equal(job.params.prompt, `Motion ${i + 1}`)
    assert.equal(job.params.duration, (i + 1) * 5)
    assert.equal(job.inputUrls[0], `https://example.com/${i + 1}.png`)
  })
})
