<script setup lang="ts">
import type { FrontierModelCard } from '@/constants/aiModels'
import type { CatalogAgentSkill } from '~~/shared/utils/agentSkills'
import type { HandoffState } from '~/utils/agentComposerHandoff'
import { toast } from 'vue-sonner'
import { publicAgentModels } from '~~/shared/utils/agentModels'
import { PUBLIC_AGENT_SKILLS } from '~~/shared/utils/agentSkills'
import { SKETCH_TO_IMAGE_TOOL } from '~~/shared/utils/sketchToImage'
import HomeFrontierModels from '@/components/home/FrontierModels.vue'
import HomeRecentProjects from '@/components/home/RecentProjects.vue'
import HomeUsefulTools from '@/components/home/UsefulTools.vue'
import { draftHasSkillCommand, nextHandoffStep, normalizeHandoffSkillId } from '~/utils/agentComposerHandoff'

const COMPOSER_DRAFT_KEY = 'polox-agent-composer-draft'
const EDIT_BRIEF_KEY = 'polox-edit-skill-brief'

const { public: publicConfig } = useRuntimeConfig()
const route = useRoute()
const { selectHomeAgent } = useAgentWorkspaceNav()
const { selectedProjectId } = useProjects()
const { draft, ensureHydrated, sessionId } = useAgentLab({ projectId: selectedProjectId })

const agentComposer = useTemplateRef('agentComposer')
const pendingSkillCreatorEdit = ref(false)
const sessionDraftReapplied = ref(false)
/** Deep-link / card skill (/?agentSkill=…) — re-apply until the composer settles. */
const pendingAgentSkill = ref('')
/** Deep-link / card model (/?agentModel=…) — re-apply until the composer settles. */
const pendingAgentModel = ref('')
/** HomeAgentComposer finished its initial project resolve. */
const composerReady = ref(false)
let skillHandoff: HandoffState | null = null
let modelHandoff: HandoffState | null = null
let handoffTimer: ReturnType<typeof setTimeout> | undefined

function readStoredEditDraft() {
  if (!import.meta.client)
    return ''
  try {
    return String(sessionStorage.getItem(COMPOSER_DRAFT_KEY) || sessionStorage.getItem(EDIT_BRIEF_KEY) || '')
  }
  catch {
    return ''
  }
}

function clearStoredEditDraft() {
  if (!import.meta.client)
    return
  try {
    sessionStorage.removeItem(COMPOSER_DRAFT_KEY)
    sessionStorage.removeItem(EDIT_BRIEF_KEY)
  }
  catch {
    // Ignore private-mode / quota errors.
  }
}

function applyStoredEditDraft() {
  const text = readStoredEditDraft()
  if (!text)
    return false
  draft.value = text
  return true
}

function applyAndClearStoredEditDraft() {
  if (!applyStoredEditDraft())
    return false
  clearStoredEditDraft()
  pendingSkillCreatorEdit.value = false
  return true
}

async function waitForAgentComposer(attempts = 24) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (agentComposer.value?.mentionSkill || agentComposer.value?.mentionModel)
      return agentComposer.value
    await nextTick()
    // ~16ms poll; stop as soon as the exposed composer is ready (~400ms max).
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  return agentComposer.value
}

function draftHasModel(modelId: string) {
  const id = String(modelId || '').trim()
  if (!id)
    return false
  const model = publicAgentModels().find(item => item.id === id)
  if (!model)
    return false
  const text = String(draft.value || '')
  // Models that double as a skill (e.g. sketch) are inserted as `/id`.
  return text.includes(`(model:${model.id})`) || draftHasSkillCommand(text, model.id)
}

function draftHasSkill(skillId: string) {
  return draftHasSkillCommand(String(draft.value || ''), skillId)
}

async function selectAgentModel(modelId: string, scroll = true) {
  selectHomeAgent()
  const composer = await waitForAgentComposer()
  if (composer?.mentionModel)
    await composer.mentionModel(modelId)
  // Instant scroll — smooth animation delays when the input feels ready.
  if (scroll)
    document.getElementById('generator')?.scrollIntoView({ behavior: 'instant', block: 'start' })
}

async function selectAgentSkill(skillId: string, scroll = true) {
  selectHomeAgent()
  const composer = await waitForAgentComposer()
  if (composer?.mentionSkill)
    await composer.mentionSkill(skillId)
  if (scroll)
    document.getElementById('generator')?.scrollIntoView({ behavior: 'instant', block: 'start' })

  if (skillId !== 'skill-creator')
    return

  // Edit flow: mentionSkill alone races with project hydrate (which clears draft).
  // Prefer sessionStorage draft/brief set by Skills → Edit.
  pendingSkillCreatorEdit.value = Boolean(readStoredEditDraft())
  sessionDraftReapplied.value = false
  if (pendingSkillCreatorEdit.value)
    applyStoredEditDraft()
}

/** Builtins are always insertable; your own skills must be enabled (in the merged catalog). */
async function resolveDeepLinkSkill(skillId: string) {
  if (PUBLIC_AGENT_SKILLS.some(skill => skill.id === skillId))
    return true
  try {
    const data = await $fetch<{ catalog?: CatalogAgentSkill[] }>('/api/skills')
    if (Array.isArray(data.catalog) && data.catalog.some(skill => skill.id === skillId))
      return true
  }
  catch {
    // Fall through to the not-available notice.
  }
  toast.error(`/${skillId} isn't available. Enable it on the Skills page first.`)
  return false
}

// Handoff driver: keep the skill/model pending until the composer is ready AND the inserted
// command stayed put for a short window (project resolve / hydrate can wipe the first insert).
let applyingSkill = false
let applyingModel = false

async function applySkillHandoff(skillId: string, scroll: boolean) {
  if (applyingSkill)
    return
  applyingSkill = true
  try {
    await selectAgentSkill(skillId, scroll)
  }
  finally {
    applyingSkill = false
  }
  // Sketch opens its own project agent (navigates away) — never re-trigger it.
  if (skillId === SKETCH_TO_IMAGE_TOOL && pendingAgentSkill.value === skillId)
    clearSkillHandoff()
}

async function applyModelHandoff(modelId: string, scroll: boolean) {
  if (applyingModel)
    return
  applyingModel = true
  try {
    await selectAgentModel(modelId, scroll)
  }
  finally {
    applyingModel = false
  }
}

function clearSkillHandoff() {
  pendingAgentSkill.value = ''
  skillHandoff = null
}

function clearModelHandoff() {
  pendingAgentModel.value = ''
  modelHandoff = null
}

function scheduleHandoffTick(delay = 120) {
  if (!import.meta.client || handoffTimer)
    return
  if (!pendingAgentSkill.value && !pendingAgentModel.value)
    return
  handoffTimer = setTimeout(() => {
    handoffTimer = undefined
    runHandoffTick()
  }, delay)
}

function runHandoffTick() {
  const now = Date.now()
  const skillId = pendingAgentSkill.value
  if (skillId && skillHandoff) {
    const step = nextHandoffStep(skillHandoff, { now, present: draftHasSkill(skillId), composerReady: composerReady.value })
    skillHandoff = step.state
    if (step.action === 'apply') {
      void applySkillHandoff(skillId, false)
    }
    else if (step.action === 'done' || step.action === 'expire') {
      clearSkillHandoff()
      if (step.action === 'expire')
        toast.error(`Couldn't add /${skillId} to the composer. Type /${skillId} to use it.`)
    }
  }
  const modelId = pendingAgentModel.value
  if (modelId && modelHandoff) {
    const step = nextHandoffStep(modelHandoff, { now, present: draftHasModel(modelId), composerReady: composerReady.value })
    modelHandoff = step.state
    if (step.action === 'apply')
      void applyModelHandoff(modelId, false)
    else if (step.action === 'done' || step.action === 'expire')
      clearModelHandoff()
  }
  scheduleHandoffTick()
}

function startSkillHandoff(skillId: string) {
  // skill-creator edit briefs and sketch navigate / use their own flows — insert once.
  if (skillId === 'skill-creator' || skillId === SKETCH_TO_IMAGE_TOOL) {
    void selectAgentSkill(skillId)
    return
  }
  pendingAgentSkill.value = skillId
  skillHandoff = { startedAt: Date.now(), stableSince: null }
  // Insert immediately (fast UX); the tick loop re-applies after later wipes.
  void applySkillHandoff(skillId, true)
  scheduleHandoffTick()
}

function startModelHandoff(modelId: string) {
  pendingAgentModel.value = modelId
  modelHandoff = { startedAt: Date.now(), stableSince: null }
  void applyModelHandoff(modelId, true)
  scheduleHandoffTick()
}

function onComposerReady() {
  composerReady.value = true
  scheduleHandoffTick(0)
}

// User took over (homepage send): stop re-inserting.
function onComposerSendStart() {
  clearSkillHandoff()
  clearModelHandoff()
}

onBeforeUnmount(() => {
  if (handoffTimer)
    clearTimeout(handoffTimer)
  handoffTimer = undefined
})

onMounted(() => {
  selectHomeAgent()
  watch(() => route.query.agentSkill, async (raw) => {
    const skillId = normalizeHandoffSkillId(raw)
    if (!skillId)
      return
    const { agentSkill: _agentSkill, ...query } = route.query
    await navigateTo({ path: '/', query, hash: route.hash }, { replace: true })
    if (!(await resolveDeepLinkSkill(skillId)))
      return
    startSkillHandoff(skillId)
  }, { immediate: true })
  watch(() => route.query.agentTask, async (task) => {
    if (task !== 'image-to-image' && task !== 'reference-to-video')
      return
    const { agentTask: _agentTask, ...query } = route.query
    await navigateTo({ path: '/', query, hash: route.hash }, { replace: true })
    selectHomeAgent()
    await nextTick()
    document.getElementById('generator')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    await agentComposer.value?.mentionTask(task)
  }, { immediate: true })
  watch(() => route.query.agentModel || route.query.model, async (modelId) => {
    if (typeof modelId !== 'string' || !publicAgentModels().some(model => model.id === modelId))
      return
    const { agentModel: _agentModel, model: _model, ...query } = route.query
    await navigateTo({ path: '/', query, hash: route.hash || '#generator' }, { replace: true })
    startModelHandoff(modelId)
  }, { immediate: true })

  // If hydrate/runtime switch wipes the primed skill/model, re-apply right away.
  watch(draft, () => {
    const skillId = pendingAgentSkill.value
    const modelId = pendingAgentModel.value
    if ((skillId && !draftHasSkill(skillId)) || (modelId && !draftHasModel(modelId)))
      scheduleHandoffTick(0)
  })

  // Project hydrate clears composer draft — re-apply edit brief after ensureHydrated.
  watch(selectedProjectId, async () => {
    scheduleHandoffTick(0)
    if (!pendingSkillCreatorEdit.value && !readStoredEditDraft())
      return
    await ensureHydrated()
    if (readStoredEditDraft())
      applyAndClearStoredEditDraft()
  })

  // Once the agent session exists, re-apply once more if storage still has the draft.
  watch(sessionId, (id) => {
    if (!id)
      return
    scheduleHandoffTick(0)
    if (sessionDraftReapplied.value)
      return
    if (!pendingSkillCreatorEdit.value && !readStoredEditDraft())
      return
    sessionDraftReapplied.value = true
    if (readStoredEditDraft())
      applyAndClearStoredEditDraft()
  })
})

function selectFrontierModel(card: FrontierModelCard) {
  startModelHandoff(card.modelId)
}

useSeoMeta({
  title: `${publicConfig.brandName} | ${publicConfig.heroTitle} ${publicConfig.heroTagline}`,
  description: publicConfig.heroDescription,
  ogTitle: `${publicConfig.brandName} | ${publicConfig.heroTitle} ${publicConfig.heroTagline}`,
  ogDescription: publicConfig.heroDescription,
})
</script>

<template>
  <div class="relative isolate mx-auto flex w-full max-w-[1128px] flex-col gap-5 md:gap-6">
    <div class="relative">
      <HomeHeroVideoBackground />

      <div class="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        <h1 class="text-[2.55rem] font-semibold leading-[1.03] tracking-[-0.045em] text-balance text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)] md:text-[3.25rem]">
          <span class="block">{{ publicConfig.heroTitle }}</span>
          <span class="block">{{ publicConfig.heroTagline }}</span>
        </h1>
        <p class="max-w-2xl text-sm leading-relaxed text-balance text-white/80 drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] md:text-base">
          {{ publicConfig.heroDescription }}
        </p>
      </div>
    </div>

    <div class="relative z-10 w-full pt-3 md:pt-4">
      <div id="generator" class="flex flex-col gap-5 overflow-hidden rounded-2xl border border-border/70 bg-card/35 p-4 shadow-none backdrop-blur-xl supports-backdrop-filter:bg-card/25 md:gap-6 md:p-5">
        <HomeAgentComposer
          ref="agentComposer"
          embedded
          compact
          new-agent-on-send
          class="w-full"
          @ready="onComposerReady"
          @send-start="onComposerSendStart"
        />
      </div>
    </div>

    <HomeRecentProjects />

    <div class="flex flex-col gap-5 md:gap-6">
      <HomeSkills @select="startSkillHandoff" />
      <HomeFrontierModels @select="selectFrontierModel" />
      <HomeUsefulTools />
    </div>

    <a
      href="https://theresanaiforthat.com/ai/polox-ai/?ref=featured&v=8794914"
      target="_blank"
      rel="nofollow noopener noreferrer"
      class="mx-auto mt-1 inline-flex opacity-90 transition-opacity duration-150 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src="https://media.theresanaiforthat.com/featured-on-taaft.png?width=600"
        alt="Featured on There's An AI For That"
        width="180"
        height="54"
        class="h-auto w-[180px]"
      >
    </a>
  </div>
</template>
