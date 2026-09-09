<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import ProjectCard from '@/components/projects/ProjectCard.vue'

const MAX_RECENT_PROJECTS = 10
const { projects, loaded, loadProjects } = useProjects()
const recentProjects = computed(() => {
  return [...projects.value]
    .filter(project => project.assetCount > 0 || project.activeJobCount > 0)
    .sort((a, b) => {
      const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      if (byUpdated)
        return byUpdated
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    .slice(0, MAX_RECENT_PROJECTS)
})
onMounted(() => {
  void loadProjects()
})
</script>

<template>
  <section
    v-if="loaded && recentProjects.length"
    class="flex flex-col gap-4"
    aria-labelledby="recent-projects-heading"
  >
    <div class="flex items-end justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2
          id="recent-projects-heading"
          class="text-2xl font-semibold tracking-tight md:text-3xl"
        >
          Recent projects
        </h2>
      </div>
      <Button
        as-child
        variant="outline"
        class="h-8 shrink-0 rounded-lg px-3 text-xs shadow-none"
      >
        <NuxtLink to="/projects">
          View all projects
          <ArrowRight class="size-3.5" aria-hidden="true" />
        </NuxtLink>
      </Button>
    </div>

    <div class="-mx-1 flex gap-3 overflow-x-auto overscroll-x-contain px-1 pb-1 snap-x snap-mandatory no-scrollbar">
      <ProjectCard
        v-for="project in recentProjects"
        :key="project.id"
        :project="project"
        class="w-64 shrink-0 snap-start"
      />
    </div>
  </section>
</template>
