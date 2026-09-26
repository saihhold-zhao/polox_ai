import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { mergeAgentSkillCatalog, PUBLIC_AGENT_SKILLS } from '../shared/utils/agentSkills.ts'
import {
  BUILTIN_SKILL_CATEGORIES,
  builtinSkillCategory,
  countSkillsByCategory,
  filterSkillsByCategory,
  normalizeSkillCategory,
  parseSkillCategoryFilter,
  parseSkillCategoryInput,
  SKILL_CATEGORIES,
} from '../shared/utils/skillCategory.ts'

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

test('normalizeSkillCategory defaults missing/unknown to utility', () => {
  assert.equal(normalizeSkillCategory(undefined), 'utility')
  assert.equal(normalizeSkillCategory(null), 'utility')
  assert.equal(normalizeSkillCategory(''), 'utility')
  assert.equal(normalizeSkillCategory('weird'), 'utility')
  assert.equal(normalizeSkillCategory(3), 'utility')
  assert.equal(normalizeSkillCategory('utility'), 'utility')
  assert.equal(normalizeSkillCategory(' FUN '), 'fun')
  assert.equal(normalizeSkillCategory('entertainment'), 'fun')
})

test('parseSkillCategoryInput validates the enum strictly', () => {
  assert.equal(parseSkillCategoryInput(undefined), undefined)
  assert.equal(parseSkillCategoryInput(''), undefined)
  assert.equal(parseSkillCategoryInput('fun'), 'fun')
  assert.equal(parseSkillCategoryInput('Utility'), 'utility')
  assert.equal(parseSkillCategoryInput('games'), null)
  assert.equal(parseSkillCategoryInput(1), null)
  assert.equal(parseSkillCategoryFilter('all'), undefined)
  assert.equal(parseSkillCategoryFilter(['fun']), 'fun')
  assert.equal(parseSkillCategoryFilter('nope'), undefined)
})

test('filter and count treat legacy rows without category as utility', () => {
  const rows = [{ id: 'a' }, { id: 'b', category: 'fun' }, { id: 'c', category: 'utility' }]
  assert.deepEqual(filterSkillsByCategory(rows, 'utility').map(r => r.id), ['a', 'c'])
  assert.deepEqual(filterSkillsByCategory(rows, 'fun').map(r => r.id), ['b'])
  assert.equal(filterSkillsByCategory(rows, 'all').length, 3)
  assert.deepEqual(countSkillsByCategory(rows), { all: 3, utility: 2, fun: 1 })
})

test('every public builtin skill has a valid category matching the builtin map', () => {
  for (const skill of PUBLIC_AGENT_SKILLS) {
    assert.ok(SKILL_CATEGORIES.includes(skill.category), `${skill.id} category`)
    assert.equal(skill.category, builtinSkillCategory(skill.id), `${skill.id} matches BUILTIN_SKILL_CATEGORIES`)
  }
  assert.equal(BUILTIN_SKILL_CATEGORIES['image-layer-splitter'], 'utility')
  // All existing builtins are utility: filtering by fun returns none of them.
  assert.equal(filterSkillsByCategory(PUBLIC_AGENT_SKILLS, 'fun').length, 0)
  assert.equal(filterSkillsByCategory(PUBLIC_AGENT_SKILLS, 'utility').length, PUBLIC_AGENT_SKILLS.length)
  assert.ok(Object.values(BUILTIN_SKILL_CATEGORIES).every(category => category === 'utility'))
  assert.equal(builtinSkillCategory('unknown-builtin'), 'utility')
})

test('merged catalog normalizes user skill categories', () => {
  const merged = mergeAgentSkillCatalog([
    { id: 'legacy-skill', name: 'Legacy', description: 'x' },
    { id: 'party-skill', name: 'Party', description: 'y', category: 'fun' },
  ])
  assert.equal(merged.find(s => s.id === 'legacy-skill').category, 'utility')
  assert.equal(merged.find(s => s.id === 'party-skill').category, 'fun')
})

test('parseSkillMarkdown reads optional frontmatter category and builtin defaults', () => {
  const skills = load(resolve(root, 'server/agent/skills.ts'))
  const md = category => `---
id: brand-thumbnails
name: Brand thumbnails
description: Make thumbnails.
${category ? `category: ${category}\n` : ''}triggers:
  - /brand-thumbnails
---
# Brand thumbnails
`
  assert.equal(skills.parseSkillMarkdown(md('fun'), 'brand-thumbnails', 'user').frontmatter.category, 'fun')
  assert.equal(skills.parseSkillMarkdown(md('bogus'), 'brand-thumbnails', 'user').frontmatter.category, 'utility')
  assert.equal(skills.parseSkillMarkdown(md(''), 'brand-thumbnails', 'user').frontmatter.category, undefined)
  assert.equal(skills.loadBuiltinSkill('talking-avatar').frontmatter.category, 'utility')
  assert.equal(skills.loadBuiltinSkill('long-form-video').frontmatter.category, 'utility')
  assert.equal(skills.loadBuiltinSkill('image-layer-splitter').frontmatter.category, 'utility')
})

test('skill creator prompt asks the category before the final exit', () => {
  const prompt = readFileSync(resolve(root, 'server/agent/skills/skill-creator.md'), 'utf8')
  const categoryAt = prompt.indexOf('question id `skill_category`')
  const exitAt = prompt.indexOf('### 11. Exit')
  assert.ok(categoryAt > 0 && exitAt > categoryAt)
  assert.match(prompt, /`save_user_skill` with `enabled: true`[^\n]*`category` from step 10/)
  const step = prompt.slice(prompt.indexOf('### 10. Category'), exitAt)
  assert.match(step, /First judge the category yourself/)
  assert.match(step, /`recommended` field/)
  assert.match(step, /\(Recommended\)/)
  assert.match(step, /one-line reason/)
  assert.match(step, /Save the user's choice/)
})

test('local SQLite storage: category column is migrated and API routes accept it', () => {
  const sqlite = readFileSync(resolve(root, 'server/utils/sqlite.ts'), 'utf8')
  assert.match(sqlite, /function migrateSkillCategory/)
  assert.match(sqlite, /PRAGMA user_version = 3/)
  const userSkills = readFileSync(resolve(root, 'server/utils/userSkills.ts'), 'utf8')
  assert.match(userSkills, /export function skillCategoryQuery/)
  assert.match(userSkills, /export async function setUserSkillCategory/)
  assert.doesNotMatch(userSkills, /mongo|ownerUserId/i)
  const patch = readFileSync(resolve(root, 'server/api/skills/[id].patch.ts'), 'utf8')
  assert.match(patch, /Category-only update/)
  const home = readFileSync(resolve(root, 'app/components/home/Skills.vue'), 'utf8')
  assert.match(home, /SkillCategoryTabs/)
  assert.doesNotMatch(home, /official|community/i, 'OSS homepage keeps one unified list')
})
