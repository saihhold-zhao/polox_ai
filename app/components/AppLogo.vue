<script setup lang="ts">
type LogoSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  showName?: boolean
  size?: LogoSize
}>(), {
  showName: true,
  size: 'md',
})

const { public: publicConfig } = useRuntimeConfig()

const markSizeClass: Record<LogoSize, string> = {
  sm: 'size-6 rounded-none',
  md: 'size-8 rounded-none',
  lg: 'size-12 rounded-none',
}

const nameSizeClass: Record<LogoSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
}
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-2">
    <img
      src="/brand/polox-favicon.png"
      :alt="showName ? '' : publicConfig.brandName"
      :aria-hidden="showName ? 'true' : undefined"
      class="shrink-0 object-cover"
      :class="markSizeClass[props.size]"
    >
    <span
      v-if="showName"
      class="truncate font-semibold leading-none tracking-tight text-foreground"
      :class="nameSizeClass[props.size]"
    >
      {{ publicConfig.brandName }}
    </span>
  </span>
</template>
