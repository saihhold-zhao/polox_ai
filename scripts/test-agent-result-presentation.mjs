import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageMedia } from '../app/utils/agentMessageMedia.ts'
import { presentAgentResults } from '../app/utils/agentResultPresentation.ts'

const assets = [0, 1, 2].map(index => ({ id: index ? `split_${index}` : 'split', url: `https://example.com/${index}.png`, status: 'success' }))
const card = { id: 'card', role: 'assistant', content: '', confirmation: { id: 'confirmation', jobs: [{ id: 'split' }] }, imageIds: assets.map(image => image.id) }
const summary = { id: 'done', role: 'assistant', content: '图像图层已成功拆分。' }
const present = (messages, images = assets) => presentAgentResults(messages, message => messageMedia(message, images))

test('finished layers appear once below the completion reply, not the confirmation', () => {
  const messages = [card, summary]
  const before = structuredClone(messages)
  const rows = present(messages)
  assert.equal(rows[0].media.length, 0)
  assert.deepEqual(rows[1].media, assets)
  assert.deepEqual(messages, before)
})

test('legacy duplicate completion and media rows do not repeat the finished gallery', () => {
  const rows = present([card, { id: 'media', role: 'assistant', content: '', imageIds: card.imageIds }, summary, {
    id: 'ui:layers-complete:agent_split',
    role: 'assistant',
    content: '图层拆分已完成，共 3 个图层（含背景）。结果如下，也已添加到画布。',
    imageIds: card.imageIds,
  }])
  assert.deepEqual(rows.map(row => row.id), ['card', 'done'])
  assert.deepEqual(rows[1].media, assets)
})

test('detached completion has a result row that is replaced by the final reply when it arrives', () => {
  const rows = present([card])
  assert.deepEqual(rows.map(row => row.id), ['card', 'results:card'])
  assert.equal(rows[0].media.length, 0)
  assert.deepEqual(rows[1].media, assets)
  assert.deepEqual(present([card, summary]).map(row => row.id), ['card', 'done'])
})

test('results do not move across a later user turn or another confirmation', () => {
  const next = { id: 'next', role: 'user', content: 'Another task', imageIds: ['split'] }
  const rows = present([card, next, summary])
  assert.deepEqual(rows.map(row => row.id), ['card', 'results:card', 'next', 'done'])
  assert.equal(rows[3].media.length, 0)
  assert.deepEqual(rows[2].media, [assets[0]])
})

test('running media stays with its progress card and thinking does not become the final reply', () => {
  const running = assets.map(image => ({ ...image, status: 'generating' }))
  assert.equal(present([card], running).length, 1)
  assert.deepEqual(present([card], running)[0].media, running)
  const rows = present([card, { id: 'thinking', role: 'assistant', content: '<think>Summarize the results</think>' }, summary])
  assert.equal(rows[1].media.length, 0)
  assert.deepEqual(rows[2].media, assets)
})
