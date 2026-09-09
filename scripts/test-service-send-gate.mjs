import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
const source=readFileSync(new URL('../app/composables/useServiceConnection.ts',import.meta.url),'utf8')
function harness(fetch) {
 const open={value:false};const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,useState:()=>open,$fetch:fetch})
 return {open,api:module.exports.useServiceConnection()}
}
for(const kind of ['disconnected','unavailable','connected'])test(`send gate: ${kind}`,async()=>{
 let calls=0
 const h=harness(async(url)=>{assert.equal(url,'/api/settings/services');calls++;if(kind==='unavailable')throw new Error('offline');return {connected:kind==='connected'}})
 assert.equal(await h.api.ensureConnected(),kind==='connected')
 assert.equal(h.open.value,kind!=='connected')
 assert.equal(calls,1)
})
test('blocked send never reaches the lab or clears its draft',async()=>{
 const source=readFileSync(new URL('../app/composables/useAgentLab.ts',import.meta.url),'utf8')
 const ast=ts.createSourceFile('lab.ts',source,ts.ScriptTarget.Latest,true)
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useAgentLab')
 let sends=0;const lab={draft:{value:'Keep my message'},sendMessage:()=>{sends++;lab.draft.value='';return true}}
 let allowed=false
 const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
  module,exports:module.exports,useServiceConnection:()=>({ensureConnected:async()=>allowed}),toValue:v=>v,agentLabCacheKey:()=>'',agentLabs:new Map(),effectScope:()=>({run:fn=>fn()}),createAgentLab:()=>lab,shallowRef:value=>({value}),watch:()=>{},onMounted:()=>{},onUnmounted:()=>{},isRef:v=>!!v&&typeof v==='object'&&'value'in v,computed:v=>v,
 })
 const publicLab=module.exports.useAgentLab()
 assert.equal(await publicLab.sendMessage({newAgent:true}),false)
 assert.equal(sends,0)
 assert.equal(lab.draft.value,'Keep my message')
 allowed=true
 assert.equal(await publicLab.sendMessage(),true)
 assert.equal(sends,1)
})
