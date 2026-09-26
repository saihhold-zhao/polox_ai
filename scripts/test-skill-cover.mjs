import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { canUseAsSkillCover, parseSkillCoverInput } from '../shared/utils/skillCover.ts'

const root = resolve(import.meta.dirname, '..')

test('generated HTTPS image URLs are accepted as skill covers', () => {
  const r2 = parseSkillCoverInput(' https://cdn.polox.ai/agent/abc/output.png ')
  assert.deepEqual(r2, { ok: true, cover: 'https://cdn.polox.ai/agent/abc/output.png' })
  assert.equal(parseSkillCoverInput('https://v3.fal.media/files/x/y.webp?sig=1').ok, true)
  assert.equal(parseSkillCoverInput('https://tempfile.aiquickdraw.com/abc').ok, true)
  assert.equal(parseSkillCoverInput('http://localhost:3000/uploads/a.jpg').ok, true)
})

test('local OSS media served over http is accepted', () => {
  assert.equal(parseSkillCoverInput('http://localhost:3001/media/agent-lab/s/a.png').ok, true)
  assert.equal(parseSkillCoverInput('http://127.0.0.1:3001/media/a.webp').ok, true)
  assert.equal(parseSkillCoverInput('http://192.168.1.20:3001/media/a.webp').ok, true)
  assert.equal(parseSkillCoverInput('http://polox.local:3001/x/a.webp').ok, true)
  assert.equal(parseSkillCoverInput('http://my-box.example:3001/media/generator/a.png').ok, true)
})

test('empty or null clears the cover', () => {
  assert.deepEqual(parseSkillCoverInput(''), { ok: true, cover: '' })
  assert.deepEqual(parseSkillCoverInput(null), { ok: true, cover: '' })
})

test('non-https, non-image, and malformed covers are rejected', () => {
  assert.equal(parseSkillCoverInput('http://evil.example/a.png').ok, false)
  assert.equal(parseSkillCoverInput('javascript:alert(1)').ok, false)
  assert.equal(parseSkillCoverInput('data:image/png;base64,AAAA').ok, false)
  assert.equal(parseSkillCoverInput('/relative.png').ok, false)
  assert.equal(parseSkillCoverInput('https://cdn.polox.ai/a/clip.mp4').ok, false)
  assert.equal(parseSkillCoverInput('https://cdn.polox.ai/a/voice.mp3?x=1').ok, false)
  assert.equal(parseSkillCoverInput(42).ok, false)
  assert.equal(parseSkillCoverInput(`https://a.b/${'x'.repeat(3000)}.png`).ok, false)
})

test('canvas only offers cover for finished still images', () => {
  const base = { url: 'https://cdn.polox.ai/a.png', state: 'success' }
  assert.equal(canUseAsSkillCover(base), true)
  assert.equal(canUseAsSkillCover({ ...base, state: 'generating' }), false)
  assert.equal(canUseAsSkillCover({ ...base, video: true }), false)
  assert.equal(canUseAsSkillCover({ ...base, audio: true }), false)
  assert.equal(canUseAsSkillCover({ ...base, document: true }), false)
  assert.equal(canUseAsSkillCover({ ...base, url: '' }), false)
})

test('PATCH /api/skills/:id supports cover-only updates without markdown', () => {
  const source = readFileSync(resolve(root, 'server/api/skills/[id].patch.ts'), 'utf8')
  assert.match(source, /parseSkillCoverInput/)
  assert.match(source, /Cover-only update/)
})

test('skill Test canvas exposes Use as skill cover', () => {
  const canvas = readFileSync(resolve(root, 'app/components/agent-lab/InfiniteCanvas.vue'), 'utf8')
  assert.match(canvas, /Use as skill cover/)
  assert.match(canvas, /setCover/)
  const page = readFileSync(resolve(root, 'app/pages/projects/[id].vue'), 'utf8')
  assert.match(page, /:show-set-cover="skillTestMode && Boolean\(boundSkillId\)"/)
  assert.match(page, /@set-cover="onSetSkillCover"/)
})
