<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'

const props = defineProps<{ modelId: string }>()
const tasks = computed(() => {
  const model = AGENT_MODELS.find(item => item.id === props.modelId)
  return model ? AGENT_MODELS.filter(item => item.name === model.name) : []
})
</script>

<template>
  <nav aria-label="Model tasks" class="flex flex-wrap justify-center gap-2">
    <Button v-for="task in tasks" :key="task.id" as-child class="h-9">
      <NuxtLink :to="{ path: '/', query: { agentModel: task.id }, hash: '#generator' }" :aria-label="`Use ${task.name} · ${task.task} in Agent`">
        {{ task.task }}
        <ArrowRight class="size-4" aria-hidden="true" />
      </NuxtLink>
    </Button>
  </nav>
</template>
