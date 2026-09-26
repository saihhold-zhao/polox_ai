import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyLlmImageBudget,
  dataUrlBytes,
  isLlmImageSizeError,
  LLM_IMAGE_BUDGET,
  LLM_IMAGE_RETRY_BUDGET,
  llmImagePlaceholder,
  llmImageUrlsNewestFirst,
} from '../server/agent/llmImageBudget.ts'

const MB = 1024 * 1024
const MEDIA = 'http://localhost:3001/media/agent-lab/s'
const img = url => ({ type: 'image_url', image_url: { url } })
const urls = (prefix, n) => Array.from({ length: n }, (_, i) => `${MEDIA}/${prefix}${i + 1}.png`)

// Shape of session 90caf968: 4 older uploads, 4 full-res generated stills auto-attached by
// inspectGeneratedStills, then 6 uploads in the current turn (14 images, ~28.6MB raw).
function stuckSession() {
  const older = urls('old', 4)
  const generated = urls('gen', 4)
  const current = urls('now', 6)
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: 'first brief' }, ...older.map(img)] },
    { role: 'assistant', content: 'ok' },
    { role: 'user', internal: true, content: [{ type: 'text', text: 'Inspect these generated stills' }, ...generated.map(img)] },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: [{ type: 'text', text: 'new brief' }, ...current.map(img)] },
  ]
  return { messages, older, generated, current }
}
const sent = messages => messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url').map(p => p.image_url.url) : [])
const placeholders = messages => messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'text' && p.text.startsWith('[image omitted: ')).map(p => p.text) : [])

test('newest-first order puts the current turn first', () => {
  const { messages, current, generated } = stuckSession()
  const order = llmImageUrlsNewestFirst(messages)
  assert.deepEqual(order.slice(0, 6), current)
  assert.deepEqual(order.slice(6, 10), generated)
})

test('unknown sizes: conservative estimate keeps newest current-turn images under the byte budget', () => {
  const { messages, current } = stuckSession()
  const result = applyLlmImageBudget(messages, LLM_IMAGE_BUDGET)
  // 18MB / 4MB assumed -> 4 images, all from the current turn.
  assert.deepEqual(sent(result.messages), current.slice(0, 4))
  assert.ok(result.bytes <= LLM_IMAGE_BUDGET.maxBytes)
  assert.equal(result.kept + result.omitted, 14)
  assert.equal(placeholders(result.messages).length, 10)
  // Older images become placeholders that keep the original URL for tools.
  assert.ok(placeholders(result.messages).includes(llmImagePlaceholder(`${MEDIA}/old1.png`)))
  // Input messages are not mutated (stored session stays intact).
  assert.equal(sent(messages).length, 14)
})

test('downscaled copies: all current-turn images plus newest older ones fit; count cap holds', () => {
  const { messages, current, generated } = stuckSession()
  const small = `data:image/webp;base64,${'A'.repeat(Math.ceil(400 * 1024 * 4 / 3))}` // ~400KB
  const result = applyLlmImageBudget(messages, { ...LLM_IMAGE_BUDGET, copyFor: () => small })
  assert.equal(result.kept, LLM_IMAGE_BUDGET.maxImages)
  assert.ok(result.bytes <= LLM_IMAGE_BUDGET.maxBytes)
  const last = result.messages.at(-1).content.filter(p => p.type === 'image_url')
  assert.equal(last.length, current.length)
  assert.ok(last.every(p => p.image_url.url === small))
  // 8 slots: 6 current + 2 generated stills (message order within a turn); the rest are placeholders.
  const inspect = result.messages[3].content
  assert.equal(inspect.filter(p => p.type === 'image_url').length, 2)
  assert.deepEqual(inspect.filter(p => p.type === 'text' && p.text.startsWith('[image omitted')).map(p => p.text), generated.slice(2).map(llmImagePlaceholder))
  assert.equal(result.messages[1].content.filter(p => p.type === 'image_url').length, 0)
})

test('known sizes: once one image does not fit, every older image is omitted (no gaps)', () => {
  const messages = [
    { role: 'user', content: [img('https://x/a.png')] },
    { role: 'user', content: [img('https://x/b.png')] },
    { role: 'user', content: [img('https://x/c.png')] },
  ]
  const sizes = { 'https://x/c.png': 10 * MB, 'https://x/b.png': 12 * MB, 'https://x/a.png': 1 * MB }
  const result = applyLlmImageBudget(messages, { ...LLM_IMAGE_BUDGET, sizeOf: url => sizes[url] })
  assert.deepEqual(sent(result.messages), ['https://x/c.png'])
  assert.equal(result.omitted, 2)
})

test('retry budget keeps only the latest real user turn (internal turns do not count as the user turn)', () => {
  const { messages, current } = stuckSession()
  const result = applyLlmImageBudget(messages, { ...LLM_IMAGE_RETRY_BUDGET, copyFor: () => 'data:image/webp;base64,AAAA' })
  assert.deepEqual(result.messages.at(-1).content.filter(p => p.type === 'image_url').length, LLM_IMAGE_RETRY_BUDGET.maxImages)
  assert.equal(sent(result.messages).length, LLM_IMAGE_RETRY_BUDGET.maxImages)
  assert.ok(current.length > LLM_IMAGE_RETRY_BUDGET.maxImages)
})

test('duplicate URLs are sent once; text-only messages pass through untouched', () => {
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'user', content: [img('https://x/a.png')] },
    { role: 'user', content: [{ type: 'text', text: 'again' }, img('https://x/a.png')] },
  ]
  const result = applyLlmImageBudget(messages, LLM_IMAGE_BUDGET)
  assert.equal(result.messages[0], messages[0])
  assert.deepEqual(sent(result.messages), ['https://x/a.png'])
  assert.deepEqual(result.messages[2].content.map(p => p.type), ['text', 'image_url'])
  assert.deepEqual(result.messages[1].content, [{ type: 'text', text: llmImagePlaceholder('https://x/a.png') }])
})

test('size helpers: data URL bytes and provider size errors', () => {
  assert.equal(dataUrlBytes('data:image/webp;base64,AAAA'), 3)
  assert.equal(dataUrlBytes('https://x/a.png'), undefined)
  assert.ok(isLlmImageSizeError(413, ''))
  assert.ok(isLlmImageSizeError(400, '{"error":{"message":"Downloaded image content cannot exceed 30MB","code":413}}'))
  assert.ok(!isLlmImageSizeError(400, 'Invalid tool schema'))
  assert.ok(!isLlmImageSizeError(429, 'Rate limit exceeded'))
})
