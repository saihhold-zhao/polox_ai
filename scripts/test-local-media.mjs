import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'
import { configureMediaBase, isStoredMediaUrl, mediaRoot, readStoredMedia, saveMediaFile, storedMediaFile } from '../server/utils/localMedia.ts'

const cwd = process.cwd()
const dir = await mkdtemp(join(tmpdir(), 'polox-media-'))
process.chdir(dir)
configureMediaBase('http://localhost:3001')
after(async () => {
  process.chdir(cwd)
  configureMediaBase('http://localhost:3001')
  await rm(dir, { recursive: true, force: true })
})

test('local writes preserve exact bytes and support unicode URL round trips', async () => {
  const bytes = new Uint8Array([0, 1, 2, 255])
  const url = await saveMediaFile('generator/local/图片.png', bytes, 'image/png')
  assert.equal(url, 'http://localhost:3001/media/generator/local/%E5%9B%BE%E7%89%87.png')
  assert.equal(isStoredMediaUrl(url), true)
  assert.deepEqual(await readFile(join(mediaRoot(), 'generator/local/图片.png')), Buffer.from(bytes))
  assert.deepEqual(await readStoredMedia(url, 10), { bytes: Buffer.from(bytes), mime: 'image/png' })
  await assert.rejects(readStoredMedia(url, 2), /size limit/)
  await assert.rejects(readStoredMedia(url, 10, AbortSignal.abort()))
})

test('files survive replacement and custom application URLs without cloud credentials', async () => {
  configureMediaBase('https://studio.example.com')
  const key = 'generator/local/result.mp4'
  await saveMediaFile(key, new Uint8Array([1]), 'video/mp4')
  const url = await saveMediaFile(key, new Uint8Array([2, 3]), 'video/mp4')
  assert.equal(url, 'https://studio.example.com/media/generator/local/result.mp4')
  assert.deepEqual((await readStoredMedia(url, 10)).bytes, Buffer.from([2, 3]))
  assert.equal((await storedMediaFile(key)).mime, 'video/mp4')
  configureMediaBase('http://localhost:3001')
})

test('path traversal, symlink escapes and unrelated URLs cannot access local files', async () => {
  for (const key of ['../secret', '/tmp/secret', 'a/../../secret', 'a\\secret', 'a/./b', '.env']) {
    await assert.rejects(saveMediaFile(key, new Uint8Array([1]), 'image/png'), /Invalid media path/)
    await assert.rejects(storedMediaFile(key))
  }
  await writeFile(join(dir, 'secret'), 'private')
  await symlink(join(dir, 'secret'), join(mediaRoot(), 'escape.png'))
  await assert.rejects(storedMediaFile('escape.png'), /Invalid media path/)
  for (const url of ['http://localhost:3001/media/../secret', 'http://localhost:3001/media/%2e%2e/secret', 'http://localhost:3001.evil/media/x', 'file:///etc/passwd']) {
    assert.equal(isStoredMediaUrl(url), false)
    assert.equal(await readStoredMedia(url, 100), null)
  }
  assert.equal(await readStoredMedia('https://provider.example.com/result.png', 100), null)
})
