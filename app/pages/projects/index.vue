<script setup lang="ts">
import type { GenerationProjectPublic } from '~~/shared/types/project'
import { toast } from 'vue-sonner'
import { nextProjectTitle, PROJECT_DELETE_CONFIRMATION, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX } from '~~/shared/types/project'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectCard from '@/components/projects/ProjectCard.vue'
import ProjectDeleteDialog from '@/components/projects/ProjectDeleteDialog.vue'

const POLL_MS = 3000
const { public: publicConfig } = useRuntimeConfig()

const { projects, selectedProjectId, loaded, loadProjects } = useProjects()
useSeoMeta({
  title: `Projects · ${publicConfig.brandName}`,
  description: 'Your generation projects',
})
const hasActiveJobs = computed(() => projects.value.some(project => project.activeJobCount > 0))
const createOpen = ref(false)
const creating = ref(false)
const createName = ref('')
const createDescription = ref('')
const editOpen = ref(false)
const editing = ref(false)
const editingProject = ref<GenerationProjectPublic | null>(null)
const editName = ref('')
const editDescription = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deletingProject = ref<GenerationProjectPublic | null>(null)
onMounted(() => {
  void loadProjects()
})
useIntervalFn(() => {
  if (import.meta.server)
    return
  if (document.visibilityState !== 'visible') {
    return
  }
  if (!hasActiveJobs.value)
    return
  void loadProjects()
}, POLL_MS)
function openCreate() {
  createName.value = nextProjectTitle(projects.value.map(project => project.name))
  createDescription.value = ''
  createOpen.value = true
}
function openEdit(project: GenerationProjectPublic) {
  if (project.isDefault)
    return
  editingProject.value = project
  editName.value = project.name
  editDescription.value = project.description
  editOpen.value = true
}
function openDelete(project: GenerationProjectPublic) {
  if (project.isDefault)
    return
  deletingProject.value = project
  deleteOpen.value = true
}
async function submitCreate() {
  if (creating.value)
    return
  creating.value = true
  try {
    const project = await $fetch<GenerationProjectPublic>('/api/projects', {
      method: 'POST',
      body: {
        name: createName.value,
        description: createDescription.value,
      },
    })
    projects.value = [project, ...projects.value.filter(item => item.id !== project.id)]
    selectedProjectId.value = project.id
    createOpen.value = false
    await navigateTo(`/projects/${project.id}`)
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creating.value = false
  }
}
async function submitEdit() {
  if (editing.value || !editingProject.value)
    return
  editing.value = true
  try {
    const project = await $fetch<GenerationProjectPublic>(`/api/projects/${editingProject.value.id}`, {
      method: 'PATCH',
      body: {
        name: editName.value,
        description: editDescription.value,
      },
    })
    projects.value = projects.value.map(item => item.id === project.id ? { ...item, ...project } : item)
    editOpen.value = false
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not update the project'))
  }
  finally {
    editing.value = false
  }
}
async function confirmDelete() {
  if (deleting.value || !deletingProject.value)
    return
  deleting.value = true
  try {
    const result = await $fetch<{
      ok: boolean
      defaultProjectId: string
    }>(`/api/projects/${deletingProject.value.id}`, {
      method: 'DELETE',
      body: {
        confirmation: PROJECT_DELETE_CONFIRMATION,
      },
    })
    const removedId = deletingProject.value.id
    projects.value = projects.value.filter(item => item.id !== removedId)
    if (selectedProjectId.value === removedId)
      selectedProjectId.value = result.defaultProjectId
    deleteOpen.value = false
    await loadProjects()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not delete the project'))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1128px] flex-col gap-5">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex flex-col gap-1">
        <p class="text-sm text-muted-foreground">
          Projects
        </p>
        <h1 class="text-2xl font-semibold tracking-tight">
          Projects
        </h1>
      </div>
      <Button
        type="button"
        class="h-9 shrink-0 rounded-lg px-3 shadow-none"
        @click="openCreate"
      >
        New project
      </Button>
    </div>

    <div
      v-if="!loaded && projects.length === 0"
      class="flex justify-center py-12"
    >
      <Spinner class="size-6 text-muted-foreground" />
    </div>

    <p
      v-else-if="projects.length === 0"
      class="rounded-2xl border border-border bg-muted/35 px-4 py-8 text-center text-sm text-muted-foreground"
    >
      No projects yet.
    </p>

    <div
      v-else
      class="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :show-actions="!project.isDefault"
        @edit="openEdit(project)"
        @delete="openDelete(project)"
      />
    </div>

    <Dialog v-model:open="createOpen">
      <DialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
        <DialogHeader class="gap-1">
          <DialogTitle>
            New project
          </DialogTitle>
          <DialogDescription>
            Give this project a title. A description is optional.
          </DialogDescription>
        </DialogHeader>

        <form
          class="flex flex-col gap-4"
          @submit.prevent="submitCreate"
        >
          <FieldGroup>
            <Field>
              <FieldLabel html-for="project-name">
                Title
              </FieldLabel>
              <Input
                id="project-name"
                v-model="createName"
                :maxlength="PROJECT_NAME_MAX"
                required
                class="h-9 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
            <Field>
              <FieldLabel html-for="project-description">
                Description
                <span class="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="project-description"
                v-model="createDescription"
                rows="3"
                :maxlength="PROJECT_DESCRIPTION_MAX"
                placeholder="What this project is for"
                class="min-h-20 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="creating"
              @click="createOpen = false"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="creating"
            >
              {{ creating ? 'Creating…' : 'Create' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="editOpen">
      <DialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
        <DialogHeader class="gap-1">
          <DialogTitle>
            Edit project
          </DialogTitle>
          <DialogDescription>
            Update the title and description.
          </DialogDescription>
        </DialogHeader>

        <form
          class="flex flex-col gap-4"
          @submit.prevent="submitEdit"
        >
          <FieldGroup>
            <Field>
              <FieldLabel html-for="edit-project-name">
                Title
              </FieldLabel>
              <Input
                id="edit-project-name"
                v-model="editName"
                :maxlength="PROJECT_NAME_MAX"
                required
                class="h-9 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
            <Field>
              <FieldLabel html-for="edit-project-description">
                Description
                <span class="font-normal text-muted-foreground">
                  (optional)
                </span>
              </FieldLabel>
              <Textarea
                id="edit-project-description"
                v-model="editDescription"
                rows="3"
                :maxlength="PROJECT_DESCRIPTION_MAX"
                placeholder="What this project is for"
                class="min-h-20 rounded-xl bg-input/30 shadow-none"
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="editing"
              @click="editOpen = false"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              class="h-8 rounded-lg px-3 text-xs shadow-none"
              :disabled="editing"
            >
              {{ editing ? 'Saving…' : 'Save' }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <ProjectDeleteDialog
      :open="deleteOpen"
      :pending="deleting"
      :project-name="deletingProject?.name"
      @update:open="deleteOpen = $event"
      @confirm="confirmDelete"
    />
  </div>
</template>
