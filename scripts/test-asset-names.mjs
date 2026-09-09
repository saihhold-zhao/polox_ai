import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allocateAssetName, assetName, cleanAssetName } from '../shared/utils/assetName.ts'

test('names remain stable across status changes and avoid duplicate parallel outputs', () => {
  const assets = []
  for (let index = 0; index < 4; index++) {
    const item = { id: String(index), kind: 'video' }
    item.name = allocateAssetName(item, assets)
    assets.push(item)
    assert.equal(item.name, `shot_${index + 1}`)
  }
  assert.equal(allocateAssetName({ ...assets[0], name: 'different' }, assets), 'shot_1')
  assert.equal(allocateAssetName({ id: 'new', name: 'shot_1', kind: 'video' }, assets), 'shot_1_1')
  assert.equal(allocateAssetName({ id: 'final', videoMode: 'concat' }, assets), 'final_film_1')
})

test('descriptive names and legacy labels do not expose prompts', () => {
  assert.equal(assetName({ id: '123', name: 'shot_1_forest' }), 'shot_1_forest')
  assert.equal(assetName({ id: 'legacy', kind: 'video' }), 'Video · legacy')
  assert.equal(cleanAssetName('  scene\n1/test  '), 'scene_1_test')
  assert.equal(cleanAssetName('x'.repeat(200)).length, 100)
})

test('archived chat images retain their descriptive name', async () => {
  const { AgentChat } = await import('../server/models/agentChat.ts')
  const chat = new AgentChat({ images: [{ id: 'shot', name: 'shot_1_forest', prompt: 'Full model prompt', status: 'success' }] })
  const restored = new AgentChat(chat.toObject())
  assert.equal(restored.images[0].name, 'shot_1_forest')
  assert.equal(restored.images[0].prompt, 'Full model prompt')
})

test('pending outputs with empty URLs never borrow another task name', async () => {
  const { matchingAgentAsset } = await import('../shared/utils/assetName.ts')
  const items = [{ id: 'old', name: 'shot_5', url: '' }, { id: 'new', providerTaskId: 'provider-new', name: 'Shot 6 · Hiding in the cave', url: '' }]
  assert.equal(matchingAgentAsset(items, 'unknown', ''), undefined)
  assert.equal(matchingAgentAsset(items, 'provider-new', '')?.name, 'Shot 6 · Hiding in the cave')
  assert.equal(matchingAgentAsset(items, 'agent_new', '')?.name, 'Shot 6 · Hiding in the cave')
  assert.equal(assetName({ id: 'new', name: 'shot_6', prompt: 'She hides in a cave.' }), 'shot_6 · She hides in a cave.')
})
