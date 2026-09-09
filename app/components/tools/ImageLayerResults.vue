<script setup lang="ts">
import type { GenerationJobPublic } from '~~/shared/types/generation'

const props = defineProps<{ job: GenerationJobPublic }>()
const { open } = useMediaLightbox()

function layerName(index: number) {
  return props.job.layers?.[index]?.name || (index === 0 ? 'Background' : `Layer ${index}`)
}
</script>

<template>
  <div class="flex w-full min-w-0 items-start gap-4 overflow-x-auto pb-2" tabindex="0" role="region" aria-label="Image layers">
    <button
      v-for="(url, index) in job.resultUrls"
      :key="`${index}-${url}`"
      type="button"
      class="w-56 shrink-0 overflow-hidden rounded-xl border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      :aria-label="`View ${layerName(index)}`"
      @click="open({ url, kind: 'image', alt: layerName(index) })"
    >
      <div class="flex h-56 items-center justify-center bg-muted/30 p-3">
        <img :src="url" :alt="layerName(index)" class="max-h-full max-w-full object-contain" loading="lazy">
      </div>
      <p class="truncate border-t border-border px-3 py-2 text-sm" :title="layerName(index)">
        {{ layerName(index) }}
      </p>
    </button>
  </div>
</template>
