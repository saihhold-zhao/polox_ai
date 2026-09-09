<script setup lang="ts">
import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { useSidebar } from '~/components/ui/sidebar'

const { projects, loaded, loading, createProject } = useProjects()
const { setOpenMobile } = useSidebar()
const creating = ref(false)
const route = useRoute()
const MAX_RECENT_PROJECTS = 10
const hasMoreProjects = computed(() => projects.value.length > MAX_RECENT_PROJECTS)
async function onCreateProject() {
  if (creating.value)
    return
  creating.value = true
  try {
    const project = await createProject()
    setOpenMobile(false)
    await navigateTo(`/projects/${project.id}`)
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creating.value = false
  }
}
const recentProjects = computed(() => {
  return [...projects.value]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_RECENT_PROJECTS)
})
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel>
      Recent projects
    </SidebarGroupLabel>
    <nav aria-label="Recent projects">
      <SidebarMenu class="mb-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            tooltip="New project"
            :disabled="creating"
            :aria-busy="creating"
            @click="onCreateProject"
          >
            <Icon :name="creating ? 'i-lucide-loader-circle' : 'i-lucide-plus'" :class="{ 'animate-spin': creating }" />
            <span>{{ creating ? 'Creating…' : 'New project' }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu v-if="recentProjects.length" class="max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain">
        <SidebarMenuItem v-for="project in recentProjects" :key="project.id">
          <SidebarMenuButton
            as-child
            :tooltip="project.name"
            :is-active="route.path === `/projects/${project.id}`"
          >
            <NuxtLink :to="`/projects/${project.id}`" @click="setOpenMobile(false)">
              <Icon name="i-lucide-folder" />
              <span class="truncate">{{ project.name }}</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <p
        v-else
        class="px-2 py-2 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden"
        role="status"
      >
        {{ !loaded || loading ? 'Loading projects…' : 'No recent projects yet' }}
      </p>
      <NuxtLink
        v-if="hasMoreProjects"
        to="/projects"
        class="mt-1 flex items-center justify-between rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
        @click="setOpenMobile(false)"
      >
        View all
        <Icon name="i-lucide-arrow-right" class="size-3.5" />
      </NuxtLink>
    </nav>
  </SidebarGroup>
</template>
