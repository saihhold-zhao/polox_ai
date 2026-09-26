<script setup lang="ts">
import type { GenerationJobPublic, GenerationJobsList } from '~~/shared/types/generation'
import type { ConfirmationPayload } from '~/composables/useAgentLab'
import { ChevronDown, Folder, FolderOpen, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DEFAULT_PROJECT_NAME } from '~~/shared/types/project'
import { readModelMentions } from '~~/shared/utils/agentModels'
import { readSkillCommands } from '~~/shared/utils/agentSkills'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { SKETCH_TO_IMAGE_TOOL } from '~~/shared/utils/sketchToImage'
import { draftHasSkillCreator, stripSkillCreatorCommand, useSkillCreatorLaunch } from '~/composables/useSkillCreatorLaunch'

const props = withDefaults(defineProps<{
  compact?: boolean
  embedded?: boolean
  newAgentOnSend?: boolean
}>(), {
  compact: false,
  embedded: false,
  newAgentOnSend: false,
})

const emit = defineEmits<{
  /** Initial project resolve finished; deep-link handoffs may settle after this. */
  ready: []
  /** User is sending from the homepage composer — pending deep-link handoffs must stop re-inserting. */
  sendStart: []
}>()
const { projects, selectedProjectId, createProject } = useProjects()
const { enterSelectedProject, resolveTargetProjectId } = useAgentWorkspaceNav()
const { createDraftAndOpenEditor, priming: primingSkillCreator } = useSkillCreatorLaunch()
const { sessionId: agentSessionId, messages, images, allImages, status, waitingForUserConfirm, waitingForUserChoice, pending, draft, attachments, attaching, error, sendMessage, stopAgent, stopping, attachFiles, attachUrls, removeAttachment, resolveConfirmation, resolveChoice, qualityPreference, confirmPolicy, agents, activeAgentId, canCreateAgent, canSwitchAgent, createAgent, selectAgent, queueNotice, ensureHydrated, flush } = useAgentLab({ projectId: selectedProjectId })
const hasSketch = computed(() =>
  readModelMentions(draft.value, true).includes(SKETCH_TO_IMAGE_TOOL)
  || readSkillCommands(draft.value).some(skill => skill.id === SKETCH_TO_IMAGE_TOOL),
)
const openingSketch = ref(false)

async function openSketchInProject() {
  if (openingSketch.value || !hasSketch.value)
    return
  const sketchDraft = draft.value
  const sketchAttachments = [...attachments.value]
  const sketchImages = images.value.filter(image => sketchAttachments.some(attachment => attachment.imageId === image.id))
  openingSketch.value = true
  try {
    const id = await resolveTargetProjectId()
    await ensureHydrated()
    if (!canCreateAgent.value)
      throw new Error('Cannot open a new sketch agent yet. Wait for the current turn or upload to finish, then try again.')
    // Keep uploaded references alive while createAgent clears the previous input.
    attachments.value = []
    createAgent()
    draft.value = sketchDraft
    attachments.value = sketchAttachments
    images.value = sketchImages
    qualityPreference.value = 'custom'
    // Persist the new agent + draft before route change so remote hydrate cannot
    // discard the empty agent and reselect an older conversation.
    flush()
    await navigateTo(`/projects/${encodeURIComponent(id)}?mode=agent`)
  }
  catch (error) {
    draft.value = sketchDraft
    attachments.value = sketchAttachments
    toast.error(readErrorMessage(error, 'Could not open the sketch in your project. Please try again.'))
  }
  finally {
    openingSketch.value = false
  }
}

// Only open when sketch becomes newly selected (homepage skill click).
// Do not re-open on mount when returning from a project that still has
// /sketch-to-image in the shared lab draft — that bounced users back into
// the waiting sketch agent.
watch(hasSketch, (selected, wasSelected) => {
  if (!selected || wasSelected)
    return
  void openSketchInProject()
})

const projectJobs = ref<GenerationJobPublic[]>([])
const projectAssetsLoading = ref(false)
const projectAssetsError = ref('')
let projectJobsController: AbortController | undefined
async function loadProjectAssets() {
  if (!import.meta.client || !selectedProjectId.value || projectAssetsLoading.value)
    return
  const projectId = selectedProjectId.value
  const controller = new AbortController()
  projectJobsController = controller
  projectAssetsLoading.value = true
  projectAssetsError.value = ''
  const loaded = new Map<string, GenerationJobPublic>()
  try {
    let page = 1
    const limit = 50
    while (true) {
      const data = await $fetch<GenerationJobsList>('/api/ai/jobs', {
        query: { projectId, page, limit },
        signal: controller.signal,
        timeout: 20000,
      })
      if (controller.signal.aborted || selectedProjectId.value !== projectId)
        return
      for (const job of data.items)
        loaded.set(job.taskId, job)
      projectJobs.value = [...loaded.values()]
      if (!data.items.length || page * limit >= data.total)
        break
      page++
    }
  }
  catch {
    if (!controller.signal.aborted)
      projectAssetsError.value = 'Could not load project assets. Close and reopen @ to retry.'
  }
  finally {
    if (projectJobsController === controller)
      projectAssetsLoading.value = false
  }
}
watch([selectedProjectId], () => {
  projectJobsController?.abort()
  projectJobsController = undefined
  projectJobs.value = []
  projectAssetsLoading.value = false
  projectAssetsError.value = ''
  void loadProjectAssets()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => projectJobsController?.abort())
const chat = useTemplateRef('chat')
async function mentionSkill(skillId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (chat.value?.mentionSkill) {
      await chat.value.mentionSkill(skillId)
      break
    }
    await nextTick()
  }
  // Homepage has no inline sketch canvas (sketch-in-project-only). Always try to
  // open/create the project sketch agent after inserting the skill — including
  // when /sketch-to-image was already in the draft (watch would no-op).
  if (skillId === SKETCH_TO_IMAGE_TOOL) {
    await nextTick()
    await openSketchInProject()
  }
}

defineExpose({
  mentionSkill,
  mentionModel: async (modelId: string) => {
    // Abort as soon as AgentLabChat exposes mentionModel (~400ms max).
    for (let attempt = 0; attempt < 24; attempt++) {
      if (chat.value?.mentionModel) {
        await chat.value.mentionModel(modelId)
        return
      }
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 16))
    }
  },
  mentionTask: async (task: string) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      if (chat.value?.mentionTask) {
        await chat.value.mentionTask(task)
        return
      }
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 16))
    }
  },
  openSketchInProject,
})
const projectReady = computed(() => Boolean(selectedProjectId.value))
const creatingProject = ref(false)
async function submitCreateProject() {
  if (creatingProject.value)
    return
  creatingProject.value = true
  try {
    await createProject()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creatingProject.value = false
  }
}
onMounted(async () => {
  try {
    await resolveTargetProjectId()
  }
  catch (error) {
    // Still report ready so homepage deep-link handoffs can settle (projects load later).
    console.error('[home-composer] resolve project', error)
  }
  finally {
    emit('ready')
  }
})
async function onSend() {
  if (hasSketch.value) {
    await openSketchInProject()
    return false
  }
  // Homepage /skill-creator must create a Skills draft + skill project,
  // not a normal studio project (back link would go to Projects).
  if (draftHasSkillCreator(draft.value)) {
    if (primingSkillCreator.value)
      return false
    const userPrompt = stripSkillCreatorCommand(draft.value)
    const opened = await createDraftAndOpenEditor({
      userPrompt,
      autosend: Boolean(userPrompt),
      placeholder: userPrompt ? undefined : 'Describe the skill you want to create…',
    })
    if (opened)
      draft.value = ''
    return Boolean(opened)
  }
  emit('sendStart')
  await resolveTargetProjectId()
  await nextTick()
  const sent = await sendMessage({ newAgent: props.newAgentOnSend })
  if (sent) {
    // Persist the new agent before route change so the project page hydrates it.
    flush()
    await enterSelectedProject()
  }
  return sent
}
async function onConfirm(params: ConfirmationPayload['params']) {
  void resolveConfirmation('confirm', params)
  await enterSelectedProject()
}
function onProjectChange(value: string | number) {
  selectedProjectId.value = String(value)
}
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <section
      class="overflow-hidden shadow-none"
      :class="embedded
        ? ''
        : 'rounded-2xl border border-border/70 bg-card/50 backdrop-blur-xl supports-backdrop-filter:bg-card/40'"
    >
      <div class="flex flex-col gap-3" :class="embedded ? '' : 'p-4 md:p-5'">
        <div
          v-if="projects.length"
          class="flex flex-wrap items-center gap-2"
        >
          <DropdownMenu :modal="false">
            <DropdownMenuTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="h-8 gap-1.5 border-border bg-muted/45 px-2.5 text-xs shadow-none hover:bg-accent"
              >
                <Folder class="size-3.5" />
                {{ projects.find(project => project.id === selectedProjectId)?.name || DEFAULT_PROJECT_NAME }}
                <ChevronDown class="size-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel class="w-full text-center font-bold">
                  Project
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  :model-value="selectedProjectId"
                  @update:model-value="onProjectChange"
                >
                  <DropdownMenuRadioItem
                    v-for="project in projects"
                    :key="project.id"
                    :value="project.id"
                  >
                    {{ project.name }}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="gap-2" :disabled="creatingProject" @select="submitCreateProject">
                  <Spinner v-if="creatingProject" class="size-3.5" />
                  <Plus v-else class="size-3.5" />
                  {{ creatingProject ? 'Creating…' : 'New project' }}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            class="h-8 gap-1.5 border-border bg-muted/45 px-2.5 text-xs shadow-none hover:bg-accent"
            :disabled="!selectedProjectId"
            @click="enterSelectedProject()"
          >
            <FolderOpen class="size-3.5" aria-hidden="true" />
            Open in project
          </Button>
        </div>

        <div
          class="relative"
          :class="compact || !messages.length
            ? 'overflow-hidden rounded-2xl border border-border'
            : 'h-[min(28rem,58vh)] overflow-hidden rounded-2xl border border-border'"
        >
          <div
            v-if="!projectReady"
            class="absolute inset-0 z-10 flex items-center justify-center bg-sidebar/80"
          >
            <Spinner class="size-5 text-muted-foreground" />
          </div>
          <AgentLabChat
            ref="chat"
            v-model:draft="draft"
            v-model:quality-preference="qualityPreference"
            v-model:confirm-policy="confirmPolicy"
            class="h-full"
            :messages="newAgentOnSend ? [] : messages"
            :session-id="newAgentOnSend ? '' : agentSessionId"
            :images="newAgentOnSend ? [] : images"
            :project-images="allImages"
            :project-jobs="projectJobs"
            :project-assets-loading="projectAssetsLoading"
            :project-assets-error="projectAssetsError"
            :attachments="attachments"
            sketch-in-project-only
            :status="newAgentOnSend ? 'idle' : status"
            :pending="newAgentOnSend ? false : pending"
            :attaching="attaching"
            :stopping="stopping"
            :error="error"

            :confirmation-open="!newAgentOnSend && waitingForUserConfirm"
            :choice-open="!newAgentOnSend && waitingForUserChoice"
            :queue-notice="newAgentOnSend ? '' : queueNotice"
            :agents="agents"
            :active-agent-id="activeAgentId"
            :can-create-agent="canCreateAgent"
            :can-switch-agent="canSwitchAgent"
            :composer-only="compact"
            :hide-transcript="!messages.length"
            @browse-assets="loadProjectAssets"

            @send="onSend"
            @open-sketch="openSketchInProject"
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
    </section>
  </div>
</template>
