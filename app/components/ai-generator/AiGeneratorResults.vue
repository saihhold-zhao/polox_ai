<script setup lang="ts">
import type { GenerationJobPublic } from '~~/shared/types/generation'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'

const props = defineProps<{
  jobs: GenerationJobPublic[]
  pending: boolean
  ready?: boolean
  deletingTaskId?: string | null
}>()
const emit = defineEmits<{
  delete: [
        taskId: string,
  ]
}>()
const visibleJobs = computed(() => props.jobs.slice(0, 10))
const layerResults = computed(() => visibleJobs.value.length > 0 && visibleJobs.value.every(job => isImageLayerSplitterModel(job.model)))
const visible = computed(() => true)
const empty = computed(() => (props.ready ?? true)
  && !props.pending
  && visibleJobs.value.length === 0)
const pendingTiles = computed(() => {
  if (!props.pending)
    return []
  return [{
    id: 'submitting',
    label: 'Generating',
  }]
})
</script>

<template>
  <section
    v-if="visible"
    class="flex flex-col gap-3"
    aria-live="polite"
  >
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-medium text-foreground">
        Generations
      </h3>
      <NuxtLink
        to="/projects"
        class="inline-flex shrink-0 items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        View projects
        <Icon name="i-lucide-arrow-right" class="size-4" />
      </NuxtLink>
    </div>

    <p
      v-if="empty"
      class="rounded-2xl border border-border bg-muted/35 px-4 py-8 text-center text-sm text-muted-foreground"
    >
      You don't have any generations yet. Create your first one.
    </p>

    <div
      v-else-if="pendingTiles.length || visibleJobs.length"
      class="flex min-w-0 gap-4 pb-1"
      :class="layerResults ? 'flex-col' : 'items-start overflow-x-auto'"
    >
      <div
        v-for="tile in pendingTiles"
        :key="tile.id"
        class="relative w-56 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted/35"
      >
        <Skeleton class="aspect-4/3 w-full rounded-none bg-muted" />
        <div class="absolute inset-0 flex items-center justify-center">
          <Spinner class="size-6 text-muted-foreground" />
          <span class="sr-only">{{ tile.label }}</span>
        </div>
      </div>

      <AiGeneratorResultCard
        v-for="job in visibleJobs"
        :key="job.taskId"
        :job="job"
        layout="row"
        :deleting="deletingTaskId === job.taskId"
        @delete="emit('delete', $event)"
      />
    </div>
  </section>
</template>
