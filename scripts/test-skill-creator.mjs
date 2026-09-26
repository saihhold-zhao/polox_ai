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
    globalThis,
  }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}

const skills = load(resolve(root, 'server/agent/skills.ts'))
const { systemPrompt } = load(resolve(root, 'server/agent/prompt.ts'))

test('assembled system prompt keeps core full skills and specialty catalog only', () => {
  const prompt = systemPrompt('always')
  assert.match(prompt, /# Prompt rewrite/)
  // long-form-video is on demand now: catalog line + load rule, body only after load_skill.
  assert.doesNotMatch(prompt, /# Narrative storyboard video|# Long-form video/)
  assert.match(prompt, /- \/long-form-video — /)
  assert.match(prompt, /load_skill\(\{ id: "long-form-video" \}\) first/)
  assert.match(prompt, /image-layer-splitter/)
  assert.match(prompt, /skill-creator/)
  const beforeCatalog = prompt.split(/### Skill catalog/)[0]
  assert.doesNotMatch(beforeCatalog, /Resolve image first/)
  // Specialty bodies with locale examples must not be dumped into the core block.
  assert.doesNotMatch(beforeCatalog, /对象移除/)
})

test('loading a specialty skill injects its full body', () => {
  const prompt = skills.skillsPromptBlock({ loadedSkillIds: ['image-layer-splitter'] })
  assert.match(prompt, /# Image Layer Splitter/)
  assert.match(prompt, /Resolve image first/)
})

test('slash parser extracts skill ids', () => {
  const ids = skills.parseSkillSlashIds('please /image-layer-splitter and /skill-creator now')
  assert.equal(JSON.stringify(ids), JSON.stringify(['image-layer-splitter', 'skill-creator']))
})

test('builtin id protection helpers', () => {
  assert.equal(skills.isBuiltinSkillId('image-layer-splitter'), true)
  assert.equal(skills.isBuiltinSkillId('skill-creator'), true)
  assert.equal(skills.isBuiltinSkillId('brand-thumbnails'), false)
  assert.equal(skills.isValidSkillId('brand-thumbnails'), true)
  assert.equal(skills.isValidSkillId('Bad_ID'), false)
})

test('parseSkillMarkdown reads frontmatter safety caps', () => {
  const doc = skills.parseSkillMarkdown(`---
id: brand-thumbnails
name: Brand thumbnails
description: Make three on-brand thumbnails.
version: 1.0.0
source: user
visibility: catalog
triggers:
  - /brand-thumbnails
requires:
  - ask_user
  - generate_image
safety:
  maxGenerationsPerRun: 3
  allowSpend: true
---
# Brand thumbnails
Body here.
`, 'brand-thumbnails', 'user')
  assert.equal(doc.frontmatter.id, 'brand-thumbnails')
  assert.equal(doc.frontmatter.safety.maxGenerationsPerRun, 3)
  assert.equal(doc.frontmatter.safety.allowSpend, true)
  assert.equal(doc.frontmatter.requires.join(','), 'ask_user,generate_image')
})
