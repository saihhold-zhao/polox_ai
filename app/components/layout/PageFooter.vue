<script setup lang="ts">
const { public: publicConfig } = useRuntimeConfig()
const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="mx-auto mt-10 mb-8 flex w-full max-w-[1128px] shrink-0 flex-col items-center gap-2 border-t border-border px-4 pt-6 text-center sm:px-6">
    <p class="text-[11px] leading-relaxed text-muted-foreground">
      © {{ currentYear }} {{ publicConfig.brandName }}. All rights reserved.
    </p>
  </footer>
</template>
