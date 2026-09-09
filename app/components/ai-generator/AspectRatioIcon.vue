<script setup lang="ts">
import { getAspectRatioIconSize } from '@/lib/aspectRatio'

const props = withDefaults(defineProps<{
  ratio: string
  maxSize?: number
}>(), {
  maxSize: 16,
})

const iconSize = computed(() => getAspectRatioIconSize(props.ratio, props.maxSize))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center text-muted-foreground"
    :style="{ width: `${maxSize}px`, height: `${maxSize}px` }"
    aria-hidden="true"
  >
    <span
      class="rounded-[2px] border border-muted-foreground/80 bg-muted-foreground/20"
      :style="{
        width: `${iconSize.width}px`,
        height: `${iconSize.height}px`,
      }"
    />
  </span>
</template>
