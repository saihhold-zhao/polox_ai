<script setup lang="ts">
import type { AgentImage } from '~/composables/useAgentLab'
import { displayModelMentions } from '~~/shared/utils/agentModels'

defineProps<{
  message: { role: 'user' | 'assistant', content: string, kind?: string, streaming?: boolean }
  images: AgentImage[]
  lazy?: boolean
}>()
</script>

<template>
  <p v-if="message.kind === 'error'" class="text-xs text-destructive" role="alert">
    {{ displayModelMentions(message.content) }}
  </p>
  <article v-else-if="message.content" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[92%] rounded-xl px-3 py-2 text-sm leading-6"
      :class="message.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'"
    >
      <AgentLabUserMessage v-if="message.role === 'user'" :content="message.content" />
      <AgentLabMarkdown v-else :source="message.content" :streaming="message.streaming" :media-urls="images.map(image => image.url)" />
    </div>
  </article>
  <div v-if="$slots.default || images.length" class="flex flex-col gap-1.5">
    <slot />
    <div v-if="images.length" class="flex flex-wrap gap-2" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
      <AgentLabChatThumb v-for="image in images" :key="image.id" :image="image" :lazy="lazy" />
    </div>
  </div>
</template>
