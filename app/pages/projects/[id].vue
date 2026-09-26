<script setup lang="ts">
import { draftHasSkillCreator, stripSkillCreatorCommand, useSkillCreatorLaunch } from '~/composables/useSkillCreatorLaunch'
import { isMediaAudioUrl, isMediaDocumentUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { IDEOGRAM_REMOVE_BACKGROUND_MODEL } from '~~/shared/utils/ideogram'
import type { GenerationJobPublic, GenerationJobsList } from '~~/shared/types/generation'
import type { GenerationProjectPublic } from '~~/shared/types/project'
import type { ConfirmationPayload } from '~/composables/useAgentLab'
import { ArrowLeft, Check, Pencil, X } from 'lucide-vue-next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FetchError } from 'ofetch'
import { toast } from 'vue-sonner'
import { isGenerationActive } from '~~/shared/types/generation'
import { PROJECT_NAME_MAX } from '~~/shared/types/project'
import { readErrorMessage } from '~~/shared/utils/apiError'
import ProjectMoveJobDialog from '@/components/projects/ProjectMoveJobDialog.vue'
import AssetLibraryImportDialog from '@/components/asset-libraries/AssetLibraryImportDialog.vue'
import { canvasMediaNavigationKey } from '~/composables/useCanvasMediaNavigation'

const canvas = ref<{ focusMedia: (url: string) => Promise<boolean>, hideAsset: (id: string) => Promise<void> } | null>(null)
const chat = ref<{ mentionModel: (id: string) => Promise<void> | void, mentionSkill: (id: string) => Promise<void> | void } | null>(null)
const split = ref<{ maximizeAgent: () => void } | null>(null)

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
const { projects, selectedProjectId, loadProjects, ensureSkillProject } = useProjects()
const route = useRoute()
const nuxtApp = useNuxtApp()

const projectId = computed(() => String(route.params.id || ''))
const {
  sessionId: agentSessionId,
  messages,
  images,
  allImages,
  status,
  waitingForUserConfirm,
  waitingForUserChoice,
  pending: agentPending,
  draft,
  attachments,
  attaching,
  error: agentError,
  sendMessage,
  stopAgent,
  stopping,
  attachFiles,
  uploadAnnotationImage,
  attachUrls,
  removeAttachment,
  resolveConfirmation,
  resolveChoice,
  qualityPreference,
  confirmPolicy,
  agents,
  activeAgentId,
  canCreateAgent,
  canSwitchAgent,
  createAgent,
  selectAgent,
  ensureNamedAgent,
  queueNotice,
  applyCanvasJobs,
} = useAgentLab({
  projectId,
  onJobs(jobs) {
    for (const job of jobs)
      onJobCreated(job)
  },
})

const project = ref<GenerationProjectPublic | null>(null)

const COMPOSER_DRAFT_KEY = 'polox-agent-composer-draft'
const EDIT_BRIEF_KEY = 'polox-edit-skill-brief'
const EDIT_PLACEHOLDER_KEY = 'polox-edit-skill-placeholder'
const SKILL_TEST_ID_KEY = 'polox-skill-test-id'
const SKILL_TEST_NAME_KEY = 'polox-skill-test-name'

const SKILL_EDIT_AGENT = 'Edit'
const SKILL_TEST_AGENT = 'Test'
const AUTOSEND_KEY = 'polox-skill-creator-autosend'
const AUTOSEND_PROMPT_KEY = 'polox-skill-creator-autosend-prompt'

const {
  createDraftAndOpenEditor,
  priming: primingSkillCreator,
} = useSkillCreatorLaunch()

type SkillMode = 'edit' | 'test'

function readSkillModeQuery(raw: unknown): SkillMode | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'test' || value === 'edit' ? value : null
}

const skillMode = ref<SkillMode>(readSkillModeQuery(route.query.skillMode) || 'edit')
const skillModeReady = ref(false)

// Same-route navigate (Edit → Test) does not remount; keep skillMode in sync with the URL.
watch(
  () => readSkillModeQuery(route.query.skillMode),
  (modeQ) => {
    if (modeQ && modeQ !== skillMode.value)
      skillMode.value = modeQ
  },
)

const isSkillProject = computed(() => project.value?.kind === 'skill')

const boundSkillId = computed(() => {
  const fromProject = String(project.value?.skillId || '').trim()
  if (fromProject)
    return fromProject
  if (!import.meta.client)
    return ''
  try {
    return String(sessionStorage.getItem(SKILL_TEST_ID_KEY) || '').trim()
  }
  catch {
    return ''
  }
})


const boundSkillStatus = ref<'draft' | 'published' | ''>('')
const boundSkillStatusReady = ref(false)

const canTestSkill = computed(() => {
  // After Enable & test, keep Test tab visible while project.kind / status hydrate.
  if (import.meta.client) {
    try {
      if (sessionStorage.getItem('polox-force-skill-mode') === 'test')
        return true
    }
    catch {}
  }
  if (readSkillModeQuery(route.query.skillMode) === 'test')
    return true
  if (!isSkillProject.value)
    return false
  if (!boundSkillId.value)
    return false
  // First load: hide Test until status arrives. Later refreshes must not flip this off —
  // that unmounts the Test tab mid-run (model-value stays "test").
  if (!boundSkillStatusReady.value && !boundSkillStatus.value)
    return false
  return boundSkillStatus.value !== 'draft'
})

/** Keep Test trigger mounted while already testing, even if status briefly reloads. */
const showTestTab = computed(() => canTestSkill.value || skillMode.value === 'test')

async function refreshBoundSkillStatus() {
  const id = boundSkillId.value
  if (!isSkillProject.value || !id) {
    boundSkillStatus.value = ''
    boundSkillStatusReady.value = true
    return
  }
  // Do not clear ready on refetch — that made canTestSkill false and removed the Test tab
  // while skillMode was still "test" (tabs looked gone during generation).
  const hadReady = boundSkillStatusReady.value
  if (!hadReady)
    boundSkillStatusReady.value = false
  let fetched = false
  try {
    const data = await $fetch<{ status?: string }>(`/api/skills/${encodeURIComponent(id)}`)
    boundSkillStatus.value = data.status === 'draft' ? 'draft' : 'published'
    fetched = true
  }
  catch {
    // Network/404 during hard refresh must not force-leave Test. Keep prior status
    // (or treat as published for Test eligibility until a real draft response arrives).
    if (!boundSkillStatus.value)
      boundSkillStatus.value = 'published'
  }
  finally {
    boundSkillStatusReady.value = true
    // Only demote Test → Edit when the API explicitly says draft.
    if (fetched && skillMode.value === 'test' && boundSkillStatus.value === 'draft')
      await activateSkillMode('edit')
  }
}

watch(
  () => [isSkillProject.value, boundSkillId.value] as const,
  () => {
    void refreshBoundSkillStatus()
  },
  { immediate: true },
)

const skillEditFocus = computed(() => {
  const mode = skillMode.value === 'test' ? 'test' : 'edit'
  if (mode !== 'edit')
    return false
  if (isSkillProject.value)
    return true
  // URL already says skill Edit before project.kind hydrates (or stale studio tab).
  if (readSkillModeQuery(route.query.skillMode) === 'edit')
    return true
  const agentSkill = Array.isArray(route.query.agentSkill) ? route.query.agentSkill[0] : route.query.agentSkill
  return agentSkill === 'skill-creator'
})
/** Test mode behaves like a normal project: multiple agents; Edit stays a single locked session. */
const isSkillWorkspace = computed(() => {
  if (isSkillProject.value || skillEditFocus.value)
    return true
  // Test route / mode must keep skill header + Edit/Test tabs even before kind hydrates.
  if (skillMode.value === 'test' || readSkillModeQuery(route.query.skillMode) === 'test')
    return true
  if (import.meta.client) {
    try {
      if (sessionStorage.getItem('polox-force-skill-mode') === 'test')
        return true
    }
    catch {}
  }
  return false
})

const skillTestMode = computed(() => {
  const wantsTest = skillMode.value === 'test' || readSkillModeQuery(route.query.skillMode) === 'test'
  return wantsTest && (isSkillProject.value || isSkillWorkspace.value)
})
const skillTestAgents = computed(() =>
  agents.value.filter(agent => String(agent.title || '').trim() !== SKILL_EDIT_AGENT),
)
const lastSkillTestAgentId = ref('')

const backNav = computed(() => {
  const modeFromQuery = readSkillModeQuery(route.query.skillMode)
  let hasSkillSession = false
  if (import.meta.client) {
    try {
      hasSkillSession = Boolean(sessionStorage.getItem(SKILL_TEST_ID_KEY))
    }
    catch {
      hasSkillSession = false
    }
  }
  const fromSkillWorkspace = isSkillProject.value || Boolean(modeFromQuery) || hasSkillSession
  if (fromSkillWorkspace)
    return { to: '/skills', label: 'Skills' }
  return { to: '/projects', label: 'Projects' }
})

const lockedComposerSkillIds = computed(() => {
  // Create/Edit skill workspace: lock Create Skill chip — never removable.
  if (skillEditFocus.value)
    return ['skill-creator']
  if (!isSkillProject.value)
    return [] as string[]
  if (skillMode.value === 'edit')
    return ['skill-creator']
  const id = boundSkillId.value
  return id ? [id] : []
})

const boundSkillName = computed(() => {
  if (!import.meta.client)
    return boundSkillId.value
  try {
    return String(sessionStorage.getItem(SKILL_TEST_NAME_KEY) || '').trim() || boundSkillId.value
  }
  catch {
    return boundSkillId.value
  }
})

function readSessionFlag(key: string) {
  if (!import.meta.client)
    return ''
  try {
    return String(sessionStorage.getItem(key) || '').trim()
  }
  catch {
    return ''
  }
}

function settleSkillCreatorComposer() {
  // Edit mode: ONLY /skill-creator — wipe leftover /skill-id spam from Test mode.
  if (!import.meta.client)
    return
  try {
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, '/skill-creator')
  }
  catch {
    // Ignore private-mode failures.
  }
  draft.value = '/skill-creator'
}

function sendWithLockedSkills(options?: Parameters<typeof sendMessage>[0]) {
  const locked = lockedComposerSkillIds.value
  return sendMessage({
    ...(options || {}),
    lockedSkillIds: locked.length ? locked : options?.lockedSkillIds,
  })
}

async function onComposerSend() {
  // Studio projects: Create Skill must open a dedicated skill workspace (Edit),
  // not continue the conversation in this project.
  // Already in skill Edit (URL/session): never re-run createDraft — just send.
  if (!isSkillProject.value && !skillEditFocus.value && draftHasSkillCreator(draft.value)) {
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
  try {
    if (skillEditFocus.value || (isSkillProject.value && skillMode.value === 'edit')) {
      // Capture user text BEFORE resettling /skill-creator (settle wipes the draft).
      const extra = stripSkillCreatorCommand(draft.value)
      if (isSkillProject.value) {
        const id = ensureNamedAgent(SKILL_EDIT_AGENT)
        await selectAgent(id, { force: true })
      }
      draft.value = extra ? `/skill-creator ${extra}` : '/skill-creator'
      await nextTick()
    }
    const sent = await sendWithLockedSkills()
    if (!sent)
      toast.error(agentError.value || 'Could not send. Check the message and try again.')
    return sent
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not send message'))
    return false
  }
}

function onCreateSkillTestAgent() {
  if (skillEditFocus.value)
    return
  createAgent()
  if (skillTestMode.value && activeAgentId.value)
    lastSkillTestAgentId.value = activeAgentId.value
}

function onSelectSkillTestAgent(id: string) {
  if (skillEditFocus.value)
    return
  // Never jump into the locked Edit session from Test chrome.
  const target = agents.value.find(agent => agent.id === id)
  if (target && String(target.title || '').trim() === SKILL_EDIT_AGENT)
    return
  void selectAgent(id)
  if (skillTestMode.value)
    lastSkillTestAgentId.value = id
}

let activateSkillModeInflight: Promise<void> | null = null

function consumeSkillCreatorAutosendPrompt() {
  if (!import.meta.client)
    return ''
  try {
    if (sessionStorage.getItem(AUTOSEND_KEY) !== '1')
      return ''
    const prompt = String(sessionStorage.getItem(AUTOSEND_PROMPT_KEY) || '').trim()
    // Claim synchronously before any await so concurrent activateSkillMode cannot double-send.
    sessionStorage.removeItem(AUTOSEND_KEY)
    sessionStorage.removeItem(AUTOSEND_PROMPT_KEY)
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, '/skill-creator')
    return prompt
  }
  catch {
    return ''
  }
}

async function activateSkillMode(mode: SkillMode) {
  if (!isSkillProject.value)
    return
  if (activateSkillModeInflight)
    return activateSkillModeInflight

  // Consume autosend BEFORE awaiting anything (and before assigning the async body),
  // so a raced second caller cannot also read AUTOSEND_KEY === "1".
  const autosendPrompt = mode === 'edit' ? consumeSkillCreatorAutosendPrompt() : ''

  const run = (async () => {
    skillMode.value = mode
    if (mode === 'edit') {
      const id = ensureNamedAgent(SKILL_EDIT_AGENT)
      await selectAgent(id, { force: true })
    }
    else {
      // Resolve Edit first (claims any Skill Creator transcript), then a clean Test agent.
      // Do not reuse lastSkillTestAgentId when it still points at creator history.
      const editId = ensureNamedAgent(SKILL_EDIT_AGENT)
      const id = ensureNamedAgent(SKILL_TEST_AGENT)
      if (id === editId) {
        // Should not happen after reconcile; mint a fresh Test just in case.
        const fresh = ensureNamedAgent(SKILL_TEST_AGENT)
        lastSkillTestAgentId.value = fresh
        await selectAgent(fresh, { force: true })
      }
      else {
        lastSkillTestAgentId.value = id
        await selectAgent(id, { force: true })
      }
    }
    await nextTick()
    if (mode === 'edit') {
      settleSkillCreatorComposer()
      await chat.value?.mentionSkill?.('skill-creator')
      // Force clean again after mention (mention must not reintroduce test skill ids).
      draft.value = '/skill-creator'
      if (autosendPrompt) {
        draft.value = `/skill-creator ${autosendPrompt}`
        await nextTick()
        await sendWithLockedSkills()
      }
    }
    else {
      const skillId = boundSkillId.value
      try {
        sessionStorage.removeItem('polox-edit-skill-placeholder')
        sessionStorage.removeItem('polox-edit-skill-brief')
      }
      catch {
        // Ignore
      }
      // One locked trigger only — do not also call mentionSkill (it would duplicate
      // because user-skill /ids used to survive stripSkillCommands).
      draft.value = skillId ? `/${skillId}` : ''
      if (skillId)
        await nextTick()
    }
    skillModeReady.value = true
    // Persist Edit/Test in the URL so hard refresh stays on this skill workspace mode.
    if (route.query.skillMode !== mode || route.query.mode !== 'agent') {
      const query = { ...route.query, mode: 'agent', skillMode: mode }
      delete query.agentSkill
      delete query.rightPane
      delete query.skillSwitch
      await navigateTo({ path: route.path, query, hash: route.hash }, { replace: true })
    }
  })()

  activateSkillModeInflight = run
  try {
    await run
  }
  finally {
    if (activateSkillModeInflight === run)
      activateSkillModeInflight = null
  }
  return run
}

function setSkillMode(value: string | number) {
  const next: SkillMode = value === 'test' ? 'test' : 'edit'
  if (next === 'test' && !canTestSkill.value)
    return
  void activateSkillMode(next)
}

/** Remember Edit/Test from the URL until the skill project has loaded. */
const pendingSkillMode = ref<SkillMode | null>(readSkillModeQuery(route.query.skillMode))

let applySkillWorkspaceInflight: Promise<void> | null = null

async function applySkillWorkspaceQuery() {
  if (applySkillWorkspaceInflight)
    return applySkillWorkspaceInflight
  applySkillWorkspaceInflight = applySkillWorkspaceQueryInner().finally(() => {
    applySkillWorkspaceInflight = null
  })
  return applySkillWorkspaceInflight
}

async function syncSkillTestSessionFromProject() {
  if (!import.meta.client)
    return
  const sid = String(project.value?.skillId || '').trim()
  if (!sid)
    return
  try {
    sessionStorage.setItem(SKILL_TEST_ID_KEY, sid)
    const name = String(project.value?.name || '').trim()
    if (name)
      sessionStorage.setItem(SKILL_TEST_NAME_KEY, name)
    sessionStorage.removeItem(EDIT_PLACEHOLDER_KEY)
    sessionStorage.removeItem(EDIT_BRIEF_KEY)
  }
  catch {
    // Ignore private-mode failures.
  }
}

async function applySkillWorkspaceQueryInner() {
  const skillQ = route.query.agentSkill
  const modeQ = readSkillModeQuery(route.query.skillMode)
  const stripSkill = (Array.isArray(skillQ) ? skillQ[0] : skillQ) === 'skill-creator'

  let forceTest = false
  if (import.meta.client) {
    try {
      forceTest = sessionStorage.getItem('polox-force-skill-mode') === 'test'
      if (forceTest)
        pendingSkillMode.value = 'test'
    }
    catch {
      // Ignore
    }
  }

  if (modeQ)
    pendingSkillMode.value = modeQ
  else if (stripSkill && pendingSkillMode.value == null)
    pendingSkillMode.value = 'edit'

  // Mirror pending/URL mode onto the ref ASAP so header tabs/title do not flash as a
  // normal Project while kind is still hydrating (or after a same-route Edit→Test nav).
  if (pendingSkillMode.value && skillMode.value !== pendingSkillMode.value)
    skillMode.value = pendingSkillMode.value

  // Project kind is unknown until loadProject finishes — do NOT strip the query yet,
  // or Test links lose skillMode=test and fall back to Edit.
  if (!isSkillProject.value) {
    if (projectId.value && !project.value)
      await loadProject()
    // Recovery: Enable & test sometimes landed on a studio project id (bound `.id`
    // was ignored). Re-bind the skill workspace and jump there.
    const wantsTest = pendingSkillMode.value === 'test' || forceTest || modeQ === 'test'
    if (wantsTest && import.meta.client) {
      let sid = ''
      let sname = ''
      try {
        sid = String(sessionStorage.getItem(SKILL_TEST_ID_KEY) || '').trim()
        sname = String(sessionStorage.getItem(SKILL_TEST_NAME_KEY) || '').trim()
      }
      catch {}
      if (sid) {
        try {
          const bound = await ensureSkillProject({ skillId: sid, name: sname || undefined })
          const nextId = String(bound?.id || '').trim()
          if (nextId && nextId !== projectId.value) {
            await navigateTo({
              path: `/projects/${nextId}`,
              query: { mode: 'agent', skillMode: 'test', skillSwitch: String(Date.now()) },
            }, { replace: true })
            return
          }
          // Same id but kind still not skill — reload once more.
          if (nextId)
            await loadProject()
        }
        catch (err) {
          console.warn('[skill] rebind skill project failed', err)
        }
      }
    }
    return
  }

  if (pendingSkillMode.value) {
    const mode = pendingSkillMode.value
    // Re-fetch project + status before Test — exit_skill_creator may have just
    // renamed/bound skillId and Enabled the skill; stale untitled-* ids block Test.
    if (mode === 'test') {
      await loadProject()
      await syncSkillTestSessionFromProject()
      await refreshBoundSkillStatus()
      // Keep the Test chrome visible while status settles (do not leave skillMode on Edit).
      if (skillMode.value !== 'test')
        skillMode.value = 'test'
      if (!canTestSkill.value) {
        // Keep pending + force flag until status becomes testable (watch will re-run).
        return
      }
      if (forceTest && import.meta.client) {
        try {
          sessionStorage.removeItem('polox-force-skill-mode')
        }
        catch {
          // Ignore
        }
      }
    }
    pendingSkillMode.value = null
    await activateSkillMode(mode === 'test' && !canTestSkill.value ? 'edit' : mode)
  }
  else if (!skillModeReady.value) {
    // Hard refresh without an explicit mode still opens Edit — but never override a
    // URL/session intent to stay on Test while status is still settling.
    const wantsTest = readSkillModeQuery(route.query.skillMode) === 'test'
      || pendingSkillMode.value === 'test'
    if (!wantsTest)
      await activateSkillMode('edit')
  }

  // Keep skillMode in the URL so hard refresh stays on Edit/Test for this skill project.
  // Only strip ephemeral launch params.
  if (stripSkill || route.query.rightPane || route.query.skillSwitch) {
    const query = { ...route.query }
    if (stripSkill)
      delete query.agentSkill
    delete query.rightPane
    delete query.skillSwitch
    await navigateTo({ path: route.path, query, hash: route.hash }, { replace: true })
  }
}

onMounted(() => {
  void applySkillWorkspaceQuery()
})

watch(
  () => [route.query.agentSkill, route.query.skillMode, route.query.skillSwitch, project.value?.kind, project.value?.id],
  () => {
    void applySkillWorkspaceQuery()
  },
)
// When Test becomes eligible after a first status fetch, finish a pending Test activation.
watch(canTestSkill, (ok) => {
  if (ok && (pendingSkillMode.value === 'test' || readSkillModeQuery(route.query.skillMode) === 'test'))
    void applySkillWorkspaceQuery()
})

// When a skill is first bound, soft-prime Test mode only (never Edit).
watch(
  () => project.value?.skillId,
  async (skillId, prev) => {
    if (!isSkillProject.value || !skillId || skillId === prev)
      return
    if (skillMode.value !== 'test')
      return
    if (String(draft.value || '').trim() === `/${skillId}`)
      return
    draft.value = `/${skillId}`
  },
)

const items = ref<GenerationJobPublic[]>([])
const total = ref(0)
const loading = ref(false)
const deletingTaskId = ref<string | null>(null)
const deleteConfirmOpen = ref(false)
const pendingDeleteTaskId = ref('')
const moveOpen = ref(false)

const libraryImportOpen = ref(false)
const libraryImportPending = ref(false)
const pendingLibraryAssets = ref<Array<{ url: string, name: string, kind: 'image' | 'video' | 'audio' }>>([])
const { libraries, loadLibraries, upsertLibrary } = useAssetLibraries()

const settingSkillCoverUrl = ref('')

/** Skill Test canvas: make a generated still the bound skill card cover (no Skill Creator round-trip). */
async function onSetSkillCover(url: string) {
  const skillId = boundSkillId.value
  if (!skillId || !url || settingSkillCoverUrl.value)
    return
  settingSkillCoverUrl.value = url
  try {
    await $fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
      method: 'PATCH',
      body: { cover: url },
    })
    toast.success('Skill cover updated')
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not set the skill cover'))
  }
  finally {
    settingSkillCoverUrl.value = ''
  }
}

function requestSaveToLibrary(assets: Array<{ url: string, name: string, kind: 'image' | 'video' | 'audio' }>) {
  const unique = []
  const seen = new Set<string>()
  for (const asset of assets) {
    if (!asset.url || seen.has(asset.url))
      continue
    seen.add(asset.url)
    unique.push(asset)
  }
  if (!unique.length)
    return
  pendingLibraryAssets.value = unique
  libraryImportOpen.value = true
  void loadLibraries()
}

async function confirmSaveToLibrary(libraryId: string) {
  if (!libraryId || libraryImportPending.value || !pendingLibraryAssets.value.length)
    return
  libraryImportPending.value = true
  try {
    for (const asset of pendingLibraryAssets.value) {
      await $fetch(`/api/asset-libraries/${libraryId}/assets`, {
        method: 'POST',
        body: {
          url: asset.url,
          name: asset.name,
          kind: asset.kind,
        },
      })
    }
    const count = pendingLibraryAssets.value.length
    toast.success(count > 1 ? `Saved ${count} assets to library` : 'Saved to asset library')
    libraryImportOpen.value = false
    pendingLibraryAssets.value = []
    await loadLibraries()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not save to the library'))
  }
  finally {
    libraryImportPending.value = false
  }
}

const movingTaskId = ref<string | null>(null)
const pendingMoveTaskId = ref('')

const otherProjects = computed(() =>
  projects.value.filter(item => item.id && item.id !== projectId.value && item.kind !== 'skill'),
)
let loadToken = 0
let jobsController: AbortController | undefined
let jobsInFlight = false

const sessionSkillName = computed(() => {
  if (!import.meta.client)
    return ''
  try {
    return String(sessionStorage.getItem(SKILL_TEST_NAME_KEY) || '').trim()
  }
  catch {
    return ''
  }
})

const sessionSkillId = computed(() => {
  if (!import.meta.client)
    return ''
  try {
    return String(sessionStorage.getItem(SKILL_TEST_ID_KEY) || '').trim()
  }
  catch {
    return ''
  }
})

const title = computed(() => {
  if (isSkillWorkspace.value)
    return project.value?.name || sessionSkillName.value || 'Create Skill'
  return project.value?.name || 'Project'
})

const description = computed(() => {
  if (isSkillWorkspace.value) {
    const fromProject = String(project.value?.description || '').trim()
    if (fromProject)
      return fromProject
    const id = String(project.value?.skillId || sessionSkillId.value || '').trim()
    return id ? `Workspace for /${id}` : ''
  }
  return project.value?.description || ''
})
const canRename = computed(() => Boolean(project.value && !project.value.isDefault))
const renaming = ref(false)
const renameDraft = ref('')
const renamingSaving = ref(false)
const renameInputRef = ref<{ $el?: HTMLInputElement } | null>(null)

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
    if (project.value.kind === 'skill')
      await syncSkillTestSessionFromProject()
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not load this project')
    const modeFromQuery = readSkillModeQuery(route.query.skillMode)
    const skillWorkspace = Boolean(
      isSkillProject.value
      || modeFromQuery
      || pendingSkillMode.value
      || (import.meta.client && (() => {
        try {
          return Boolean(sessionStorage.getItem(SKILL_TEST_ID_KEY))
        }
        catch {
          return false
        }
      })()),
    )
    // Never dump a skill Test/Edit hard-refresh into the studio Projects list.
    await nuxtApp.runWithContext(() => navigateTo(skillWorkspace ? '/skills' : '/projects'))
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
      for (const [id, job] of loaded) current.set(id, job)
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
      else if (!await deleteCanvasResult(taskId))
        continue
      removeAgentResult(taskId)
      items.value = items.value.filter(job => job.taskId !== taskId)
      total.value = Math.max(0, total.value - 1)
    }
    catch { failed.push(taskId) }
  }
  bulkTaskIds.value = failed
  bulkPending.value = false
  if (failed.length)
    toast.error(`${failed.length} results could not be ${action === 'move' ? 'moved' : 'deleted'}. Retry to process only these results.`)
  else bulkAction.value = null
  const refreshed = await Promise.allSettled([loadJobs(true), loadProjects()])
  if (refreshed.some(result => result.status === 'rejected'))
    toast.error('Could not refresh the project. Reload to see the latest results.')
}

async function deleteCanvasResult(id: string) {
  const isLocalAsset = !items.value.some(job => job.taskId === id)
    && allImages.value.some(image => `${`agent_${image.id}`.slice(0, 120)}:0` === id)
  if (isLocalAsset) {
    if (!canvas.value)
      throw new Error('Canvas is still loading. Please try again.')
    await canvas.value.hideAsset(id)
    return false
  }
  await $fetch(`/api/ai/jobs/${id}`, { method: 'DELETE' })
  return true
}

function requestDelete(taskId: string) {
  const job = items.value.find(item => item.taskId === taskId)
  if (job && isGenerationActive(job.state))
    return
  pendingDeleteTaskId.value = taskId
  deleteConfirmOpen.value = true
}

function requestMove(taskId: string) {
  pendingMoveTaskId.value = taskId
  moveOpen.value = true
}

function removeAgentResult(taskId: string) {
  const urls = new Set(items.value.find(job => job.taskId === taskId)?.resultUrls || [])
  images.value = images.value.filter(image =>
    `agent_${image.id}`.slice(0, 120) !== taskId
    && image.providerTaskId !== taskId
    && (!image.url || !urls.has(image.url)),
  )
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
    const deletedJob = await deleteCanvasResult(taskId)
    if (!deletedJob) {
      deleteConfirmOpen.value = false
      pendingDeleteTaskId.value = ''
      return
    }
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
  if (!canRename.value || isSkillProject.value || !project.value || renamingSaving.value)
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
    projects.value = projects.value.map(item =>
      item.id === updated.id ? { ...item, ...updated } : item,
    )
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
  if (document.visibilityState !== 'visible')
    return
  void loadJobs(true)
}, POLL_MS)

watch(items, (jobs) => {
  applyCanvasJobs(jobs)
}, { immediate: true, deep: true })

async function onConfirm(params: ConfirmationPayload['params']) {
  await resolveConfirmation('confirm', params)
}

function onAttachCanvas(payload: { urls: string[], prompt: string }) {
  attachUrls(payload.urls.map((url) => {
    const audio = isMediaAudioUrl(url)
    const video = !audio && isMediaVideoUrl(url)
    const document = !audio && !video && isMediaDocumentUrl(url)
    return {
      url,
      name: payload.prompt.trim() || (document ? 'Document' : audio ? 'Voice reference' : video ? 'Video reference' : 'Canvas still'),
      kind: audio ? 'audio' as const : video ? 'video' as const : document ? 'document' as const : 'image' as const,
    }
  }))
}

async function prepareCanvasSkill(payload: { urls: string[], prompt: string }) {
  split.value?.maximizeAgent()
  for (const item of [...attachments.value])
    removeAttachment(item.id)
  draft.value = ''
  await nextTick()
  onAttachCanvas(payload)
  await nextTick()
}

async function onEditTextCanvas(payload: { urls: string[], prompt: string }) {
  await prepareCanvasSkill(payload)
  await chat.value?.mentionSkill('image-text-editor')
  await nextTick()
  await sendWithLockedSkills()
}

async function onAnnotateImageCanvas(payload: { urls: string[], prompt: string }) {
  await prepareCanvasSkill(payload)
  await chat.value?.mentionSkill('image-annotation-edit')
  await nextTick()
  await sendWithLockedSkills()
}

async function onSplitLayersCanvas(payload: { urls: string[], prompt: string }) {
  await prepareCanvasSkill(payload)
  await chat.value?.mentionSkill('image-layer-splitter')
  await nextTick()
  await sendWithLockedSkills()
}

async function onRemoveBackgroundCanvas(payload: { urls: string[], prompt: string }) {
  await prepareCanvasSkill(payload)
  await chat.value?.mentionModel(IDEOGRAM_REMOVE_BACKGROUND_MODEL)
  await nextTick()
  await sendWithLockedSkills()
}

async function onRemoveObjectCanvas(payload: { urls: string[], prompt: string }) {
  await prepareCanvasSkill(payload)
  await chat.value?.mentionSkill('image-object-removal')
  await nextTick()
  await sendWithLockedSkills()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex h-[54px] shrink-0 items-center justify-between border-b border-border px-4">
      <div class="flex min-w-0 items-center gap-3">
        <Button as-child variant="ghost" size="sm" class="rounded-lg">
          <NuxtLink :to="backNav.to">
            <ArrowLeft data-icon="inline-start" />
            {{ backNav.label }}
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
            <div class="flex min-w-0 items-center gap-2">
              <Badge
                v-if="isSkillWorkspace"
                variant="secondary"
                class="shrink-0 rounded-md px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
              >
                Skill
              </Badge>
              <h1 class="truncate text-sm font-medium tracking-tight">
                {{ title }}
              </h1>
            </div>
            <p
              v-if="description"
              class="truncate text-[11px] text-muted-foreground"
            >
              {{ description }}
            </p>
          </div>
          <Button
            v-if="canRename && !isSkillProject"
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
      <LayoutHeaderUser />
    </header>

    <StudioSplit ref="split" :collapsed-right="skillEditFocus">
      <template #left>
        <div class="flex min-h-0 flex-1 flex-col">
          <div
            v-if="isSkillWorkspace"
            class="flex shrink-0 items-center border-b border-border px-3"
          >
            <div class="flex w-full min-w-0 items-center justify-between gap-3">
              <Tabs
                :model-value="skillMode"
                class="min-w-0"
                @update:model-value="setSkillMode"
              >
                <TabsList class="h-9 w-auto justify-start gap-1 rounded-none bg-transparent p-0">
                  <TabsTrigger
                    value="edit"
                    class="h-9 rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    Edit
                  </TabsTrigger>
                  <TabsTrigger
                    v-if="showTestTab"
                    value="test"
                    :disabled="!canTestSkill && skillMode !== 'test'"
                    class="h-9 rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    Test
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div
            class="flex min-h-0 flex-1 flex-col overflow-hidden transition-[padding] duration-300 ease-out"
            :class="skillEditFocus ? 'items-center px-4 sm:px-6' : ''"
          >
            <div
              class="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col transition-[max-width] duration-300 ease-out"
              :class="skillEditFocus ? 'max-w-3xl' : 'max-w-none'"
            >
            <AgentLabChat
              ref="chat"
              v-model:draft="draft"
              v-model:quality-preference="qualityPreference"
              v-model:confirm-policy="confirmPolicy"
              :messages="messages"
              :session-id="agentSessionId"
              :images="images"
              :project-images="allImages"
              :project-jobs="items"
              :upload-annotation-image="uploadAnnotationImage"
              :save-sketch="file => sendWithLockedSkills({ sketchFile: file })"
              :attachments="attachments"
              :status="status"
              :pending="agentPending"
              :attaching="attaching"
              :stopping="stopping"
              :error="agentError"
              :confirmation-open="waitingForUserConfirm"
              :choice-open="waitingForUserChoice"
              :queue-notice="queueNotice"
              :agents="skillTestMode ? skillTestAgents : (isSkillProject ? [] : agents)"
              :active-agent-id="activeAgentId"
              :can-create-agent="skillTestMode ? canCreateAgent : (isSkillProject ? false : canCreateAgent)"
              :can-switch-agent="skillTestMode ? canSwitchAgent : (isSkillProject ? false : canSwitchAgent)"
              :hide-agent-chrome="skillEditFocus"
              :locked-skill-ids="lockedComposerSkillIds"
              @send="onComposerSend"
              @stop="stopAgent"
              @attach="attachFiles"
              @attach-asset="attachUrls"
              @remove-attachment="removeAttachment"
              @confirm="onConfirm"
              @cancel="resolveConfirmation('cancel')"
              @submit-choice="resolveChoice('submit', $event)"
              @skip-choice="resolveChoice('skip')"
              @create-agent="onCreateSkillTestAgent"
              @select-agent="onSelectSkillTestAgent"
            />
            </div>
          </div>
        </div>
      </template>

            <template #right>
        <section
          class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
          :aria-label="isSkillProject ? 'Skill test canvas' : 'Canvas'"
        >
          <div
            v-if="skillTestMode"
            class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2"
          >
            <p class="text-xs text-muted-foreground">
              Canvas — assets for testing this skill
            </p>
          </div>
          <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <AgentLabInfiniteCanvas
              v-if="!skillEditFocus"
              ref="canvas"
              :key="projectId"
              :project-id="projectId"
              :jobs="items"
              :images="allImages"
              :loading="loading"
              :deleting-task-id="deletingTaskId"
              :show-move="true"
              show-attach
              :show-set-cover="skillTestMode && Boolean(boundSkillId)"
              :setting-cover-url="settingSkillCoverUrl"
              @set-cover="onSetSkillCover"
              @delete="requestDelete"
              @delete-many="requestBulk('delete', $event)"
              @move-many="requestBulk('move', $event)"
              @move="requestMove"
              @attach="onAttachCanvas"
              @edit-text="onEditTextCanvas"
              @annotate-image="onAnnotateImageCanvas"
              @split-layers="onSplitLayersCanvas"
              @remove-background="onRemoveBackgroundCanvas"
              @remove-object="onRemoveObjectCanvas"
              @save-to-library="requestSaveToLibrary"
              @save-to-library-many="requestSaveToLibrary"
            />
          </div>
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
    <AssetLibraryImportDialog
      :open="libraryImportOpen"
      :count="pendingLibraryAssets.length"
      :pending="libraryImportPending"
      :libraries="libraries"
      @update:open="libraryImportOpen = $event"
      @confirm="confirmSaveToLibrary"
      @created="upsertLibrary"
    />
  </div>
</template>
