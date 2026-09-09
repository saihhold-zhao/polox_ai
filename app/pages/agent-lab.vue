<script setup lang="ts">
definePageMeta({
  layout: 'blank',
})

const { selectHomeAgent } = useAgentWorkspaceNav()
const { public: publicConfig } = useRuntimeConfig()

useSeoMeta({
  title: `Agent Lab | ${publicConfig.brandName}`,
  description: 'Chat-driven stills and short videos in your local workspace.',
})

selectHomeAgent()
await navigateTo('/')
</script>

<template>
  <div class="flex h-dvh items-center justify-center bg-background px-4 text-foreground">
    <Spinner class="size-5 text-muted-foreground" />
  </div>
</template>
