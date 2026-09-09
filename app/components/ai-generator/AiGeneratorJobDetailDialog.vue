<script setup lang="ts">
import type { GenerationJobPublic } from '~~/shared/types/generation'
import { Music } from 'lucide-vue-next'
import { isConcatenatedGeneration } from '~~/shared/utils/agentConcat'
import { isFlux3I2vModel } from '~~/shared/utils/flux3'
import { IMAGE_LAYER_SPLITTER_NAME, isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { isMediaAudioUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { AI_MODELS } from '@/constants/aiModels'
import { getInputSchema, parseFieldConfigs } from '@/lib/aiModelSchema'

const props = defineProps<{
  open: boolean
  job: GenerationJobPublic | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const model = computed(() =>
  AI_MODELS.find(entry => entry.id === props.job?.model),
)

const isConcat = computed(() => props.job ? isConcatenatedGeneration(props.job) : false)
const modelName = computed(() => {
  if (isImageLayerSplitterModel(props.job?.model || ''))
    return IMAGE_LAYER_SPLITTER_NAME
  if (isConcat.value)
    return ''
  return model.value?.name || props.job?.model || ''
})
const resultsAreVideo = computed(() =>
  props.job?.category === 'Video' || (props.job?.resultUrls || []).some(url => isMediaVideoUrl(url)),
)

const paramRows = computed(() => {
  const input = props.job?.input && typeof props.job.input === 'object' ? { ...props.job.input } : {}
  // Flux 3 stores provider field names; the form schema uses first/last frame names.
  if (isFlux3I2vModel(props.job?.model || '')) {
    input.first_frame_url ??= input.image_url ?? input.start_image_url
    input.last_frame_url ??= input.end_image_url
  }
  const fields = model.value
    ? parseFieldConfigs(getInputSchema(model.value.schema))
    : []
  const labels = new Map(fields.map(field => [field.key, field.label]))
  const keys = fields.length
    ? fields.map(field => field.key).filter(key => key in input)
    : Object.keys(input)

  return keys.flatMap((key) => {
    if (key === 'prompt' && isImageLayerSplitterModel(props.job?.model || ''))
      return []
    const value = input[key]
    const urls = extractHttpUrls(value)
    if (!urls.length && (value == null || value === '' || (Array.isArray(value) && value.length === 0)))
      return []

    return [{
      key,
      label: labels.get(key) || key.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
      kind: urls.length ? mediaKind(urls) : 'text' as const,
      text: formatParamValue(value),
      urls,
    }]
  })
})

function extractHttpUrls(value: unknown) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value))
    return [value]
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item))
  return []
}

function mediaKind(urls: string[]) {
  if (urls.every(url => isMediaVideoUrl(url)))
    return 'videos' as const
  if (urls.every(url => isMediaAudioUrl(url)))
    return 'audio' as const
  return 'images' as const
}

function formatParamValue(value: unknown) {
  if (value == null || value === '')
    return '—'
  if (typeof value === 'boolean')
    return value ? 'Yes' : 'No'
  if (Array.isArray(value))
    return value.length ? value.map(item => String(item)).join(', ') : '—'
  return String(value)
}

const dateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})

function formatDateTime(value?: string) {
  if (!value)
    return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return '—'
  return dateTime.format(date)
}

const createdAtLabel = computed(() => formatDateTime(props.job?.createdAt))
const { open: openMedia } = useMediaLightbox()

function openUrl(url: string, kind: 'images' | 'videos' | 'audio', alt: string) {
  if (kind === 'audio')
    return
  openMedia({
    url,
    kind: kind === 'videos' ? 'video' : 'image',
    alt,
  })
}
const completedAtLabel = computed(() => {
  if (!props.job)
    return '—'
  if (props.job.completedAt)
    return formatDateTime(props.job.completedAt)
  if (props.job.state === 'success' || props.job.state === 'fail')
    return formatDateTime(props.job.updatedAt)
  return 'In progress'
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[min(90vh,52rem)] overflow-y-auto rounded-2xl border-border bg-card shadow-none sm:max-w-2xl">
      <DialogHeader class="gap-1 pr-6">
        <DialogTitle>
          Generation details
        </DialogTitle>
        <DialogDescription>
          <template v-if="isConcat">
            Concatenated video
          </template>
          <template v-else>
            {{ modelName }}{{ job?.task ? ` · ${job.task}` : '' }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <section
        v-if="job"
        class="flex min-w-0 flex-col gap-5"
      >
        <dl class="grid grid-cols-1 gap-3 sm:grid-cols-[8.5rem_1fr] sm:gap-x-4 sm:gap-y-3">
          <dt class="text-xs text-muted-foreground sm:pt-0.5">
            Created
          </dt>
          <dd class="min-w-0 text-sm tabular-nums text-foreground">
            {{ createdAtLabel }}
          </dd>
          <dt class="text-xs text-muted-foreground sm:pt-0.5">
            Completed
          </dt>
          <dd class="min-w-0 text-sm tabular-nums text-foreground">
            {{ completedAtLabel }}
          </dd>
        </dl>

        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium text-foreground">
            Input
          </h3>
          <dl class="grid grid-cols-1 gap-3 sm:grid-cols-[8.5rem_1fr] sm:gap-x-4 sm:gap-y-3">
            <template
              v-for="row in paramRows"
              :key="row.key"
            >
              <dt class="text-xs text-muted-foreground sm:pt-0.5">
                {{ row.label }}
              </dt>
              <dd class="min-w-0 text-sm text-foreground">
                <div
                  v-if="row.kind !== 'text' && row.urls.length"
                  class="flex flex-wrap gap-2"
                >
                  <button
                    v-for="url in row.urls"
                    :key="url"
                    type="button"
                    class="overflow-hidden rounded-xl border border-border bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :aria-label="row.kind === 'videos' ? 'View reference video' : row.kind === 'audio' ? 'Reference audio' : 'View reference image'"
                    @click="openUrl(url, row.kind === 'videos' ? 'videos' : row.kind === 'audio' ? 'audio' : 'images', row.label)"
                  >
                    <video
                      v-if="row.kind === 'videos'"
                      :src="url"
                      muted
                      playsinline
                      preload="metadata"
                      class="h-20 w-20 object-cover"
                    />
                    <span
                      v-else-if="row.kind === 'audio'"
                      class="flex h-20 w-20 items-center justify-center text-muted-foreground"
                    >
                      <Music class="size-5" />
                    </span>
                    <img
                      v-else
                      :src="url"
                      alt="Reference image"
                      class="h-20 w-20 object-contain"
                    >
                  </button>
                </div>
                <p
                  v-else
                  class="whitespace-pre-wrap break-words"
                >
                  {{ row.text }}
                </p>
              </dd>
            </template>
          </dl>
        </div>

        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium text-foreground">
            Results
          </h3>
          <p
            v-if="job.failMsg"
            class="text-sm text-muted-foreground"
          >
            {{ job.failMsg }}
          </p>
          <ToolsImageLayerResults
            v-else-if="isImageLayerSplitterModel(job.model) && job.resultUrls.length"
            :job="job"
          />
          <div
            v-else-if="job.resultUrls.length"
            class="flex flex-col gap-3"
          >
            <template v-if="resultsAreVideo">
              <video
                v-for="url in job.resultUrls"
                :key="url"
                :src="url"
                controls
                playsinline
                preload="metadata"
                class="w-full overflow-hidden rounded-2xl border border-border bg-muted/35 object-contain"
              />
            </template>
            <template v-else>
              <button
                v-for="(url, index) in job.resultUrls"
                :key="url"
                type="button"
                class="overflow-hidden rounded-2xl border border-border bg-muted/35 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="job.layers?.[index]?.name || 'View generated image'"
                @click="openUrl(url, 'images', job.prompt || 'Generated image')"
              >
                <img
                  :src="url"
                  :alt="job.layers?.[index]?.name || 'Generated image'"
                  class="w-full object-contain"
                >
                <span v-if="job.layers?.[index]" class="block p-3 text-sm">{{ job.layers[index]?.name }}</span>
              </button>
            </template>
          </div>
          <p
            v-else
            class="text-sm text-muted-foreground"
          >
            {{ job.state === 'queued'
              ? 'Waiting in queue until a slot is free.'
              : resultsAreVideo ? 'No generated video yet.' : 'No generated images yet.' }}
          </p>
        </div>
      </section>
    </DialogContent>
  </Dialog>
</template>
