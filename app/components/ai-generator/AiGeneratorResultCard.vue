<script setup lang="ts">
import type { GenerationJobPublic } from '~~/shared/types/generation'
import { Eye, Folder, Paperclip, Trash2 } from 'lucide-vue-next'
import { isGenerationActive, isGenerationTerminal } from '~~/shared/types/generation'
import { isConcatenatedGeneration } from '~~/shared/utils/agentConcat'
import { IMAGE_LAYER_SPLITTER_NAME, isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { AI_MODELS } from '@/constants/aiModels'

const props = withDefaults(defineProps<{
  job: GenerationJobPublic
  layout?: 'row' | 'column'
  deleting?: boolean
  showDelete?: boolean
  showMove?: boolean
  showAttach?: boolean
  caption?: string
}>(), {
  layout: 'row',
  deleting: false,
  showDelete: true,
  showMove: false,
  showAttach: false,
})

const emit = defineEmits<{
  delete: [taskId: string]
  move: [taskId: string]
  attach: [payload: { urls: string[], prompt: string }]
}>()

const detailOpen = ref(false)
const inflight = computed(() => !isGenerationTerminal(props.job.state))
const canDelete = computed(() =>
  props.showDelete && !isGenerationActive(props.job.state),
)
const isLayerResult = computed(() => isImageLayerSplitterModel(props.job.model))
const media = computed(() => props.job.resultUrls)
const isVideo = computed(() =>
  props.job.category === 'Video' || media.value.some(url => isMediaVideoUrl(url)),
)
const failed = computed(() => props.job.state === 'fail')
const isConcat = computed(() => isConcatenatedGeneration(props.job))
const modelName = computed(() => {
  if (isImageLayerSplitterModel(props.job?.model || ''))
    return IMAGE_LAYER_SPLITTER_NAME
  if (isConcat.value)
    return ''
  return AI_MODELS.find(model => model.id === props.job.model)?.name || props.job.model
})
const taskType = computed(() => {
  if (isConcat.value)
    return ''
  return props.job.task || props.job.category || ''
})

function statusLabel() {
  if (props.job.state === 'queued')
    return 'Waiting in queue'
  if (props.job.state === 'moderating')
    return isVideo.value ? 'Checking video' : 'Checking images'
  if (props.job.state === 'archiving')
    return isVideo.value ? 'Saving video' : 'Saving images'
  if (failed.value)
    return props.job.failMsg || 'Generation failed'
  return 'Generating'
}

const canAttach = computed(() =>
  props.showAttach
  && !isVideo.value
  && media.value.some(url => /^https?:\/\//i.test(url)),
)

function onAttach() {
  const urls = media.value.filter(url => /^https?:\/\//i.test(url))
  if (!urls.length)
    return
  emit('attach', { urls, prompt: props.job.prompt || '' })
}

function onDelete() {
  if (props.deleting || !canDelete.value)
    return
  emit('delete', props.job.taskId)
}

const actionButtonClass = 'flex size-8 items-center justify-center rounded-lg border border-border bg-card/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const { open: openMedia } = useMediaLightbox()

function openResult() {
  const url = media.value[0]
  if (!url)
    return
  openMedia({
    url,
    kind: isVideo.value ? 'video' : 'image',
    alt: props.job.prompt || (isVideo.value ? 'Generated video' : 'Generated image'),
  })
}
</script>

<template>
  <article
    class="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-muted/35"
    :class="layout === 'column' ? 'mb-3 w-full break-inside-avoid' : isLayerResult ? 'w-full shrink-0 self-start' : 'w-56 shrink-0 self-start'"
  >
    <div class="absolute top-2 right-2 z-10 flex gap-1">
      <button
        v-if="showMove"
        type="button"
        :class="actionButtonClass"
        aria-label="Move to another project"
        @click.stop="emit('move', job.taskId)"
      >
        <Folder class="size-3.5" />
      </button>
      <button
        v-if="canAttach"
        type="button"
        :class="actionButtonClass"
        aria-label="Attach to Agent"
        @click.stop="onAttach"
      >
        <Paperclip class="size-3.5" />
      </button>
      <button
        type="button"
        :class="actionButtonClass"
        aria-label="View generation details"
        @click.stop="detailOpen = true"
      >
        <Eye class="size-3.5" />
      </button>
      <button
        v-if="canDelete"
        type="button"
        :class="actionButtonClass"
        :disabled="deleting"
        aria-label="Delete generation"
        @click.stop="onDelete"
      >
        <Spinner v-if="deleting" class="size-3.5" />
        <Trash2 v-else class="size-3.5" />
      </button>
    </div>

    <div v-if="isLayerResult && media.length" class="min-w-0 px-4 pt-12 pb-2">
      <ToolsImageLayerResults :job="job" />
    </div>

    <div
      v-else-if="media.length"
      class="relative bg-muted/35"
    >
      <video
        v-if="isVideo"
        :src="media[0]"
        controls
        playsinline
        preload="metadata"
        class="h-auto w-full object-contain"
      />
      <button
        v-else
        type="button"
        class="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="View generated image"
        @click="openResult"
      >
        <img
          :src="media[0]"
          alt="Generated image"
          class="h-auto w-full object-contain"
        >
      </button>
      <span
        v-if="media.length > 1"
        class="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
      >
        {{ media.length }}
      </span>
      <span
        v-if="inflight"
        class="pointer-events-none absolute bottom-2 right-2 rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-[11px] text-muted-foreground"
      >
        {{ statusLabel() }}
      </span>
    </div>

    <div
      v-else-if="inflight"
      class="relative"
    >
      <Skeleton class="aspect-4/3 w-full rounded-none bg-muted" />
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3">
        <Spinner class="size-6 text-muted-foreground" />
        <p class="text-center text-xs text-muted-foreground">
          {{ statusLabel() }}
        </p>
      </div>
    </div>

    <div
      v-else
      class="flex min-h-28 items-center justify-center bg-muted px-4 py-6"
    >
      <p class="text-center text-sm text-muted-foreground">
        {{ failed ? (job.failMsg || 'Generation failed') : (isVideo ? 'No video' : 'No image') }}
      </p>
    </div>

    <div class="space-y-0.5 border-t border-border bg-card px-3 py-2">
      <p
        v-if="!isLayerResult"
        class="line-clamp-3 break-words text-xs text-foreground md:text-sm"
        :title="job.prompt || undefined"
      >
        {{ job.prompt || 'Untitled generation' }}
      </p>
      <p
        v-if="modelName"
        class="text-[11px] text-muted-foreground"
      >
        {{ modelName }}
      </p>
      <p
        v-if="taskType"
        class="text-[11px] text-muted-foreground"
      >
        {{ taskType }}
      </p>
      <p
        v-if="caption"
        class="truncate text-[11px] text-muted-foreground"
        :title="caption"
      >
        {{ caption }}
      </p>
    </div>

    <AiGeneratorJobDetailDialog
      :open="detailOpen"
      :job="job"
      @update:open="detailOpen = $event"
    />
  </article>
</template>
