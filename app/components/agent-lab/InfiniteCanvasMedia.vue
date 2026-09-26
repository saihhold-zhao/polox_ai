<script setup lang="ts">
const props = defineProps<{
  url: string
  alt: string
  video?: boolean
  audio?: boolean
  document?: boolean
  name?: string
  playing?: boolean
}>()

const emit = defineEmits<{
  dimensions: [size: { width: number, height: number }]
}>()

function reportDimensions(event: Event) {
  const media = event.target
  if (media instanceof HTMLVideoElement)
    emit('dimensions', { width: media.videoWidth, height: media.videoHeight })
  else if (media instanceof HTMLImageElement)
    emit('dimensions', { width: media.naturalWidth, height: media.naturalHeight })
}

const failed = ref(false)
const element = ref<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>()

watch([() => props.playing, element], ([playing, media]) => {
  if (!(media instanceof HTMLVideoElement))
    return
  if (playing)
    void media.play().catch(() => {})
  else
    media.pause()
})

onMounted(() => {
  if ((props.audio || props.document) && !failed.value)
    emit('dimensions', { width: 480, height: props.document ? 360 : 120 })
})

onErrorCaptured(() => {
  failed.value = true
  return false
})

onBeforeUnmount(() => {
  const media = element.value
  if (!media)
    return
  if (media instanceof HTMLVideoElement) {
    media.pause()
    media.removeAttribute('src')
    media.load()
    return
  }
  media.removeAttribute('src')
})

function retry() {
  failed.value = false
}
</script>

<template>
  <div class="size-full">
    <video
      v-if="props.video && !failed"
      :key="url"
      ref="element"
      :src="url"
      :aria-label="alt"
      muted
      loop
      :autoplay="playing"
      playsinline
      preload="metadata"
      draggable="false"
      class="size-full object-contain"
      @loadedmetadata="reportDimensions"
      @error="failed = true"
    />
    <div
      v-else-if="props.audio && !failed"
      class="flex size-full flex-col items-center justify-center gap-3 bg-muted/40 px-4"
    >
      <Icon name="i-lucide-music" class="size-8 text-muted-foreground" />
      <audio
        :key="url"
        ref="element"
        :src="url"
        :aria-label="alt"
        controls
        preload="metadata"
        class="w-full max-w-md"
        @loadedmetadata="reportDimensions"
        @error="failed = true"
        @pointerdown.stop
        @click.stop
      />
    </div>
    <div
      v-else-if="props.document && !failed"
      class="flex size-full flex-col items-center justify-center gap-3 bg-muted/40 px-4 text-center"
    >
      <Icon name="i-lucide-file-text" class="size-10 text-muted-foreground" />
      <p class="line-clamp-3 w-full max-w-sm break-all text-sm text-muted-foreground" :title="name || alt">
        {{ name || alt || 'Document' }}
      </p>
    </div>
    <img
      v-else-if="!failed"
      :key="url"
      ref="element"
      :src="url"
      :alt="alt"
      decoding="async"
      draggable="false"
      class="size-full object-contain"
      @load="reportDimensions"
      @error="failed = true"
    >
    <div v-else class="flex size-full flex-col items-center justify-center gap-3 px-2 text-center text-muted-foreground" style="font-size: var(--canvas-label-size, 14px)">
      <span>Preview unavailable</span>
      <button class="rounded border px-3 py-1" @click.stop="retry">
        Retry preview
      </button>
    </div>
  </div>
</template>
