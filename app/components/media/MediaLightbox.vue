<script setup lang="ts">
import { X } from 'lucide-vue-next'

const { item, close } = useMediaLightbox()
const isVideo = computed(() => item.value?.kind === 'video')
const label = computed(() => item.value?.alt || (isVideo.value ? 'Generated video' : 'Generated image'))

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !item.value)
    return
  event.preventDefault()
  event.stopPropagation()
  close()
}

watch(item, (value) => {
  if (!import.meta.client)
    return
  document.body.style.overflow = value ? 'hidden' : ''
  if (value)
    window.addEventListener('keydown', onKeydown, true)
  else
    window.removeEventListener('keydown', onKeydown, true)
}, { immediate: true })

onUnmounted(() => {
  if (!import.meta.client)
    return
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item"
      class="fixed inset-0 z-100 flex items-center justify-center bg-background"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      @click.self="close"
    >
      <button
        type="button"
        class="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close preview"
        @click="close"
      >
        <X class="size-4" />
      </button>

      <video
        v-if="isVideo"
        :src="item.url"
        :aria-label="label"
        controls
        autoplay
        playsinline
        class="max-h-dvh max-w-dvw bg-background object-contain"
        @click.stop
      />
      <img
        v-else
        :src="item.url"
        :alt="label"
        :class="item.cutout ? 'agent-cutout-board max-h-dvh max-w-dvw object-contain p-4' : 'max-h-dvh max-w-dvw object-contain'"
        @click.stop
      >
    </div>
  </Teleport>
</template>

<style scoped>
.agent-cutout-board {
  background-color: var(--muted);
  background-image:
    linear-gradient(45deg, var(--input) 25%, transparent 25%),
    linear-gradient(-45deg, var(--input) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--input) 75%),
    linear-gradient(-45deg, transparent 75%, var(--input) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
</style>
