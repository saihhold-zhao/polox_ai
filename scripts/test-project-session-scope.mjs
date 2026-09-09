import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {test} from 'node:test'
function load(file,name,globals) {
 const text=readFileSync(new URL(`../${file}`,import.meta.url),'utf8')
 const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
 const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(fn.getText(tree),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,...globals})
 return module.exports[name]
}
test('project session lists exclude unassigned and other-project sessions',async()=>{
 const sessions=new Map([['orphan',{id:'orphan',projectId:'',updatedAt:9}],['other',{id:'other',projectId:'other',updatedAt:8}],['own',{id:'own',projectId:'new',updatedAt:7}]])
 const list=load('server/agent/session.ts','listSessions',{pruneMemory:()=>{},sessions,mkdirSync:()=>{},sessionDir:'unused',readdirSync:()=>[],fetchStoredSessionList:async()=>[]})
 assert.deepEqual(Array.from(await list('new'),item=>item.id),['own'])
 assert.deepEqual(Array.from(await list('empty'),item=>item.id),[])
})
test('archived chats require an exact project match',async()=>{
 let filter
 const list=load('server/utils/agentChats.ts','listAgentChats',{connectDatabase:async()=>{},AgentChat:{find:query=>{filter=query;return {sort:()=>({limit:async()=>[]})}}}})
 await list('new')
 assert.equal(filter.projectId,'new')
 assert.equal(filter.$or,undefined)
})
