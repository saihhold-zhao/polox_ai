<script setup lang="ts">
import type { ImageTextEdit } from '~~/shared/utils/imageTextEditor'
import type { ChoiceAnswer } from '~/composables/useAgentLab'
import { validateTextEditAnswers } from '~~/shared/utils/imageTextEditor'

const props = defineProps<{ edit?: ImageTextEdit, edits?: ImageTextEdit[], pending?: boolean, state?: string, answers?: ChoiceAnswer[] }>()
const emit = defineEmits<{ submit: [answers: ChoiceAnswer[]], skip: [] }>()
const sources = props.edits || (props.edit ? [props.edit] : [])
const drafts = ref(sources.map(edit => ({ ...edit, lines: edit.lines.map(line => ({ ...line })) })))
const activeIndex = ref(0)
const activeEdit = computed(() => drafts.value[activeIndex.value])
const componentId = useId()
const failedImages = reactive<Record<string, boolean>>({})
const saved = computed(() => props.state === 'answered' || props.state === 'skipped')
const changedEdits = computed(() => drafts.value.filter(edit => !edit.detectionError && edit.lines.some(line => line.original !== line.text)))
const changed = computed(() => changedEdits.value.reduce((total, edit) => total + edit.lines.filter(line => line.original !== line.text).length, 0))
const validationError = computed(() => {
  if (!changedEdits.value.length)
    return ''
  try {
    validateTextEditAnswers(sources, changedEdits.value, sources.map(edit => edit.imageUrl))
    return ''
  }
  catch (error) { return error instanceof Error ? error.message : 'Check the replacement text.' }
})
const valid = computed(() => !validationError.value && changed.value > 0 && changedEdits.value.every(edit => !failedImages[edit.imageUrl]))
watch(() => props.answers, (answers) => {
  const answer = answers?.find(answer => answer.questionId === 'image_text_editor')
  const stored = answer?.textEdits || (answer?.textLines && props.edit ? [{ imageUrl: props.edit.imageUrl, lines: answer.textLines }] : [])
  for (const edit of stored) {
    const draft = drafts.value.find(item => item.imageUrl === edit.imageUrl)
    if (draft)
      draft.lines = edit.lines.map(line => ({ ...line }))
  }
}, { immediate: true })
function submit() {
  if (!valid.value || props.pending || saved.value)
    return
  const edits = changedEdits.value.map(edit => ({ imageUrl: edit.imageUrl, lines: edit.lines.map(line => ({ ...line })) }))
  emit('submit', [{ questionId: 'image_text_editor', ...(props.edits ? { textEdits: edits } : { textLines: edits[0]!.lines }) }])
}
</script>

<template>
  <Card class="relative w-full gap-4 rounded-2xl border-blue-500/70 py-4 shadow-none">
    <AgentLabCardBorder v-if="!saved" tone="attention" />
    <CardHeader class="px-4">
      <CardTitle class="text-sm">
        Image text editor
      </CardTitle>
      <CardDescription>{{ saved ? (state === 'skipped' ? 'Cancelled' : 'Edits saved') : 'Edit the text you want to change. Leave other lines unchanged.' }}</CardDescription>
    </CardHeader>
    <CardContent class="grid min-w-0 gap-4 px-4">
      <div v-if="drafts.length > 1" class="flex flex-wrap gap-2" aria-label="Source image">
        <button v-for="(draft, index) in drafts" :key="draft.imageUrl" type="button" class="rounded-lg border p-1" :class="activeIndex === index ? 'border-primary' : 'border-border'" :aria-pressed="activeIndex === index" :aria-label="`Image ${index + 1}`" :disabled="pending" @click="activeIndex = index">
          <img :src="draft.imageUrl" :alt="`Image ${index + 1}`" class="size-16 object-contain">
          <span class="block text-xs">{{ index + 1 }} · {{ draft.detectionError ? 'Detection failed' : `${draft.lines.filter(line => line.original !== line.text).length} edited` }}</span>
        </button>
      </div>
      <div v-if="activeEdit" class="grid min-w-0 overflow-hidden rounded-xl border border-border lg:grid-cols-2">
        <div class="flex min-w-0 items-center justify-center bg-muted/20 p-4">
          <img :key="activeEdit.imageUrl" :src="activeEdit.imageUrl" alt="Original image" class="max-h-[480px] max-w-full object-contain" @load="failedImages[activeEdit.imageUrl] = false" @error="failedImages[activeEdit.imageUrl] = true">
        </div>
        <div v-if="activeEdit.detectionError" role="status" class="border-t border-border p-3 text-sm text-muted-foreground lg:border-t-0 lg:border-l">
          {{ activeEdit.detectionError }}
        </div>
        <ol v-else :key="activeEdit.imageUrl" class="max-h-[480px] space-y-2 overflow-y-auto border-t border-border p-3 lg:border-t-0 lg:border-l" aria-label="Detected text">
          <li v-for="(line, index) in activeEdit.lines" :key="index" class="flex items-start gap-3 rounded-lg border border-border p-2">
            <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums">{{ index + 1 }}</span>
            <label :for="`text-line-${componentId}-${activeIndex}-${index}`" class="sr-only">Replacement text {{ index + 1 }}: {{ line.original }}</label>
            <textarea :id="`text-line-${componentId}-${activeIndex}-${index}`" v-model="line.text" :disabled="pending || saved" rows="2" maxlength="2000" class="min-w-0 w-full resize-y rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm focus-visible:border-border focus-visible:bg-background focus-visible:outline-none" />
          </li>
        </ol>
      </div>
      <p v-if="activeEdit && failedImages[activeEdit.imageUrl]" role="alert" class="text-sm text-destructive">
        The source image could not be loaded. Reopen the editor or upload the image again.
      </p>
      <p v-if="validationError" role="alert" class="text-xs text-destructive">
        {{ validationError }}
      </p>
    </CardContent>
    <CardFooter v-if="!saved" class="justify-end gap-2 border-t px-4 pt-3">
      <Button variant="outline" size="sm" :disabled="pending" @click="emit('skip')">
        Cancel
      </Button>
      <Button size="sm" :disabled="pending || !valid" @click="submit">
        <Spinner v-if="pending" />Generate · {{ drafts.length > 1 ? `${changedEdits.length} ${changedEdits.length === 1 ? 'image' : 'images'}` : `${changed} ${changed === 1 ? 'line' : 'lines'}` }}
      </Button>
    </CardFooter>
  </Card>
</template>
