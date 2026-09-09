import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, isRef, ref, shallowRef, toValue, watch } from 'vue'

const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
const wrapper = source.slice(source.indexOf('const agentLabs ='), source.indexOf('\nfunction createAgentLab('))
const writes = []
const runtimes = []
const unmounts = []
const context = vm.createContext({
  useServiceConnection: () => ({ ensureConnected: async () => true }),
  exports: {},
  computed,
  effectScope,
  isRef,
  ref,
  shallowRef,
  toValue,
  watch,
  onMounted: () => {},
  onUnmounted: fn => unmounts.push(fn),
  createAgentLab: ({ projectId }) => {
    const images = ref([])
    const draft = ref('')
    const lab = {
      images,
      draft,
      bindOptions() {},
      ensureHydrated() {},
      flush: () => writes.push({ projectId: toValue(projectId), images: [...images.value] }),
      addImage: image => images.value.push(image),
    }
    runtimes.push(lab)
    return lab
  },
})
vm.runInContext(ts.transpileModule(wrapper, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context)

const scope = effectScope()
scope.run(() => {
  const selected = ref('old')
  const home = context.exports.useAgentLab({ projectId: selected })
  home.addImage('old-image')
  home.draft.value = 'old draft'
  selected.value = 'new'
  assert.equal(home.images.value.length, 0, 'New project starts empty')
  assert.equal(home.draft.value, '', 'Drafts stay in their project')
  const page = context.exports.useAgentLab({ projectId: selected })
  assert.equal(page.images.value.length, 0, 'Home-to-project handoff stays empty')
  runtimes[0].addImage('late-old-result')
  assert.equal(page.images.value.length, 0, 'Late results stay in the original runtime')
  page.addImage('new-image')
  assert.deepEqual([...home.images.value], ['new-image'], 'Same project shares its runtime')
  selected.value = 'old'
  assert.deepEqual([...page.images.value], ['old-image', 'late-old-result'], 'Switching back restores the original project')
  selected.value = 'new'
  assert.deepEqual([...page.images.value], ['new-image'], 'New project retains only its own images')
  for (const unmount of unmounts)
    unmount()
  assert.ok(writes.every(write => write.images.every(image => write.projectId === 'old' ? image.includes('old') : image === 'new-image')), 'Persistence never writes another project’s images')
})
scope.stop()
console.log('Agent project isolation checks passed')
