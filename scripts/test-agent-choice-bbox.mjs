import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { confirmedLayerSelection } from '../server/agent/layerSplitBrief.ts'
import { withCustomChoiceOption } from '../shared/utils/agentChoices.ts'
import { validateLayerSelection } from '../shared/utils/agentLayerSelection.ts'

const context = vm.createContext({ validateLayerSelection, withCustomChoiceOption })
for (const [path, name] of [['../server/agent/router.ts', 'parseChoiceBody'], ['../server/agent/loop.ts', 'formatChoiceResult']]) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn)
  vm.runInContext(ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}
const payload = { questions: [{ id: 'layer_selection_method', options: [{ id: 'draw_boxes', label: 'Draw boxes' }] }] }
const answer = { questionId: 'layer_selection_method', optionId: 'draw_boxes', imageUrl: 'https://example.com/source.png', regions: [[10, 20, 300, 400], [500, 500, 900, 900]] }

test('HTTP parser preserves source and bbox through choice validation and model selection', () => {
  const body = context.parseChoiceBody(JSON.parse(JSON.stringify({ choiceId: 'card', action: 'submit', answers: [answer] })))
  const result = context.formatChoiceResult(payload, body, [answer.imageUrl])
  const selection = confirmedLayerSelection([{ role: 'tool', content: result }])
  assert.deepEqual(selection, { imageUrl: answer.imageUrl, regions: answer.regions })
})

test('parser does not bypass source ownership or bbox validation', () => {
  const parse = row => context.parseChoiceBody({ choiceId: 'card', action: 'submit', answers: [row] })
  assert.throws(() => context.formatChoiceResult(payload, parse(answer), []), /Select an image/)
  assert.throws(() => context.formatChoiceResult(payload, parse({ ...answer, regions: [[-1, 0, 20, 20]] }), [answer.imageUrl]), /Invalid selection/)
})
