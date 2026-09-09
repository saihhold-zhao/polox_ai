<script setup lang="ts">
import type { AiModelConfig } from '~~/shared/types/aiModel'
import { AGENT_MODELS, displayModelMentions } from '~~/shared/utils/agentModels'
import { toolAgentMessage } from '~/utils/toolAgentRequest'

const props = defineProps<{ content: string }>()
const toolInput = computed(() => toolAgentMessage(props.content))
const shownContent = computed(() => toolInput.value?.content ?? props.content)
const { open } = useMediaLightbox()
const parts = computed(() => {
  const result: Array<{ text: string, model?: AiModelConfig }> = []
  let cursor = 0
  for (const match of shownContent.value.matchAll(/@\[[^\]]+\]\(model:([^\s)]+)\)/g)) {
    if (match.index > cursor)
      result.push({ text: shownContent.value.slice(cursor, match.index) })
    result.push({ text: displayModelMentions(match[0]), model: AGENT_MODELS.find(model => model.id === match[1]) })
    cursor = match.index + match[0].length
  }
  if (cursor < shownContent.value.length)
    result.push({ text: shownContent.value.slice(cursor) })
  return result
})
</script>

<template>
  <p class="whitespace-pre-wrap break-words">
    <template v-for="(part, index) in parts" :key="index">
      <AgentLabModelBadge v-if="part.model" :model="part.model" /><template v-else>
        {{ part.text }}
      </template>
    </template>
  </p>
  <div v-if="toolInput?.attachments.length" class="mt-2 flex flex-wrap justify-end gap-2">
    <template v-for="attachment in toolInput.attachments" :key="attachment.url">
      <audio v-if="attachment.kind === 'audio'" :src="attachment.url" controls preload="none" class="max-w-full" />
      <button
        v-else
        type="button"
        class="overflow-hidden rounded-xl border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="attachment.kind === 'video' ? 'View reference video' : 'View reference image'"
        @click="open({ url: attachment.url, kind: attachment.kind, alt: 'Reference attachment' })"
      >
        <video v-if="attachment.kind === 'video'" :src="attachment.url" muted playsinline preload="metadata" class="size-20 object-cover" />
        <img v-else :src="attachment.url" alt="Reference image" loading="lazy" class="size-20 object-cover">
      </button>
    </template>
  </div>
</template>
