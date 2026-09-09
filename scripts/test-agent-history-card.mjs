import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, watch } from 'vue'

function script(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import .*\n/gm, '')
}

test('historical confirmation keeps saved params and cannot start generation', () => {
  const scope = effectScope()
  const props = {
    readOnly: true,
    state: 'pending',
    confirmation: { id: 'confirm', kind: 'image', params: { prompt: 'Original prompt', aspectRatio: '1:1', resolution: '1K' }, reason: 'Generate the character reference', inputUrls: ['https://example.com/reference.png'] },
    resolvedParams: { prompt: 'Approved prompt', aspectRatio: '16:9', resolution: '2K' },
  }
  let emitted = 0
  const context = vm.createContext({
    computed,
    ref,
    watch,
    defineProps: () => props,
    withDefaults: value => value,
    defineEmits: () => () => { emitted++ },
    useMediaLightbox: () => ({ open: () => {} }),
  })
  const source = `${script('../app/components/agent-lab/AgentLabConfirmCard.vue')}\nglobalThis.api = { isPending, canConfirm, shownParams, inputUrls, emitConfirm };`
  scope.run(() => vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context))
  assert.equal(context.api.isPending.value, false)
  assert.equal(context.api.canConfirm.value, false)
  assert.equal(context.api.shownParams.value.prompt, 'Approved prompt')
  assert.equal(context.api.inputUrls.value[0], 'https://example.com/reference.png')
  context.api.emitConfirm()
  assert.equal(emitted, 0)
  scope.stop()
})
