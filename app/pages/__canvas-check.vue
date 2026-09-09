<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const jobs = Array.from({ length: 2 }, (_, index) => ({
  taskId: `canvas-fixture-${index}`,
  projectId: String(route.query.project),
  model: 'Verification model',
  category: 'Image',
  task: 'Image generation',
  prompt: index ? 'A failed image generation, with inspectable details.' : 'A blue illustration, ready to resize and move.',
  input: { aspect_ratio: '1:1', resolution: '1K' },
  state: index ? 'fail' as const : 'success' as const,
  resultUrls: index ? [] : [`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#dcebf5"/><rect x="90" y="70" rx="80" width="220" height="260" fill="#3574a1"/></svg>')}`],
  failCode: '',
  failMsg: index ? 'fetch failed' : '',
  createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '',
  completedAt: '',

}))
</script>

<template>
  <div class="flex h-screen flex-col">
    <h1 class="border-b p-3">
      Canvas verification
    </h1>
    <AgentLabInfiniteCanvas :jobs="jobs" :images="[]" :project-id="String(route.query.project)" show-attach show-move />
  </div>
</template>
