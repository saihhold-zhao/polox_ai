<script setup lang="ts">
import type { GenerationJobPublic, GenerationJobsList } from '~~/shared/types/generation'
import type { GenerationProjectPublic } from '~~/shared/types/project'
import type { ConfirmationPayload } from '~/composables/useAgentLab'
import { ArrowLeft, Check, Pencil, X } from 'lucide-vue-next'
import { FetchError } from 'ofetch'
import { toast } from 'vue-sonner'
import { isGenerationActive } from '~~/shared/types/generation'
import { PROJECT_NAME_MAX } from '~~/shared/types/project'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectMoveJobDialog from '@/components/projects/ProjectMoveJobDialog.vue'
import { canvasMediaNavigationKey } from '~/composables/useCanvasMediaNavigation'

const canvas = ref<{
  focusMedia: (url: string) => Promise<boolean>
} | null>(null)
provide(canvasMediaNavigationKey, async (url) => {
  if (!await canvas.value?.focusMedia(url))
    toast.error('This file is no longer available on the canvas.')
})
definePageMeta({
  layout: 'studio',
})
const PAGE_SIZE = 50
const POLL_MS = 3000
const { public: publicConfig } = useRuntimeConfig()
const { projects, selectedProjectId, loadProjects } = useProjects()
const route = useRoute()
const nuxtApp = useNuxtApp()
const projectId = computed(() => String(route.params.id || ''))
const { sessionId: agentSessionId, messages, images, status, waitingForUserConfirm, waitingForUserChoice, pending: agentPending, draft, attachments, attaching, error: agentError, sendMessage, stopAgent, stopping, attachFiles, attachUrls, removeAttachment, resolveConfirmation, resolveChoice, qualityPreference, confirmPolicy, agents, activeAgentId, canCreateAgent, canSwitchAgent, createAgent, selectAgent, queueNotice, applyCanvasJobs } = useAgentLab({
  projectId,
  onJobs(jobs) {
    for (const job of jobs)
      onJobCreated(job)
  },
})
const project = ref<GenerationProjectPublic | null>(null)
const items = ref<GenerationJobPublic[]>([])
const total = ref(0)
const loading = ref(false)
const deletingTaskId = ref<string | null>(null)
const deleteConfirmOpen = ref(false)
const pendingDeleteTaskId = ref('')
const moveOpen = ref(false)
const movingTaskId = ref<string | null>(null)
const pendingMoveTaskId = ref('')
const otherProjects = computed(() => projects.value.filter(item => item.id && item.id !== projectId.value))
let loadToken = 0
let jobsController: AbortController | undefined
let jobsInFlight = false
const title = computed(() => project.value?.name || 'Project')
const description = computed(() => project.value?.description || '')
const canRename = computed(() => Boolean(project.value && !project.value.isDefault))
const renaming = ref(false)
const renameDraft = ref('')
const renamingSaving = ref(false)
const renameInputRef = ref<{
  $el?: HTMLInputElement
} | null>(null)
useSeoMeta({
  title: () => `${title.value} · ${publicConfig.brandName}`,
  description: 'Project generations',
})
async function loadProject() {
  if (!projectId.value)
    return
  try {
    project.value = await $fetch<GenerationProjectPublic>(`/api/projects/${projectId.value}`)
    selectedProjectId.value = project.value.id
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load this project')
    await nuxtApp.runWithContext(() => navigateTo('/projects'))
  }
}
async function loadJobs(silent = false) {
  if (silent && jobsInFlight)
    return
  if (!projectId.value) {
    jobsController?.abort()
    loadToken++
    items.value = []
    total.value = 0
    return
  }
  jobsController?.abort()
  const controller = new AbortController()
  jobsController = controller
  jobsInFlight = true
  const token = ++loadToken
  if (!silent)
    loading.value = true
  try {
    const loaded = new Map<string, GenerationJobPublic>()
    const initialIds = new Set(items.value.map(job => job.taskId))
    const requestedProjectId = projectId.value
    let batch = 1
    let expected = 0
    do {
      const data = await $fetch<GenerationJobsList>('/api/ai/jobs', {
        signal: controller.signal,
        timeout: 20000,
        query: { page: batch, limit: PAGE_SIZE, projectId: requestedProjectId },
      })
      if (token !== loadToken || requestedProjectId !== projectId.value)
        return
      expected = data.total
      for (const job of data.items.filter(job => jobBelongsToCurrentProject(job)))
        loaded.set(job.taskId, job)
      // Show each batch immediately, preserving older assets until the scan finishes.
      const current = new Map(items.value.map(job => [job.taskId, job]))
      for (const [id, job] of loaded)
        current.set(id, job)
      items.value = [...current.values()]
      total.value = expected
      if (!data.items.length)
        break
      batch++
    } while ((batch - 1) * PAGE_SIZE < expected)
    if (token === loadToken) {
      // Keep new local results created while this scan was in flight.
      for (const job of items.value) {
        if (!initialIds.has(job.taskId) && !loaded.has(job.taskId))
          loaded.set(job.taskId, job)
      }
      items.value = [...loaded.values()]
    }
  }
  catch (error) {
    if (!silent && !controller.signal.aborted)
      toast.error(error instanceof Error ? error.message : 'Could not load generations')
  }
  finally {
    if (token === loadToken) {
      jobsInFlight = false
      loading.value = false
    }
  }
}
function jobBelongsToCurrentProject(job: GenerationJobPublic) {
  const id = String(job.projectId || '')
  if (id === projectId.value)
    return true
  if (id)
    return false
  return !project.value || Boolean(project.value.isDefault)
}
function onJobCreated(job: GenerationJobPublic) {
  if (!jobBelongsToCurrentProject(job))
    return
  const exists = items.value.some(item => item.taskId === job.taskId)
  items.value = [job, ...items.value.filter(item => item.taskId !== job.taskId)]
  if (!exists)
    total.value += 1
}
const bulkAction = ref<'move' | 'delete' | null>(null)
const bulkTaskIds = ref<string[]>([])
const bulkPending = ref(false)
function requestBulk(action: 'move' | 'delete', ids: string[]) {
  if (bulkPending.value)
    return
  bulkTaskIds.value = [...new Set(ids)]
  bulkAction.value = action
}
async function confirmBulk(targetProjectId?: string) {
  if (bulkPending.value || !bulkAction.value)
    return
  const action = bulkAction.value
  if (action === 'move' && !targetProjectId)
    return
  bulkPending.value = true
  const failed: string[] = []
  for (const taskId of bulkTaskIds.value) {
    try {
      if (action === 'move')
        await $fetch(`/api/ai/jobs/${taskId}`, { method: 'PATCH', body: { projectId: targetProjectId } })
      else
        await $fetch(`/api/ai/jobs/${taskId}`, { method: 'DELETE' })
      removeAgentResult(taskId)
      items.value = items.value.filter(job => job.taskId !== taskId)
      total.value = Math.max(0, total.value - 1)
    }
    catch {
      failed.push(taskId)
    }
  }
  bulkTaskIds.value = failed
  bulkPending.value = false
  if (failed.length)
    toast.error(`${failed.length} results could not be ${action === 'move' ? 'moved' : 'deleted'}. Retry to process only these results.`)
  else
    bulkAction.value = null
  const refreshed = await Promise.allSettled([loadJobs(true), loadProjects()])
  if (refreshed.some(result => result.status === 'rejected'))
    toast.error('Could not refresh the project. Reload to see the latest results.')
}
function requestDelete(taskId: string) {
  const job = items.value.find(item => item.taskId === taskId)
  if (job && isGenerationActive(job.state))
    return
  pendingDeleteTaskId.value = taskId
  deleteConfirmOpen.value = true
}
function requestMove(taskId: string) {
  if (!otherProjects.value.length)
    return
  pendingMoveTaskId.value = taskId
  moveOpen.value = true
}
function removeAgentResult(taskId: string) {
  const urls = new Set(items.value.find(job => job.taskId === taskId)?.resultUrls || [])
  images.value = images.value.filter(image => `agent_${image.id}`.slice(0, 120) !== taskId
    && image.providerTaskId !== taskId
    && (!image.url || !urls.has(image.url)))
}
async function confirmMove(targetProjectId: string) {
  const taskId = pendingMoveTaskId.value
  if (!taskId || movingTaskId.value || !targetProjectId)
    return
  movingTaskId.value = taskId
  try {
    await $fetch(`/api/ai/jobs/${taskId}`, {
      method: 'PATCH',
      body: { projectId: targetProjectId },
    })
    removeAgentResult(taskId)
    items.value = items.value.filter(job => job.taskId !== taskId)
    total.value = Math.max(0, total.value - 1)
    moveOpen.value = false
    pendingMoveTaskId.value = ''
    await Promise.all([loadJobs(true), loadProjects()])
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not move this result')
  }
  finally {
    movingTaskId.value = null
  }
}
async function confirmDelete() {
  const taskId = pendingDeleteTaskId.value
  if (!taskId || deletingTaskId.value)
    return
  deletingTaskId.value = taskId
  try {
    await $fetch(`/api/ai/jobs/${taskId}`, { method: 'DELETE' })
    removeAgentResult(taskId)
    items.value = items.value.filter(job => job.taskId !== taskId)
    total.value = Math.max(0, total.value - 1)
    deleteConfirmOpen.value = false
    pendingDeleteTaskId.value = ''
    if (items.value.length === 0)
      await loadJobs()
  }
  catch (error) {
    if (error instanceof FetchError && error.statusCode === 404) {
      removeAgentResult(taskId)
      items.value = items.value.filter(job => job.taskId !== taskId)
      deleteConfirmOpen.value = false
    }
    else {
      toast.error(readErrorMessage(error, 'Could not delete this result'))
    }
  }
  finally {
    deletingTaskId.value = null
  }
}
function focusRenameInput() {
  nextTick(() => {
    const input = renameInputRef.value?.$el
    input?.focus()
    input?.select()
  })
}
function startRename() {
  if (!canRename.value || !project.value || renamingSaving.value)
    return
  renameDraft.value = project.value.name
  renaming.value = true
  focusRenameInput()
}
function cancelRename() {
  if (renamingSaving.value)
    return
  renaming.value = false
  renameDraft.value = ''
}
function onRenameInputFocus(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLInputElement)
    target.select()
}
async function saveRename() {
  if (!project.value || renamingSaving.value || !canRename.value)
    return
  const name = renameDraft.value.trim()
  if (!name) {
    toast.error('Title is required')
    focusRenameInput()
    return
  }
  if (name === project.value.name) {
    renaming.value = false
    return
  }
  renamingSaving.value = true
  try {
    const updated = await $fetch<GenerationProjectPublic>(`/api/projects/${project.value.id}`, {
      method: 'PATCH',
      body: {
        name,
        description: project.value.description,
      },
    })
    project.value = { ...project.value, ...updated }
    projects.value = projects.value.map(item => item.id === updated.id ? { ...item, ...updated } : item)
    renaming.value = false
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not rename the project'))
    focusRenameInput()
  }
  finally {
    renamingSaving.value = false
  }
}
onMounted(() => {
  void loadProject()
  void loadJobs()
})
onBeforeUnmount(() => {
  loadToken++
  jobsController?.abort()
})
watch(projectId, () => {
  items.value = []
  renaming.value = false
  renameDraft.value = ''
  void loadProject()
  void loadJobs()
})
useIntervalFn(() => {
  if (import.meta.server)
    return
  if (document.visibilityState !== 'visible') {
    return
  }
  void loadJobs(true)
}, POLL_MS)
watch(items, (jobs) => {
  applyCanvasJobs(jobs)
}, { immediate: true, deep: true })
async function onConfirm(params: ConfirmationPayload['params']) {
  await resolveConfirmation('confirm', params)
}
function onAttachCanvas(payload: {
  urls: string[]
  prompt: string
}) {
  attachUrls(payload.urls.map(url => ({
    url,
    name: payload.prompt.trim() || 'Canvas still',
  })))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex h-[54px] shrink-0 items-center justify-between border-b border-border px-4">
      <div class="flex min-w-0 items-center gap-3">
        <Button as-child variant="ghost" size="sm" class="rounded-lg">
          <NuxtLink to="/projects">
            <ArrowLeft data-icon="inline-start" />
            Projects
          </NuxtLink>
        </Button>
        <Separator orientation="vertical" class="h-5" />
        <form
          v-if="renaming"
          class="flex min-w-0 flex-1 items-center gap-1"
          @submit.prevent="saveRename"
        >
          <Input
            ref="renameInputRef"
            v-model="renameDraft"
            :maxlength="PROJECT_NAME_MAX"
            :disabled="renamingSaving"
            required
            aria-label="Project name"
            class="h-8 min-w-0 max-w-64 flex-1 rounded-lg bg-input/30 shadow-none"
            @focus="onRenameInputFocus"
            @keydown.esc.prevent="cancelRename"
          />
          <Button
            type="submit"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg shadow-none"
            :disabled="renamingSaving || !renameDraft.trim()"
            aria-label="Save name"
          >
            <Check class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg"
            :disabled="renamingSaving"
            aria-label="Cancel rename"
            @click="cancelRename"
          >
            <X class="size-3.5" />
          </Button>
        </form>
        <div
          v-else
          class="flex min-w-0 items-center gap-1"
        >
          <div class="min-w-0">
            <h1 class="truncate text-sm font-medium tracking-tight">
              {{ title }}
            </h1>
            <p
              v-if="description"
              class="truncate text-[11px] text-muted-foreground"
            >
              {{ description }}
            </p>
          </div>
          <Button
            v-if="canRename"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-7 shrink-0 rounded-lg text-muted-foreground"
            title="Rename"
            aria-label="Rename project"
            @click="startRename"
          >
            <Pencil class="size-3.5" />
          </Button>
        </div>
      </div>
      <ServiceConnection />
    </header>

    <StudioSplit>
      <template #left>
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-hidden">
            <AgentLabChat
              v-model:draft="draft"
              v-model:quality-preference="qualityPreference"
              v-model:confirm-policy="confirmPolicy"
              :messages="messages"
              :session-id="agentSessionId"
              :images="images"
              :project-jobs="items"
              :attachments="attachments"
              :status="status"
              :pending="agentPending"
              :attaching="attaching"
              :stopping="stopping"
              :error="agentError"

              :confirmation-open="waitingForUserConfirm"
              :choice-open="waitingForUserChoice"
              :queue-notice="queueNotice"
              :agents="agents"
              :active-agent-id="activeAgentId"
              :can-create-agent="canCreateAgent"
              :can-switch-agent="canSwitchAgent"

              @send="sendMessage"
              @stop="stopAgent"
              @attach="attachFiles"
              @attach-asset="attachUrls"
              @remove-attachment="removeAttachment"
              @confirm="onConfirm"
              @cancel="resolveConfirmation('cancel')"
              @submit-choice="resolveChoice('submit', $event)"
              @skip-choice="resolveChoice('skip')"
              @create-agent="createAgent"
              @select-agent="selectAgent"
            />
          </div>
        </div>
      </template>

      <template #right>
        <section
          class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
          aria-label="Canvas"
        >
          <AgentLabInfiniteCanvas
            ref="canvas"
            :key="projectId"
            :project-id="projectId"
            :jobs="items"
            :images="images"
            :loading="loading"
            :deleting-task-id="deletingTaskId"
            :show-move="otherProjects.length > 0"
            show-attach
            @delete="requestDelete"
            @delete-many="requestBulk('delete', $event)"
            @move-many="requestBulk('move', $event)"
            @move="requestMove"
            @attach="onAttachCanvas"
          />
        </section>
      </template>
    </StudioSplit>

    <AiGeneratorDeleteDialog :open="bulkAction === 'delete'" :count="bulkTaskIds.length" :pending="bulkPending" @update:open="!$event && (bulkAction = null)" @confirm="confirmBulk()" />
    <ProjectMoveJobDialog :open="bulkAction === 'move'" :count="bulkTaskIds.length" :pending="bulkPending" :projects="otherProjects" @update:open="!$event && (bulkAction = null)" @confirm="confirmBulk" />
    <AiGeneratorDeleteDialog
      :open="deleteConfirmOpen"
      :pending="Boolean(deletingTaskId)"
      @update:open="deleteConfirmOpen = $event"
      @confirm="confirmDelete"
    />

    <ProjectMoveJobDialog
      :open="moveOpen"
      :pending="Boolean(movingTaskId)"
      :projects="otherProjects"
      @update:open="moveOpen = $event"
      @confirm="confirmMove"
    />
  </div>
</template>
