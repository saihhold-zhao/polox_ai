import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmedLayerSelection, hasLayerSourceImage, layerSplitNeedsPlan, layerSplitNeedsSummary, needsLayerDescriptionCard } from '../server/agent/layerSplitBrief.ts'
import { validateLayerSelection } from '../shared/utils/agentLayerSelection.ts'

const mention = { role: 'user', content: '@[Image Layer Splitter](model:image-layer-splitter)' }
const upload = { role: 'user', content: [{ type: 'text', text: 'Use the attached still(s).\n\nAttached stills:\n1. https://example.com/image.png' }, { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }

test('layer cards require an available image actually supplied by the user', () => {
  const image = { id: 'source', url: 'https://example.com/image.png', status: 'success' }
  assert.equal(hasLayerSourceImage([mention], []), false)
  assert.equal(hasLayerSourceImage([mention], [image]), false)
  assert.equal(hasLayerSourceImage([mention, upload], [image]), true)
  assert.equal(hasLayerSourceImage([mention, upload], [{ ...image, status: 'fail' }]), false)
  assert.equal(hasLayerSourceImage([mention, upload], [{ ...image, kind: 'video' }]), false)
  assert.equal(hasLayerSourceImage([mention, { ...upload, role: 'assistant' }], [image]), false)
})

test('description method requires a second card even after a text-only reply', () => {
  const call = { role: 'assistant', tool_calls: [{ id: 'method', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'layer_selection_method' }] }) } }] }
  const answer = { role: 'tool', tool_call_id: 'method', content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'describe_layers' }] }) }
  const messages = [mention, upload, call, answer]
  assert.equal(needsLayerDescriptionCard(messages), true)
  assert.equal(needsLayerDescriptionCard([...messages, { role: 'assistant', content: 'Tell me which layers.' }]), true)
  const plan = { role: 'assistant', tool_calls: [{ id: 'plan', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'layer_split_plan' }] }) } }] }
  assert.equal(needsLayerDescriptionCard([...messages, plan, { role: 'tool', tool_call_id: 'plan', content: JSON.stringify({ ok: true, skipped: true }) }]), false)
  assert.equal(needsLayerDescriptionCard([...messages, { role: 'user', content: 'Cancel and do something else.' }]), false)
  assert.equal(needsLayerDescriptionCard([mention, upload, call, { ...answer, content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes' }] }) }]), false)
})

test('drawn boxes are validated and unblock the exact selection', () => {
  const selection = validateLayerSelection('image', [[10, 20, 400, 800]], ['image'])
  const result = { role: 'tool', content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes', ...selection }] }) }
  assert.equal(layerSplitNeedsPlan([mention, upload, result]), false)
  assert.deepEqual(confirmedLayerSelection([mention, upload, result]), selection)
  assert.equal(confirmedLayerSelection([mention, upload, result, { role: 'user', content: 'Now extract a different object.' }]), null)
})

test('invalid boxes and unrelated image URLs cannot be submitted', () => {
  for (const regions of [[], [[0, 0, 0, 10]], [[0, 0, 1001, 100]], [[10, 10, 2, 2]], [[0, 0, 1.5, 10]], Array.from({ length: 17 }, () => [0, 0, 50, 50])])
    assert.throws(() => validateLayerSelection('image', regions, ['image']))
  assert.throws(() => validateLayerSelection('other', [[0, 0, 100, 100]], ['image']))
})

test('upload-only follow-up cannot authorize inferred layers', () => {
  assert.equal(layerSplitNeedsPlan([mention, { role: 'assistant', content: 'Please upload an image.' }, upload]), true)
  assert.equal(layerSplitNeedsPlan([{ ...upload, content: [{ type: 'text', text: mention.content }, upload.content[1]] }]), true)
})

test('method answer alone does not confirm an extraction plan', () => {
  assert.equal(layerSplitNeedsPlan([mention, upload, { role: 'tool', content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'describe_layers' }] }) }]), true)
})

test('answered plan proceeds; unconfirmed proposal remains blocked', () => {
  const call = { role: 'assistant', tool_calls: [{ id: 'plan', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'layer_split_plan' }] }) } }] }
  assert.equal(layerSplitNeedsPlan([mention, upload, call]), true)
  for (const result of [{ ok: true, answers: [{ questionId: 'layer_split_plan', optionId: 'subjects' }] }, { ok: true, skipped: true }])
    assert.equal(layerSplitNeedsPlan([mention, upload, call, { role: 'tool', tool_call_id: 'plan', content: JSON.stringify(result) }]), false)
})

test('explicit user targets and unrelated tasks remain unchanged', () => {
  assert.equal(layerSplitNeedsPlan([mention, upload, { role: 'user', content: 'Extract the person on the left.' }]), false)
  assert.equal(layerSplitNeedsPlan([{ role: 'user', content: 'Remove the background.' }, upload]), false)
})

test('image-specific lookup retains earlier images and uses the latest boxes for each image', () => {
  const answer = (imageUrl, regions) => ({ role: 'tool', content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes', imageUrl, regions }] }) })
  const original = [[0, 0, 100, 100]]
  const revised = [[100, 100, 500, 500]]
  const messages = [mention, answer('first', original), answer('second', original), answer('second', revised)]
  assert.deepEqual(confirmedLayerSelection(messages, 'first'), { imageUrl: 'first', regions: original })
  assert.deepEqual(confirmedLayerSelection(messages, 'second'), { imageUrl: 'second', regions: revised })
  assert.equal(confirmedLayerSelection(messages, 'missing'), null)
  assert.equal(confirmedLayerSelection([...messages, { role: 'user', content: 'Start a new split.' }], 'first'), null)
})

test('layer summary guard survives internal inspection and restoration but resets for a new user request', () => {
  const calls = ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'model_image_layer_splitter', arguments: '{}' } }))
  const images = [{ id: 'one', modelId: 'image-layer-splitter' }, { id: 'two', modelId: 'image-layer-splitter' }]
  const messages = [mention, { role: 'assistant', tool_calls: calls }, ...calls.map(call => ({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' }))]
  assert.equal(layerSplitNeedsSummary(messages, images), true)
  assert.equal(layerSplitNeedsSummary(JSON.parse(JSON.stringify(messages)), images), true)
  assert.equal(layerSplitNeedsSummary([...messages, { role: 'user', internal: true, content: 'Inspect these images and retry.' }], images), true)
  assert.equal(layerSplitNeedsSummary([...messages, { role: 'user', content: 'Retry only the failed image.' }], images), false)
  assert.equal(layerSplitNeedsSummary(messages.slice(0, -1), images), false)
  assert.equal(layerSplitNeedsSummary(messages, []), false, 'Parameter validation errors must still allow clarification')
})
