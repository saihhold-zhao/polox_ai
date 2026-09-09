<script setup lang="ts">
import type { GeneratorUploadItem } from '@/composables/useAiGeneratorForm'
import { Music, Plus, X } from 'lucide-vue-next'

const props = defineProps<{
  label: string
  items: GeneratorUploadItem[]
  accept: string
  maxItems: number
}>()

const emit = defineEmits<{
  pick: []
  remove: [id: string]
}>()

const uploadRing = 2 * Math.PI * 12
const canAdd = computed(() => props.items.length < props.maxItems)
const mediaKind = computed(() => {
  if (props.accept.includes('video/'))
    return 'video'
  if (props.accept.includes('audio/'))
    return 'audio'
  return 'image'
})
function removeLabel(item: GeneratorUploadItem) {
  if (item.status === 'uploading')
    return 'Cancel upload'
  if (mediaKind.value === 'video')
    return 'Remove video'
  if (mediaKind.value === 'audio')
    return 'Remove audio'
  return 'Remove image'
}
</script>

<template>
  <div class="flex min-w-0 shrink-0 flex-col gap-1.5">
    <p
      v-if="label"
      class="flex items-baseline gap-1.5 text-xs text-muted-foreground"
    >
      <span>{{ label }}</span>
      <span class="tabular-nums">{{ items.length }}/{{ maxItems }}</span>
    </p>
    <div class="flex max-w-full flex-wrap items-start gap-2">
      <button
        v-if="items.length === 0"
        type="button"
        class="flex size-16 items-center justify-center rounded-xl border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="`Add ${label.toLowerCase()}`"
        @click="emit('pick')"
      >
        <Plus class="size-5" />
      </button>

      <template v-else>
        <div
          v-for="item in items"
          :key="item.id"
          class="group relative size-16 overflow-hidden rounded-xl border border-border bg-muted/35"
        >
          <img
            v-if="item.kind !== 'video' && item.kind !== 'audio'"
            :src="item.previewUrl"
            alt=""
            class="size-full object-cover"
          >
          <video
            v-else-if="item.kind === 'video'"
            :src="item.previewUrl"
            muted
            playsinline
            preload="metadata"
            class="size-full object-cover"
          />
          <div
            v-else
            class="flex size-full items-center justify-center text-muted-foreground"
          >
            <Music class="size-5" />
          </div>

          <div
            v-if="item.status === 'uploading'"
            class="absolute inset-0 flex items-center justify-center bg-black/55"
          >
            <svg
              class="size-8 -rotate-90"
              viewBox="0 0 32 32"
              role="progressbar"
              :aria-valuenow="item.progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="Upload progress"
            >
              <circle
                cx="16"
                cy="16"
                r="12"
                fill="none"
                class="stroke-white/20"
                stroke-width="2.5"
              />
              <circle
                cx="16"
                cy="16"
                r="12"
                fill="none"
                class="stroke-primary transition-[stroke-dashoffset] duration-150"
                stroke-width="2.5"
                stroke-linecap="round"
                :stroke-dasharray="uploadRing"
                :stroke-dashoffset="uploadRing * (1 - item.progress / 100)"
              />
            </svg>
            <button
              type="button"
              class="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-black/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="removeLabel(item)"
              @click="emit('remove', item.id)"
            >
              <X class="size-3" />
            </button>
          </div>

          <button
            v-else
            type="button"
            class="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            :aria-label="removeLabel(item)"
            @click="emit('remove', item.id)"
          >
            <X class="size-4 text-white" />
          </button>
        </div>

        <button
          v-if="canAdd"
          type="button"
          class="flex size-16 items-center justify-center rounded-xl border border-dashed border-border bg-muted/35 text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`Add ${label.toLowerCase()}`"
          @click="emit('pick')"
        >
          <Plus class="size-5" />
        </button>
      </template>
    </div>
  </div>
</template>
