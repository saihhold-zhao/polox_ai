import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const file = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')
const source = ts.createSourceFile('chat.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
function assets(props, query = '') {
  const state = { props, mention: { value: { query } }, computed: fn => ({ get value() { return fn() } }), isMediaVideoUrl: url => url.endsWith('.mp4') }
  vm.createContext(state)
  for (const name of ['projectAssets', 'assetMatches']) {
    const statement = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name))
    assert.ok(statement)
    vm.runInContext(ts.transpile(`${statement.getText(source)}\nglobalThis.${name} = ${name}`, { target: ts.ScriptTarget.ES2022 }), state)
  }
  return state.assetMatches.value
}

test('mentions include project jobs from other chats, every layer, videos, and uploads without duplicate URLs', () => {
  const props = {
    projectJobs: [
      { taskId: 'split', resultUrls: ['bg.png', 'duck.png'], layers: [{ name: 'Background' }, { name: 'Duck' }], input: {}, category: 'Image' },
      { taskId: 'other-chat', resultUrls: ['clip.mp4'], input: { asset_name: 'Duck video' }, category: 'Video' },
    ],
    images: [{ id: 'duplicate', url: 'duck.png', name: 'Duplicate' }, { id: 'upload', url: 'upload.png', name: 'Reference' }],
  }
  const results = assets(props)
  assert.equal(results.length, 4)
  assert.equal(results[1].name, 'Duck')
  assert.equal(results[2].video, true)
  assert.equal(assets(props, 'duck').length, 2)
  assert.equal(assets(props, 'missing').length, 0)
})

test('switching to an empty project leaves no prior project assets', () => {
  assert.equal(assets({ projectJobs: [], images: [] }).length, 0)
})

function homeLoader(fetch) {
  const file = readFileSync(new URL('../app/components/home/HomeAgentComposer.vue', import.meta.url), 'utf8')
  const source = ts.createSourceFile('home.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadProjectAssets')
  const state = {
    AbortController,
    selectedProjectId: { value: 'default-project' },
    projectJobs: { value: [] },
    projectAssetsLoading: { value: false },
    projectAssetsError: { value: '' },
    projectJobsController: undefined,
    $fetch: fetch,
  }
  vm.createContext(state)
  vm.runInContext(ts.transpile(fn.getText(source).replace('import.meta.client', 'true'), { target: ts.ScriptTarget.ES2022 }), state)
  return state
}

test('homepage loads every page scoped to the selected project', async () => {
  const calls = []
  const state = homeLoader(async (_url, options) => {
    calls.push(options.query)
    const count = options.query.page === 1 ? 50 : 1
    return { items: Array.from({ length: count }, (_, i) => ({ taskId: `${options.query.page}-${i}` })), total: 51 }
  })
  await state.loadProjectAssets()
  assert.equal(state.projectJobs.value.length, 51)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(query => query.projectId === 'default-project'))
  assert.equal(state.projectAssetsLoading.value, false)
})

test('homepage ignores an old project response after switching projects', async () => {
  let respond
  const state = homeLoader(() => new Promise(resolve => { respond = resolve }))
  const pending = state.loadProjectAssets()
  state.selectedProjectId.value = 'new-project'
  respond({ items: [{ taskId: 'old-project-job' }], total: 1 })
  await pending
  assert.equal(state.projectJobs.value.length, 0)
})

test('homepage shows load failure and can retry', async () => {
  let fail = true
  const state = homeLoader(async () => {
    if (fail)
      throw new Error('offline')
    return { items: [{ taskId: 'recovered' }], total: 1 }
  })
  await state.loadProjectAssets()
  assert.match(state.projectAssetsError.value, /Could not load/)
  fail = false
  await state.loadProjectAssets()
  assert.equal(state.projectAssetsError.value, '')
  assert.equal(state.projectJobs.value.length, 1)
})
