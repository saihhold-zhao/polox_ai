import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
 const module = { exports: {} }
 const code = ts.transpileModule(readFileSync(new URL(`../server/utils/${file}.ts`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(code, { module, exports:module.exports, require:id => id in mocks ? mocks[id] : require(id), File, atob, AbortSignal, setTimeout, clearTimeout, ...globals })
 return module.exports
}
function harness() {
 const db = new DatabaseSync(':memory:')
 const settings = load('serviceSettings', {'./sqlite':{connectDatabase:()=>db}})
 return {db, settings}
}
test('settings are local, omitted passwords preserve saved keys, and public status never exposes secrets', () => {
 const {db,settings:s}=harness()
 const first=s.updateServiceSettings({openRouterKey:'private-openrouter',falKey:'private-fal',openRouterModel:'provider/model'})
 assert.equal(s.readServiceSettings().falKey,'private-fal')
 const next=s.updateServiceSettings({openRouterModel:'provider/new'})
 assert.equal(next.openRouterKey,first.openRouterKey)
 assert.notEqual(next.revision,first.revision)
 assert.equal(s.publicServiceStatus().connected,false)
 assert.ok(!JSON.stringify(s.publicServiceStatus()).includes('private-'))
 db.close()
})
test('green requires both successful tests and resets when settings change', () => {
 const {db,settings:s}=harness()
 const base=s.updateServiceSettings({openRouterKey:'a',falKey:'b'})
 assert.equal(s.publicServiceStatus({...base,openRouterOk:true,falOk:false,checkedAt:new Date().toISOString()}).connected,false)
 assert.equal(s.publicServiceStatus({...base,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()}).connected,true)
 s.writeServiceSettings({...base,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({openRouterModel:'another/model'})
 assert.equal(s.publicServiceStatus().connected,false)
 db.close()
})
test('a real model response and authenticated file upload are both required', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'a',falKey:'b',openRouterModel:'provider/model'})
 let uploads=0
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{createFalClient:()=>({storage:{upload:async()=>{uploads++;return 'https://cdn.fal.media/test.png'}}})}}, {fetch:async(url,init)=>{
  if(url.includes('openrouter')) {assert.equal(JSON.parse(init.body).model,'provider/model');return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}}
  if(url.includes('queue.fal.run'))return {status:404}
  return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,true)
 assert.equal(uploads,1)
 assert.equal(s.publicServiceStatus().connected,true)
 db.close()
})
test('invalid credentials and failed model requests cannot produce green', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'a',falKey:'b'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{createFalClient:()=>({})}}, {fetch:async()=>({ok:false,status:401,json:async()=>({error:{message:'invalid'}})})})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,false)
 assert.equal(result.openRouter.ok,false)
 assert.equal(result.fal.ok,false)
 db.close()
})
test('an old connection test cannot overwrite newer settings', async () => {
 const {db,settings:s}=harness()
 const old=s.updateServiceSettings({openRouterKey:'',falKey:''})
 const newer=s.updateServiceSettings({openRouterModel:'new/model'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {})
 const result=await api.testServiceConnections(old)
 assert.equal(result.superseded,true)
 assert.equal(s.readServiceSettings().revision,newer.revision)
 db.close()
})

test('clearing a saved key deletes it and invalidates connection approval', () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'secret-a',falKey:'secret-b'})
 s.writeServiceSettings({...saved,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({falKey:''})
 assert.equal(s.readServiceSettings().falKey,'')
 assert.equal(s.readServiceSettings().openRouterKey,'secret-a')
 assert.equal(s.publicServiceStatus().connected,false)
 assert.equal(s.publicServiceStatus().falConfigured,false)
 s.updateServiceSettings({openRouterKey:'  '})
 assert.equal(s.readServiceSettings().openRouterKey,'')
 db.close()
})
