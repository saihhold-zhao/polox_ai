<script setup lang="ts">
import type { AgentImage, AgentStatus } from '~/composables/useAgentLab'

withDefaults(defineProps<{
  images: AgentImage[]
  status: AgentStatus
  showHeader?: boolean
  projectId?: string
}>(), {
  showHeader: true,
  projectId: 'agent-workspace',
})
</script>

<template>
  <section class="relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <div v-if="showHeader" class="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 class="text-sm font-medium tracking-tight">
        Canvas
      </h2>
      <Badge v-if="status === 'generating'" variant="outline">
        Working
      </Badge>
    </div>
    <AgentLabInfiniteCanvas :key="projectId" :project-id="projectId" :jobs="[]" :images="images" />
  </section>
</template>
