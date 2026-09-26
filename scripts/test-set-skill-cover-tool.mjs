import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const cache = new Map()

function load(file) {
  if (cache.has(file))
    return cache.get(file)
  const module = { exports: {} }
  const source = readFileSync(file, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href))
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id.startsWith('.') || id.startsWith('~~/')) {
        const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
        return load(`${target}.ts`)
      }
      return require(id)
    },
    console,
    process,
    Buffer,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    globalThis,
  }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}

const { resolveSkillCoverUrl } = load(resolve(root, 'server/agent/skillCoverTool.ts'))
const LOCAL = 'http://localhost:3001/media/'
const isLocalMediaUrl = url => url.startsWith(LOCAL)
const images = [
  { id: 'a', status: 'success', kind: 'image', url: 'https://tempfile.fal.media/x/cover.png', prompt: '', aspectRatio: '', resolution: '', error: '' },
  { id: 'v', status: 'success', kind: 'video', url: 'https://tempfile.fal.media/x/clip.png', prompt: '', aspectRatio: '', resolution: '', error: '' },
]

function deps(overrides = {}) {
  const calls = { upload: 0, fetch: 0 }
  return {
    calls,
    value: {
      isLocalMediaUrl,
      saveImage: async () => { calls.upload++; return `${LOCAL}agent-lab/s/copy.png` },
      fetchImpl: async () => {
        calls.fetch++
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
      },
      ...overrides,
    },
  }
}

test('local media cover URLs are saved as-is without fetching', async () => {
  const d = deps()
  const result = await resolveSkillCoverUrl(`${LOCAL}covers/a.webp`, images, d.value)
  assert.deepEqual({ ...result }, { ok: true, cover: `${LOCAL}covers/a.webp`, mirrored: false })
  assert.equal(d.calls.fetch, 0)
})

test('temporary provider URLs from this session are copied to local storage first', async () => {
  const d = deps()
  const result = await resolveSkillCoverUrl('https://tempfile.fal.media/x/cover.png', images, d.value)
  assert.equal(result.ok, true)
  assert.equal(result.mirrored, true)
  assert.equal(result.cover, `${LOCAL}agent-lab/s/copy.png`)
  assert.equal(d.calls.upload, 1)
})

test('refuses foreign URLs, videos, invalid input, and non-image downloads', async () => {
  const d = deps()
  assert.equal((await resolveSkillCoverUrl('https://evil.example.com/a.png', images, d.value)).ok, false)
  assert.equal((await resolveSkillCoverUrl('https://tempfile.fal.media/x/clip.png', images, d.value)).ok, false)
  assert.equal((await resolveSkillCoverUrl('', images, d.value)).ok, false)
  assert.equal((await resolveSkillCoverUrl('http://example.com/a.png', images, d.value)).ok, false)
  assert.equal(d.calls.fetch, 0, 'no server-side fetch for refused URLs')
  const html = deps({ fetchImpl: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
  const bad = await resolveSkillCoverUrl('https://tempfile.fal.media/x/cover.png', images, html.value)
  assert.equal(bad.ok, false)
  assert.equal(html.calls.upload, 0)
})

test('wiring: set_skill_cover is a free tool bound to the project skill', () => {
  const loop = readFileSync(resolve(root, 'server/agent/loop.ts'), 'utf8')
  const tools = readFileSync(resolve(root, 'server/agent/tools.ts'), 'utf8')
  assert.match(tools, /name: SET_SKILL_COVER_TOOL/)
  assert.match(loop, /'exit_skill_creator' \| 'set_skill_cover' \}>/)
  const block = loop.slice(loop.indexOf('const coverSets'), loop.indexOf('const skillExits'))
  assert.match(block, /getUserSkillByProjectId\(projectId\)/)
  assert.match(block, /setUserSkillCover\(row\.skillId, resolved\.cover\)/)
  assert.doesNotMatch(block, /isR2PublicUrl|ownerUserId/)
  assert.doesNotMatch(block, /skill-creator'\)/, 'does not require /skill-creator')
})
