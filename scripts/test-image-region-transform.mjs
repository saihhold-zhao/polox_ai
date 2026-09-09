import assert from 'node:assert/strict'
import { test } from 'node:test'
import { transformImageLayerRegion } from '../shared/utils/imageLayerSplitter.ts'

test('moving preserves size and clamps to the image boundary', () => {
  const box = [100, 200, 400, 600]
  assert.deepEqual(transformImageLayerRegion(box, 50, -50), [150, 150, 450, 550])
  assert.deepEqual(transformImageLayerRegion(box, -500, 900), [0, 600, 300, 1000])
  assert.deepEqual(box, [100, 200, 400, 600])
})
test('corner and edge resize preserve the opposite edges', () => {
  const box = [100, 200, 400, 600]
  assert.deepEqual(transformImageLayerRegion(box, 50, 80, 'se'), [100, 200, 450, 680])
  assert.deepEqual(transformImageLayerRegion(box, -50, -80, 'nw'), [50, 120, 400, 600])
  assert.deepEqual(transformImageLayerRegion(box, 50, 80, 'e'), [100, 200, 450, 600])
})
test('resize cannot invert boxes or leave the image', () => {
  const box = [100, 200, 400, 600]
  assert.deepEqual(transformImageLayerRegion(box, 999, 999, 'nw'), [395, 595, 400, 600])
  assert.deepEqual(transformImageLayerRegion(box, 999, 999, 'se'), [100, 200, 1000, 1000])
  assert.deepEqual(transformImageLayerRegion(box, -999, -999, 'se'), [100, 200, 105, 205])
})
