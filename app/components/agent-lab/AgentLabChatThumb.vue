<script setup lang="ts">
import type { AgentImage } from '~/composables/useAgentLab'
import { isMediaAudioUrl, isMediaDocumentUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'

const props = defineProps<{
  image: AgentImage
  lazy?: boolean
}>()

const { open } = useMediaLightbox()
const navigateToMedia = useCanvasMediaNavigation()
const videoEl = ref<HTMLVideoElement | null>(null)
const playedOnce = ref(false)
const isCutout = computed(() => props.image.kind === 'cutout')
const isAudio = computed(() =>
  props.image.kind === 'audio'
  || (props.image.url ? isMediaAudioUrl(props.image.url) : false),
)
const isDocument = computed(() =>
  props.image.kind === 'document'
  || (props.image.url ? isMediaDocumentUrl(props.image.url) : false)
  || /\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(props.image.name || ''),
)
const isVideo = computed(() =>
  !isAudio.value
  && !isDocument.value
  && (props.image.kind === 'video' || (props.image.url ? isMediaVideoUrl(props.image.url) : false)),
)
const ready = computed(() => props.image.status === 'success' && Boolean(props.image.url))
const label = computed(() => {
  if (props.image.status === 'fail') {
    if (isCutout.value)
      return props.image.error || 'Background removal failed'
    if (isVideo.value)
      return props.image.error || 'Video generation failed'
    return props.image.error || 'Generation failed'
  }
  if (props.image.status === 'generating') {
    if (isCutout.value)
      return 'Removing background'
    if (isVideo.value)
      return 'Generating video'
    return 'Generating still'
  }
  return props.image.prompt || (isDocument.value ? (props.image.name || 'Document') : isVideo.value ? 'Generated video' : isAudio.value ? 'Audio' : 'Generated still')
})

async function playMutedOnce() {
  const el = videoEl.value
  if (!el || playedOnce.value || props.lazy)
    return
  playedOnce.value = true
  try {
    el.muted = true
    el.currentTime = 0
    await el.play()
  }
  catch {
    // Autoplay may be blocked; metadata poster frame is enough.
  }
}

function onVideoEnded() {
  const el = videoEl.value
  if (!el)
    return
  el.pause()
  try {
    el.currentTime = 0
  }
  catch {
    // Ignore seek failures on some codecs.
  }
}

function openPreview() {
  if (!ready.value)
    return
  if (isDocument.value) {
    open({ url: props.image.url, kind: 'document', alt: props.image.name || label.value })
    if (navigateToMedia)
      void navigateToMedia(props.image.url)
    return
  }
  open({
    url: props.image.url,
    kind: isVideo.value ? 'video' : isAudio.value ? 'audio' : 'image',
    alt: label.value,
    cutout: isCutout.value,
  })
  // Keep the matching canvas asset selected while showing the fullscreen preview.
  if (navigateToMedia)
    void navigateToMedia(props.image.url)
}

watch(() => props.image.url, () => {
  playedOnce.value = false
})
</script>

<template>
  <button
    v-if="ready"
    type="button"
    :title="label"
    :aria-label="label"
    class="overflow-hidden rounded-xl border border-border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="isCutout ? 'agent-cutout-board' : 'bg-muted/40'"
    @click="openPreview"
  >
    <video
      v-if="isVideo"
      ref="videoEl"
      :src="image.url"
      muted
      playsinline
      :preload="lazy ? 'none' : 'metadata'"
      class="size-20 object-cover"
      @loadeddata="playMutedOnce"
      @ended="onVideoEnded"
    />
    <div
      v-else-if="isAudio"
      class="flex size-20 items-center justify-center bg-muted/40"
    >
      <Icon name="i-lucide-music" class="size-8 text-muted-foreground" />
    </div>
    <div
      v-else-if="isDocument"
      class="flex size-20 flex-col items-center justify-center gap-1 bg-muted/40 px-1"
    >
      <Icon name="i-lucide-file-text" class="size-7 text-muted-foreground" />
      <span class="w-full truncate text-center text-[10px] text-muted-foreground">{{ image.name || 'Doc' }}</span>
    </div>
    <img
      v-else
      :src="image.url"
      :loading="lazy ? 'lazy' : undefined"
      decoding="async"
      :alt="label"
      :class="isCutout ? 'size-20 object-contain p-1' : 'size-20 object-cover'"
    >
  </button>
</template>
