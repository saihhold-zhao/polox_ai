import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CARD_CHROME_HEIGHT, fitMediaRect, clampZoom, inViewport, MAX_ZOOM, MIN_ZOOM, zoomAt } from '../app/utils/infiniteCanvas.ts'

test('zoom keeps the world point under the cursor stationary', () => {
  const camera = { x: -400, y: 900, zoom: 0.7 }
  const cursor = { x: 350, y: 120 }
  for (const scale of [0, 0.12, 1, 3, 100]) {
    const next = zoomAt(camera, cursor, scale)
    assert.ok(Math.abs((cursor.x - camera.x) / camera.zoom - (cursor.x - next.x) / next.zoom) < 1e-8)
    assert.ok(Math.abs((cursor.y - camera.y) / camera.zoom - (cursor.y - next.y) / next.zoom) < 1e-8)
  }
})

test('invalid/extreme zoom never produces an unbounded or zero scale', () => {
  for (const value of [Number.NaN, Infinity, -Infinity, -100, 0, 1e20]) {
    const zoom = clampZoom(value)
    assert.ok(Number.isFinite(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM)
  }
})

test('viewport culls 100,000 offscreen assets and admits partial intersections', () => {
  const camera = { x: 0, y: 0, zoom: 1 }
  assert.ok(inViewport({ x: -270, y: -300 }, camera, 1000, 700))
  assert.equal(inViewport({ x: -1000, y: 0 }, camera, 1000, 700), false)
  let count = 0
  for (let index = 0; index < 100000; index++) {
    if (inViewport({ x: index % 5 * 320, y: Math.floor(index / 5) * 350 }, camera, 1000, 700))
      count++
  }
  assert.ok(count > 0 && count <= 20)
  assert.ok(inViewport({ x: 320, y: 350000 }, { x: 0, y: -350000, zoom: 1 }, 1000, 700))
})

test('all four resize handles preserve aspect ratio and the opposite corner', async () => {
  const { resizeFromCorner } = await import('../app/utils/infiniteCanvas.ts')
  const rect = { x: -30, y: 50, width: 280, height: 310 }
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const next = resizeFromCorner(rect, corner, corner.includes('w') ? -100 : 100, corner.includes('n') ? -100 : 100)
    assert.ok(next.width > rect.width)
    assert.ok(Math.abs((next.width - 2) / (next.height - CARD_CHROME_HEIGHT) - (rect.width - 2) / (rect.height - CARD_CHROME_HEIGHT)) < 1e-10)
    assert.equal(corner.includes('w') ? next.x + next.width : next.x, corner.includes('w') ? rect.x + rect.width : rect.x)
    assert.equal(corner.includes('n') ? next.y + next.height : next.y, corner.includes('n') ? rect.y + rect.height : rect.y)
    const smallest = resizeFromCorner(rect, corner, corner.includes('w') ? 1e6 : -1e6, corner.includes('n') ? 1e6 : -1e6)
    const largest = resizeFromCorner(rect, corner, corner.includes('w') ? -1e6 : 1e6, corner.includes('n') ? -1e6 : 1e6)
    assert.equal(smallest.width, 200)
    assert.equal(largest.width, 1600)
  }
})

test('resized objects are culled by their actual dimensions', () => {
  assert.equal(inViewport({ x: -1000, y: 0, width: 1400, height: 1550 }, { x: 0, y: 0, zoom: 1 }, 1000, 700), true)
})

test('database payload validation bounds batch size, scale, and coordinates', async () => {
  const { canvasPatchSchema } = await import('../shared/types/canvas.ts')
  const node = { id: 'job:0', x: -50, y: 20, width: 280, height: 310 }
  assert.equal(canvasPatchSchema.safeParse({ nodes: [node], camera: { x: 40, y: 50, zoom: 1 }, version: 123 }).success, true)
  for (const invalid of [
    { nodes: Array.from({ length: 101 }, () => node), version: 123 },
    { nodes: [{ ...node, x: Infinity }], version: 123 },
    { nodes: [{ ...node, width: 1e8 }], version: 123 },
    { nodes: [node], camera: { x: 0, y: 0, zoom: 0 }, version: 123 },
    { nodes: [{ ...node, id: '__viewport__' }], version: 123 },
  ]) assert.equal(canvasPatchSchema.safeParse(invalid).success, false)
})


test('media fitting repairs saved cards and preserves landscape, portrait and square ratios', async () => {
  const { canvasRectSchema } = await import('../shared/types/canvas.ts')
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1024, 1024], [2400, 600]]) {
    for (const cardWidth of [200, 280, 800, 1600]) {
      const rect = { x: 50, y: -30, width: cardWidth, height: 310 }
      const fitted = fitMediaRect(rect, width, height)
      assert.equal(fitted.x, rect.x)
      assert.equal(fitted.y, rect.y)
      assert.equal(fitted.width, rect.width)
      assert.ok(Math.abs((fitted.width - 2) / (fitted.height - CARD_CHROME_HEIGHT) - width / height) < 1e-10)
      assert.equal(canvasRectSchema.safeParse(fitted).success, true)
      assert.deepEqual(fitMediaRect(fitted, width, height), fitted)
    }
  }
  const rect = { x: 0, y: 0, width: 280, height: 310 }
  for (const invalid of [0, -1, NaN, Infinity])
    assert.equal(fitMediaRect(rect, invalid, 1080), rect)
})

test('marquee selection supports reverse drags and transformed canvas coordinates', async () => {
  const { intersectsSelection } = await import('../app/utils/infiniteCanvas.ts')
  const rect = { x: 100, y: 200, width: 280, height: 180 }
  const camera = { x: -20, y: 30, zoom: 0.5 }
  assert.equal(intersectsSelection(rect, camera, { x: 20, y: 120, endX: 200, endY: 240 }), true)
  assert.equal(intersectsSelection(rect, camera, { x: 200, y: 240, endX: 20, endY: 120 }), true)
  assert.equal(intersectsSelection(rect, camera, { x: 200, y: 10, endX: 300, endY: 100 }), false)
})

test('creation order is chronological across sources, stable for ties and missing legacy dates', async () => {
  const { byCreationTime } = await import('../app/utils/infiniteCanvas.ts')
  const items = [
    { id: 'new', createdAt: '2026-09-06T12:00:00Z' },
    { id: 'legacy' },
    { id: 'old', createdAt: '2026-09-05T12:00:00Z' },
    { id: 'same', createdAt: '2026-09-05T12:00:00Z' },
    { id: 'invalid', createdAt: 'invalid' },
  ]
  assert.deepEqual(byCreationTime(items).map(item => item.id), ['old', 'same', 'new', 'legacy', 'invalid'])
  assert.equal(items[0].id, 'new')
})

test('new objects avoid moved, resized and newly inserted objects without moving existing ones', async () => {
  const { findFreeRect } = await import('../app/utils/infiniteCanvas.ts')
  const occupied = [
    { x: -100, y: -100, width: 1600, height: 900 },
    { x: 0, y: 900, width: 280, height: 600 },
  ]
  const original = structuredClone(occupied)
  const preferred = { x: 0, y: 350, width: 280, height: 280 }
  for (let i = 0; i < 10; i++) {
    const rect = findFreeRect(preferred, occupied)
    for (const other of occupied) {
      assert.ok(rect.x >= other.x + other.width + 40 || rect.x + rect.width + 40 <= other.x
        || rect.y >= other.y + other.height + 40 || rect.y + rect.height + 40 <= other.y)
    }
    occupied.push(rect)
  }
  assert.deepEqual(occupied.slice(0, 2), original)
  const empty = { x: 2000, y: -500, width: 280, height: 280 }
  assert.deepEqual(findFreeRect(empty, occupied), empty)
})

test('canvas places new generations after older ones regardless of names and shot numbers', async () => {
  const { byCanvasOrder } = await import('../app/utils/infiniteCanvas.ts')
  const items = [
    { id: '10', name: '镜头10 · 结尾', createdAt: '2026-09-05T00:00:00Z' },
    { id: '2', name: '镜头2 · 放下筷子', createdAt: '2026-09-06T00:00:00Z' },
    { id: 'char', name: '角色设计 · 爸爸', createdAt: '2026-09-08T00:00:00Z' },
    { id: '1', name: '镜头1 · 挑食', createdAt: '2026-09-07T00:00:00Z' },
    { id: 'other', name: '风景参考', createdAt: '2026-09-09T00:00:00Z' },
    { id: '3', name: 'shot_3 · Walking', createdAt: '2026-09-10T00:00:00Z' },
  ]
  const expected = ['10', '2', '1', 'char', 'other', '3']
  assert.deepEqual(byCanvasOrder(items).map(item => item.id), expected)
  assert.deepEqual(byCanvasOrder([...items].reverse()).map(item => item.id), expected)
  assert.equal(items[0].id, '10')
})

test('legacy retries appear to the right without sorting random IDs, and dated result order stays stable', async () => {
  const { byCanvasOrder } = await import('../app/utils/infiniteCanvas.ts')
  const original = { id: 'z-original', name: '角色三视图 · 科技讲解员' }
  const retry = { id: 'a-retry', name: '角色三视图 · 科技讲解员_1' }
  const results = [0, 1, 2].map(index => ({ id: `job:${index}`, name: `Layer ${index}`, createdAt: '2026-09-10T00:00:00Z' }))
  assert.deepEqual(byCanvasOrder([retry, original]).map(item => item.id), ['z-original', 'a-retry'])
  assert.deepEqual(byCanvasOrder([...results, retry, original]).map(item => item.id), ['z-original', 'a-retry', 'job:0', 'job:1', 'job:2'])
})

test('only untouched default grids qualify for automatic order repair', async () => {
  const { isDefaultCanvasGrid } = await import('../app/utils/infiniteCanvas.ts')
  const rects = Array.from({ length: 11 }, (_, i) => ({ x: i % 5 * 320, y: Math.floor(i / 5) * 350, width: 280, height: i < 7 ? 158 : 280 }))
  assert.equal(isDefaultCanvasGrid(rects), true)
  assert.equal(isDefaultCanvasGrid([...rects].reverse()), true)
  for (const change of [{ x: 25 }, { width: 400 }, { height: 500 }, { y: -350 }])
    assert.equal(isDefaultCanvasGrid([{ ...rects[0], ...change }, ...rects.slice(1)]), false)
  assert.equal(isDefaultCanvasGrid(rects.slice(1)), false)
  assert.equal(isDefaultCanvasGrid([rects[0], rects[0]]), false)
})

test('reconcile appends new groups below saved cards without reordering existing layouts', async () => {
  const { readFileSync } = await import('node:fs')
  const vm = await import('node:vm')
  const { default: ts } = await import('typescript')
  const { parse } = await import('vue/compiler-sfc')
  const utils = await import('../app/utils/infiniteCanvas.ts')
  const file = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
  const source = ts.createSourceFile('canvas.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reconcile')
  const saved = []
  const state = {
    ...utils, ready: { value: true }, assets: { value: [{ id: 'shot1' }, { id: 'shot2' }] },
    positions: { value: new Map([
      ['shot2', { x: 0, y: 0, width: 280, height: 158 }],
      ['shot1', { x: 320, y: 0, width: 280, height: 158 }],
    ]) }, nextSlot: { value: 2 }, urlPositions: new Map(),
    markNode: id => saved.push(id), markView: () => {},
  }
  vm.createContext(state)
  vm.runInContext(ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 }), state)
  state.reconcile()
  assert.equal(state.positions.value.get('shot1').x, 320)
  assert.equal(state.positions.value.get('shot2').x, 0)
  assert.deepEqual(saved, [])
  // Reproduce new items sorting ahead of existing, undated cards.
  const previous = structuredClone(state.positions.value)
  const newcomers = Array.from({ length: 6 }, (_, index) => ({ id: `new${index}` }))
  state.assets.value.unshift(...newcomers)
  state.reconcile()
  for (const [id, rect] of previous)
    assert.deepEqual(state.positions.value.get(id), rect)
  for (const [index, asset] of newcomers.entries()) {
    const rect = state.positions.value.get(asset.id)
    assert.equal(rect.x, index % 5 * 320)
    assert.equal(rect.y, 350 + Math.floor(index / 5) * 350)
  }
  const appended = structuredClone(state.positions.value)
  state.assets.value.reverse()
  state.reconcile()
  assert.deepEqual(structuredClone(state.positions.value), appended)
  // Even moved/tall cards and a stale slot counter must be respected.
  state.positions.value.get('shot1').x = 123
  state.positions.value.get('shot1').height = 1500
  state.nextSlot.value = 0
  state.assets.value.unshift({ id: 'retry' })
  state.reconcile()
  assert.equal(state.positions.value.get('shot1').x, 123)
  assert.ok(state.positions.value.get('retry').y >= 1570)
  // A reload can still contain the old name-sorted grid: image/video pairs.
  const chronological = [
    { id: 'image1', createdAt: '2026-09-07T01:00:00Z' },
    { id: 'image2', createdAt: '2026-09-07T01:01:00Z' },
    { id: 'video1', createdAt: '2026-09-07T02:00:00Z' },
    { id: 'video2', createdAt: '2026-09-07T02:01:00Z' },
  ]
  state.assets.value = chronological
  state.positions.value = new Map(['image1', 'video1', 'image2', 'video2'].map((id, index) => [id, { x: index * 320, y: 0, width: 280, height: 280 }]))
  state.nextSlot.value = 4
  state.reconcile()
  chronological.forEach((asset, index) => assert.equal(state.positions.value.get(asset.id).x, index * 320))
  const repaired = structuredClone(state.positions.value)
  state.reconcile()
  assert.deepEqual(structuredClone(state.positions.value), repaired)
})

test('find latest follows successful completion time independently of shot and submission order', async () => {
  const { latestCanvasAsset, byCanvasOrder } = await import('../app/utils/infiniteCanvas.ts')
  const items = [
    { id: 'character', name: '角色设计 · 爸爸', state: 'success', url: '/character.png', createdAt: '2026-09-06T10:00:00Z', completedAt: '2026-09-06T10:01:00Z' },
    { id: 'shot10', name: '镜头10', state: 'success', url: '/10.png', createdAt: '2026-09-06T10:03:00Z', completedAt: '2026-09-06T10:04:00Z' },
    { id: 'shot2', name: '镜头2', state: 'success', url: '/2.png', createdAt: '2026-09-06T10:02:00Z', completedAt: '2026-09-06T10:05:00Z' },
    { id: 'failed', name: '镜头11', state: 'fail', url: '', completedAt: '2026-09-06T10:06:00Z' },
    { id: 'pending', name: '镜头12', state: 'generating', url: '', createdAt: '2026-09-06T10:07:00Z' },
  ]
  assert.equal(latestCanvasAsset(items).id, 'shot2')
  assert.equal(latestCanvasAsset(byCanvasOrder(items)).id, 'shot2')
  assert.equal(latestCanvasAsset([...items].reverse()).id, 'shot2')
})

test('find latest handles pending tasks, empty canvas and missing legacy timestamps', async () => {
  const { latestCanvasAsset } = await import('../app/utils/infiniteCanvas.ts')
  assert.equal(latestCanvasAsset([]), undefined)
  const pending = [
    { id: 'old', state: 'generating', url: '', createdAt: '2026-09-06T10:00:00Z' },
    { id: 'new', state: 'generating', url: '', createdAt: '2026-09-06T10:01:00Z', completedAt: 'invalid' },
  ]
  assert.equal(latestCanvasAsset(pending).id, 'new')
  const legacy = [
    { id: 'recent', state: 'success', url: '/recent.png' },
    { id: 'older', state: 'success', url: '/older.png' },
  ]
  assert.equal(latestCanvasAsset(legacy).id, 'recent')
})

test('drag snapping aligns edges on both axes and spans the aligned cards', async () => {
  const { snapCanvasRect } = await import('../app/utils/infiniteCanvas.ts')
  const target = { x: 100, y: 200, width: 280, height: 280 }
  const result = snapCanvasRect({ x: 104, y: 483, width: 280, height: 280 }, [target], 1)
  assert.equal(result.rect.x, 100)
  assert.equal(result.rect.y, 480)
  assert.deepEqual(result.guides, [
    { axis: 'x', position: 100, start: 200, end: 763 },
    { axis: 'y', position: 480, start: 100, end: 384 },
  ])
})

test('drag snapping aligns centers of differently sized cards and chooses the closest anchor', async () => {
  const { snapCanvasRect } = await import('../app/utils/infiniteCanvas.ts')
  const rect = { x: 142, y: 800, width: 200, height: 200 }
  const targets = [
    { x: 145, y: 0, width: 400, height: 200 },
    { x: 100, y: 300, width: 280, height: 280 },
  ]
  const result = snapCanvasRect(rect, targets, 1)
  assert.equal(result.rect.x, 140)
  assert.equal(result.rect.y, 800)
  assert.equal(result.guides[0].position, 240)
})

test('drag snap range remains six screen pixels across zoom levels and releases beyond it', async () => {
  const { snapCanvasRect } = await import('../app/utils/infiniteCanvas.ts')
  const target = { x: 0, y: 0, width: 280, height: 280 }
  for (const zoom of [0.12, 0.25, 1, 3]) {
    const rect = { x: 5 / zoom, y: 1000, width: 280, height: 280 }
    assert.ok(Math.abs(snapCanvasRect(rect, [target], zoom).rect.x) < 1e-8)
    const outside = { ...rect, x: 7 / zoom }
    assert.deepEqual(snapCanvasRect(outside, [target], zoom), { rect: outside, guides: [] })
  }
  const rect = { x: 15, y: 25, width: 280, height: 280 }
  assert.deepEqual(snapCanvasRect(rect, [], 1), { rect, guides: [] })
})
