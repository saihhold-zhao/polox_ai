import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../shared/utils/agentThinking.ts', import.meta.url), 'utf8')
const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const { splitAgentThinking } = context.exports

test('thinking is separated from the formal answer, including incomplete streams', () => {
  assert.equal(splitAgentThinking('<think>Plan the edit</think>Done.').thinking, 'Plan the edit')
  assert.equal(splitAgentThinking('<think>Plan the edit</think>Done.').answer, 'Done.')
  assert.equal(splitAgentThinking('<think>Still planning').answer, '')
  assert.equal(splitAgentThinking('<thi').answer, '')
  assert.equal(splitAgentThinking('<thinking>First</thinking><think>Second</think>Answer').thinking, 'First\n\nSecond')
  assert.equal(splitAgentThinking('The user wants a blue background.').answer, 'The user wants a blue background.')
})
