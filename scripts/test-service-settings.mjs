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
 vm.runInNewContext(code, { module, exports:module.exports, require:id => id in mocks ? mocks[id] : require(id), File, URL, atob, AbortSignal, setTimeout, clearTimeout, ...globals })
 return module.exports
}
// llm.ts budgets images via llmImageBudget (pure) and llmImageCopies (sharp + upload); the copy step is stubbed here.
function llmMocks(extra) {
 const budget=load('../agent/llmImageBudget')
 return {'./llmImageBudget':budget,'./llmImageCopies':{budgetLlmImages:async(messages,options=budget.LLM_IMAGE_BUDGET)=>budget.applyLlmImageBudget(messages,options)},...extra}
}
function harness() {
 const db = new DatabaseSync(':memory:')
 const settings = load('serviceSettings', {'./sqlite':{connectDatabase:()=>db}})
 return {db, settings}
}
test('settings are local, omitted passwords preserve saved keys, and public status never exposes secrets', () => {
 const {db,settings:s}=harness()
 const first=s.updateServiceSettings({wavespeedKey:'private-openrouter',llmModel:'provider/model'})
 assert.equal(s.readServiceSettings().wavespeedKey,'private-openrouter')
 const next=s.updateServiceSettings({llmModel:'provider/new'})
 assert.equal(next.wavespeedKey,first.wavespeedKey)
 assert.notEqual(next.revision,first.revision)
 assert.equal(s.publicServiceStatus().connected,false)
 assert.ok(!JSON.stringify(s.publicServiceStatus()).includes('private-'))
 db.close()
})
test('green requires both successful tests and resets when settings change', () => {
 const {db,settings:s}=harness()
 const base=s.updateServiceSettings({wavespeedKey:'a'})
 assert.equal(s.publicServiceStatus({...base,llmOk:true,wavespeedOk:false,checkedAt:new Date().toISOString()}).connected,false)
 assert.equal(s.publicServiceStatus({...base,llmOk:true,wavespeedOk:true,checkedAt:new Date().toISOString()}).connected,true)
 s.writeServiceSettings({...base,llmOk:true,wavespeedOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({llmModel:'another/model'})
 assert.equal(s.publicServiceStatus().connected,false)
 db.close()
})
test('one WaveSpeed key authenticates both LLM and account checks', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({wavespeedKey:'private-wave',llmModel:'provider/model'})
 assert.equal(saved.llmModel,'deepseek/deepseek-v4.1-flash')
 const urls=[]
 const api=load('serviceConnection',{'./serviceSettings':s}, {fetch:async(url,init)=>{
  urls.push(url)
  assert.equal(init.headers.Authorization,'Bearer private-wave')
  if(url === 'https://llm.wavespeed.ai/v1/chat/completions') {
   assert.equal(JSON.parse(init.body).model,'deepseek/deepseek-v4.1-flash')
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  }
  assert.equal(url,'https://api.wavespeed.ai/api/v3/balance')
  return {ok:true,status:200,json:async()=>({code:200,data:{balance:0}})}
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,true)
 assert.equal(urls.length,2)
 assert.equal(s.publicServiceStatus().connected,true)
 db.close()
})
test('invalid credentials and failed model requests cannot produce green', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({wavespeedKey:'a'})
 const api=load('serviceConnection',{'./serviceSettings':s}, {fetch:async()=>({ok:false,status:401,json:async()=>({error:{message:'invalid'}})})})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,false)
 assert.equal(result.llm.ok,false)
 assert.equal(result.wavespeed.ok,false)
 db.close()
})
test('an old connection test cannot overwrite newer settings', async () => {
 const {db,settings:s}=harness()
 const old=s.updateServiceSettings({wavespeedKey:''})
 const newer=s.updateServiceSettings({llmModel:'new/model'})
 const api=load('serviceConnection',{'./serviceSettings':s}, {})
 const result=await api.testServiceConnections(old)
 assert.equal(result.superseded,true)
 assert.equal(s.readServiceSettings().revision,newer.revision)
 db.close()
})

test('clearing the saved key deletes it and invalidates connection approval', () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({wavespeedKey:'secret-a'})
 s.writeServiceSettings({...saved,llmOk:true,wavespeedOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({wavespeedKey:'  '})
 assert.equal(s.readServiceSettings().wavespeedKey,'')
 assert.equal(s.publicServiceStatus().connected,false)
 assert.equal(s.publicServiceStatus().wavespeedConfigured,false)
 db.close()
})

test('legacy provider credentials and approvals are not reused', () => {
 const {db,settings:s}=harness()
 s.writeServiceSettings({openRouterKey:'old-router',falKey:'old-fal',openRouterModel:'old/model',openRouterOk:true,falOk:true,checkedAt:'2026-09-11'})
 assert.equal(s.readServiceSettings().wavespeedKey,'')
 assert.equal(s.readServiceSettings().falKey,'')
 assert.equal(s.readServiceSettings().llmModel,s.DEFAULT_MODEL)
 assert.equal(s.publicServiceStatus().connected,false)
 db.close()
})

test('malformed balance responses cannot produce a successful connection', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({wavespeedKey:'key'})
 const api=load('serviceConnection',{'./serviceSettings':s}, {fetch:async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}],code:200,data:{}})})})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.llm.ok,true)
 assert.equal(result.wavespeed.ok,false)
 assert.equal(result.connected,false)
 db.close()
})


test('vision-capable LLM completion and streaming use WaveSpeed without fal upload', async () => {
 const requests=[]
 let uploads=0
 const api=load('../agent/llm', llmMocks({
  './env':{agentEnv:{wavespeedApiKey:'private-wave',model:'test/vision-model'}},
  '../utils/wavespeed':{uploadWavespeedFile:async()=> {uploads++;return 'https://cdn.example.com/image.png'}},
  '../utils/localMedia':{readStoredMedia:async()=>({bytes:new Uint8Array([1,2,3]),mime:'image/png'})},
 }), {TextDecoder,fetch:async(url,init)=>{
  requests.push(url)
  assert.equal(url,'https://llm.wavespeed.ai/v1/chat/completions')
  assert.equal(init.headers.Authorization,'Bearer private-wave')
  const body=JSON.parse(init.body)
  assert.equal(body.model,'test/vision-model')
  assert.ok(!init.body.includes('base64'))
  // Duplicate image URLs keep only the newest copy (older one becomes a text placeholder).
  const imageParts=body.messages[0].content.filter(part=>part.type==='image_url')
  assert.equal(imageParts.length,1)
  assert.equal(imageParts[0].image_url.url,'https://cdn.example.com/image.png')
  if(!body.stream) return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})}
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Hello',tool_calls:[{index:0,id:'call-1',function:{name:'test_tool',arguments:'{}'}}]}}]})+'\n\ndata: [DONE]\n\n')
 }})
 const messages=[{role:'user',content:[{type:'image_url',image_url:{url:'http://localhost/api/media/image'}}]}]
 messages[0].content.push({...messages[0].content[0]})
 assert.equal(await api.completeText({messages}),'OK')
 assert.equal(uploads,1)
 const deltas=[]
 await api.streamChat({messages,tools:[],onDelta:delta=>deltas.push(delta)})
 assert.equal(deltas[0].content,'Hello')
 assert.equal(deltas[0].toolCalls[0].name,'test_tool')
 assert.equal(requests.length,2)
 assert.equal(uploads,2)
})


test('an empty LLM answer must not pass the connection test', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({wavespeedKey:'key'})
 const api=load('serviceConnection',{'./serviceSettings':s}, {fetch:async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:null}}],code:200,data:{balance:1}})})})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.llm.ok,false)
 assert.equal(result.connected,false)
 db.close()
})

test('DeepSeek V4 Flash sends text and refuses unsupported image input before a request', async () => {
 let requests=0
 const api=load('../agent/llm', llmMocks({
  './env':{agentEnv:{wavespeedApiKey:'private-wave',model:'deepseek/deepseek-v4-flash'}},
  '../utils/wavespeed':{uploadWavespeedFile:async()=> 'https://cdn.example.com/image.png'},
  '../utils/localMedia':{readStoredMedia:async()=>{throw new Error('must not read images')}},
 }), {fetch:async(url,init)=>{
  requests++
  assert.equal(url,'https://llm.wavespeed.ai/v1/chat/completions')
  const body=JSON.parse(init.body)
  assert.equal(body.model,'deepseek/deepseek-v4-flash')
  assert.equal(body.messages[0].content,'Hello')
  return {ok:true,json:async()=>({choices:[{message:{content:'Hi'}}]})}
 }})
 assert.equal(await api.completeText({messages:[{role:'user',content:'Hello'}]}),'Hi')
 await assert.rejects(api.completeText({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.com/image.png'}}]}]}),/does not support image input/)
 assert.equal(requests,1)
})

test('LLM excludes orphan and duplicate tool results from old sessions without mutating history',async()=>{
 const messages=[
  {role:'system',content:'Help'},
  {role:'tool',tool_call_id:'uploaded-image',content:'uploaded'},
  {role:'user',content:'What is this?'},
  {role:'assistant',content:'',tool_calls:[{id:'real-call',type:'function',function:{name:'inspect',arguments:'{}'}}]},
  {role:'tool',tool_call_id:'real-call',content:'valid result'},
  {role:'tool',tool_call_id:'real-call',content:'duplicate'},
 ]
 const api=load('../agent/llm',llmMocks({
  './env':{agentEnv:{wavespeedApiKey:'key',model:'test/model'}},
  '../utils/wavespeed':{},'../utils/localMedia':{},
 }),{fetch:async(url,init)=>{
  const sent=JSON.parse(init.body).messages
  assert.equal(sent.length,4)
  assert.equal(sent[3].tool_call_id,'real-call')
  assert.equal(sent[3].content,'valid result')
  return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})}
 }})
 assert.equal(await api.completeText({messages}),'OK')
 assert.equal(messages.length,6)
})
