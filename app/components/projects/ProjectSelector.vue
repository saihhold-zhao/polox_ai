<script setup lang="ts">
import { ChevronDown, Folder, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DEFAULT_PROJECT_NAME } from '~~/shared/types/project'
import { readErrorMessage } from '~~/shared/utils/apiError'

defineProps<{
  disabled?: boolean
}>()
const { projects, selectedProjectId, createProject, loading } = useProjects()
const creating = ref(false)
const mounted = ref(false)
onMounted(() => { mounted.value = true })
async function onCreate() {
  creating.value = true
  try {
    await createProject()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="text-xs text-muted-foreground">Project</span>
    <DropdownMenu :modal="false">
      <DropdownMenuTrigger as-child>
        <Button type="button" variant="outline" size="sm" class="gap-1.5" :disabled="!mounted || disabled || loading || creating" aria-label="Select project">
          <Folder class="size-3.5" />
          {{ projects.find(project => project.id === selectedProjectId)?.name || DEFAULT_PROJECT_NAME }}
          <ChevronDown class="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-48">
        <DropdownMenuLabel>Project</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup v-model="selectedProjectId">
          <DropdownMenuRadioItem v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem :disabled="creating" @select="onCreate">
          <Plus class="mr-2 size-3.5" /> New project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
