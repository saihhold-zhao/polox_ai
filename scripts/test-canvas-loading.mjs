import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {test} from 'node:test'
import ts from 'typescript'
import {parse} from 'vue/compiler-sfc'
const file = readFileSync(new URL('../app/pages/projects/[id].vue', import.meta.url), 'utf8')
const source = ts.createSourceFile('page.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'loadJobs')
const code = ts.transpile(fn.getText(source), {target: ts.ScriptTarget.ES2022})
test('canvas loads beyond the first page and retains older results during refresh', async () => {
 const calls = []
 const jobs = Array.from({length: 103}, (_, i) => ({taskId: String(i), projectId: 'project'}))
 const state = {jobsInFlight: false, projectId:{value:'project'}, jobsController:undefined, loadToken:0, items:{value:[]}, total:{value:0}, loading:{value:false}, AbortController, PAGE_SIZE:50, jobBelongsToCurrentProject:job=>job.projectId==='project', toast:{error:message=>{throw new Error(message)}}, $fetch: async (_, options)=> {calls.push(options.query.page); return {items:jobs.slice((options.query.page-1)*50, options.query.page*50), total:jobs.length}}}
 vm.createContext(state)
 vm.runInContext(code, state)
 await state.loadJobs()
 assert.deepEqual(calls,[1,2,3])
 assert.equal(state.items.value.length,103)
 assert.equal(new Set(state.items.value.map(j=>j.taskId)).size,103)
 await state.loadJobs(true)
 assert.equal(state.items.value.length,103)
 assert.equal(state.loading.value,false)
 assert.ok(!file.includes('<Pagination'))
})
