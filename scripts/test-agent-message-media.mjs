import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { messageMedia } from '../app/utils/agentMessageMedia.ts'

const images = [
  { id: 'shot', url: 'https://media.example/shot.png' },
  { id: 'final', url: 'https://media.example/final.mp4?version=2&quality=hd' },
]

test('final result links become attachments even without imageIds, with exact URL matching and deduplication', () => {
  const content = `新的完整视频：[点击观看](${images[1].url})`
  assert.deepEqual(messageMedia({ content }, images), [images[1]])
  assert.deepEqual(messageMedia({ content, imageIds: ['final', 'final'] }, [...images, { ...images[1], id: 'alias' }]), [images[1]])
  assert.deepEqual(messageMedia({ content: 'https://media.example/shot.png.backup' }, images), [])
  assert.deepEqual(messageMedia({ content: '', imageIds: ['shot'] }, images), [images[0]])
  assert.deepEqual(messageMedia({ content: `Result: ${images[1].url}` }, images), [images[1]])
})

function componentFunction(path, name) {
  const source = parse(readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const tree = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true)
  return ts.transpile(tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree), { target: ts.ScriptTarget.ES2022 })
}

test('generated media links prevent browser navigation; unrelated links retain normal behavior', () => {
  const calls = []
  const context = vm.createContext({ props: { mediaUrls: [images[1].url] }, navigateToMedia: url => calls.push(url) })
  vm.runInContext(componentFunction('../app/components/agent-lab/AgentLabMarkdown.vue', 'onLinkClick'), context)
  const click = (url) => {
    let prevented = false
    context.onLinkClick({ target: { closest: () => ({ getAttribute: () => url }) }, preventDefault: () => { prevented = true } })
    return prevented
  }
  assert.equal(click(images[1].url), true)
  assert.deepEqual(calls, [images[1].url])
  assert.equal(click('https://example.com/docs'), false)
})

test('canvas navigation resolves a file by URL and loads its position before focusing', async () => {
  const focused = []
  const context = vm.createContext({
    assets: { value: [{ id: 'job:0', url: images[1].url }] },
    positions: { value: new Map() },
    loadLayout: async () => context.positions.value.set('job:0', { x: 320, y: 350 }),
    focusAsset: id => focused.push(id),
  })
  vm.runInContext(componentFunction('../app/components/agent-lab/InfiniteCanvas.vue', 'focusMedia'), context)
  assert.equal(await context.focusMedia(images[1].url), true)
  assert.deepEqual(focused, ['job:0'])
  assert.equal(await context.focusMedia('https://example.com/deleted.mp4'), false)
})

test('confirmation thumbnails follow shot order rather than asset arrival order', () => {
  const assets = ['shot3', 'shot1', 'shot2'].map(id => ({ id, url: `https://example.com/${id}.png` }))
  const message = { content: '', confirmation: { jobs: ['shot1', 'shot2', 'shot3'].map(id => ({ id })) }, imageIds: ['shot3', 'shot2', 'shot1'] }
  assert.deepEqual(messageMedia(message, assets).map(image => image.id), ['shot1', 'shot2', 'shot3'])
  assert.deepEqual(messageMedia({ content: '', imageIds: ['shot2', 'shot1'] }, assets).map(image => image.id), ['shot2', 'shot1'])
})

test('thinking references do not duplicate earlier thumbnails; visible result links still work', () => {
  const message = { content: `<think>Use [source](${images[0].url})</think>Result: [film](${images[1].url})` }
  assert.deepEqual(messageMedia(message, images), [images[1]])
})
