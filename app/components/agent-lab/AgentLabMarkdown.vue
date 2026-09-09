<script setup lang="ts">
import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'
import { splitAgentThinking } from '~~/shared/utils/agentThinking'

const props = defineProps<{
  source: string
  streaming?: boolean
  mediaUrls?: string[]
}>()
const navigateToMedia = useCanvasMediaNavigation()

function onLinkClick(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a')
  const href = anchor?.getAttribute('href')
  if (!navigateToMedia || !href || !props.mediaUrls?.includes(href))
    return
  event.preventDefault()
  void navigateToMedia(href)
}

const parts = computed(() => splitAgentThinking(props.source))
// Until the turn completes, prose can still become a tool-planning preamble.
const thinking = computed(() => [parts.value.thinking, props.streaming ? parts.value.answer : ''].filter(Boolean).join('\n\n'))
const html = computed(() => {
  const raw = marked.parse(props.streaming ? '' : parts.value.answer, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string
  return DOMPurify.sanitize(raw)
})
</script>

<template>
  <div class="agent-lab-md text-sm leading-6" @click="onLinkClick" @auxclick="onLinkClick">
    <details v-if="thinking" class="mb-1 text-muted-foreground">
      <summary class="cursor-pointer text-xs font-medium">
        Thinking
      </summary>
      <div class="mt-2 whitespace-pre-wrap text-xs leading-5">
        {{ thinking }}
      </div>
    </details>
    <div v-if="html" v-html="html" />
    <span v-if="streaming" class="ms-0.5 inline-block size-1.5 rounded-full bg-current align-middle opacity-70" />
  </div>
</template>

<style scoped>
.agent-lab-md :deep(p) {
  margin: 0;
}

.agent-lab-md :deep(p + p),
.agent-lab-md :deep(p + ol),
.agent-lab-md :deep(p + ul),
.agent-lab-md :deep(ol + p),
.agent-lab-md :deep(ul + p) {
  margin-top: 0.5rem;
}

.agent-lab-md :deep(strong) {
  font-weight: 600;
}

.agent-lab-md :deep(ol),
.agent-lab-md :deep(ul) {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
}

.agent-lab-md :deep(ol) {
  list-style: decimal;
}

.agent-lab-md :deep(ul) {
  list-style: disc;
}

.agent-lab-md :deep(li + li) {
  margin-top: 0.25rem;
}

.agent-lab-md :deep(a) {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-lab-md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.8125em;
}

.agent-lab-md :deep(pre) {
  margin-top: 0.5rem;
  overflow-x: auto;
  border-radius: 8px;
  padding: 0.75rem;
  background: var(--muted);
}
</style>
