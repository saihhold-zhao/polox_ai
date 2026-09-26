import type { ImageAnnotationEdit } from '~~/shared/utils/imageAnnotations'
import type { ObjectRemovalEdit } from '~~/shared/utils/imageObjectRemoval'
import { useServiceConnection } from './useServiceConnection'
import type { AgentConfirmPolicy, AgentQuality } from '~~/shared/types/agentPreferences'
import type { GenerationJobPublic } from '~~/shared/types/generation'
import type { GptImage2AspectRatio, GptImage2Resolution } from '~~/shared/utils/gptImage2'
import type { ImageTextEdit, ImageTextLine } from '~~/shared/utils/imageTextEditor'
import { publicGenerationFailMessage } from '~~/shared/types/generation'
import { formatAutoRetryIds, isFailSuperseded } from '~~/shared/utils/agentAutoRetry'
import { INTERNAL_AUTO_RETRY_MARKER, isAutoRetryUserInstruction, isInternalAgentChatText, publicAgentChatText } from '~~/shared/utils/agentChatVisibility'
import { isAgentTransientMessage } from '~~/shared/utils/agentHistoryVisibility'
import { completedLayerResults } from '~~/shared/utils/agentLayerResults'
import { agentRecoveryNotice, isAgentDisconnectError as isDisconnectError, recoverAgentTranscript } from '~~/shared/utils/agentRecovery'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { gptImage2ComboError } from '~~/shared/utils/gptImage2'
import { isMediaAudioUrl, isMediaDocumentUrl, isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { confirmationMedia, reconcileConfirmationStates } from '~/utils/agentConfirmationState'

export type { AgentConfirmPolicy, AgentQuality }
export type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'generating' | 'queued'
export type VideoFamily = 'seedance-2' | 'seedance-2-5' | 'wan-3'
export type UncertainField = 'prompt' | 'aspect_ratio' | 'resolution' | 'duration'
export type AgentImageKind = 'still' | 'cutout' | 'upload' | 'video' | 'audio' | 'document'

const AGENT_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
])
const AGENT_VIDEO_EXT = /\.(mp4|mov|mkv|webm)$/i
const AGENT_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aac',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
])
const AGENT_AUDIO_EXT = /\.(mp3|wav|aac|ogg|m4a|webm)$/i


function isAgentImageFile(file: File) {
  const type = file.type.toLowerCase()
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif'
}

function isAgentVideoFile(file: File) {
  const type = file.type.toLowerCase()
  if (AGENT_VIDEO_TYPES.has(type))
    return true
  return !type && AGENT_VIDEO_EXT.test(file.name)
}

function isAgentAudioFile(file: File) {
  const type = file.type.toLowerCase().split(';')[0]!.trim()
  if (AGENT_AUDIO_TYPES.has(type))
    return true
  return (!type || type === 'application/octet-stream') && AGENT_AUDIO_EXT.test(file.name)
}

export type ConfirmationKind = 'image' | 'video' | 'cutout' | 'mixed'
export interface AgentImage {
  modelId?: string
  modelInput?: Record<string, unknown>
  name?: string
  id: string
  kind?: AgentImageKind
  status: 'generating' | 'success' | 'fail'
  prompt: string
  aspectRatio: string
  resolution: string
  url: string
  error: string
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: VideoFamily
  providerTaskId?: string
  /** Server epoch ms when this output first failed. */
  failedAt?: number
  /** Server already issued an automatic retry for this failure. */
  autoRetryHandled?: boolean
}
export interface PendingAttachment {
  id: string
  name: string
  previewUrl: string
  url: string
  status: 'uploading' | 'ready' | 'fail'
  error: string
  imageId?: string
  kind?: 'image' | 'audio' | 'video' | 'document'
}
export interface ConfirmationPayload {
  jobs?: Array<{
    id: string
    name: string
    modelName: string
    task: string
    inputUrls: string[]
    params: ConfirmationPayload['params']
  }>
  id: string
  kind?: ConfirmationKind
  reason: string
  uncertainFields: string[]
  count?: number

  modelName?: string
  task?: string
  inputUrls?: string[]
  approvedBy?: 'agent' | 'user'
  params: {
    modelId?: string
    modelInput?: Record<string, unknown>
    prompt: string
    aspectRatio: string
    resolution: string
    duration?: number
    videoMode?: 'text' | 'image' | 'reference'
    videoFamily?: VideoFamily
  }
}
export interface ChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}
export interface ChoiceQuestion {
  id: string
  title?: string
  prompt: string
  /** Reading script shown in the in-chat voice recorder (voice_record); language matches the locked spoken language. */
  script?: string
  options: ChoiceOption[]
  recommendedId?: string
}
export interface ChoicePayload {
  textEdits?: ImageTextEdit[]
  textEdit?: ImageTextEdit
  id: string
  prompt: string
  recommendation?: string
  questions: ChoiceQuestion[]
}
export interface ChoiceAnswer {
  referenceImages?: { url: string, name: string }[]
  annotationEdit?: ImageAnnotationEdit
  objectRemovalEdit?: ObjectRemovalEdit
  imageSelections?: {
    imageUrl: string
    regions: number[][]
  }[]
  textEdits?: ImageTextEdit[]
  textLines?: ImageTextLine[]
  imageUrl?: string
  regions?: number[][]
  voiceUrl?: string
  voiceName?: string
  questionId: string
  optionId?: string
  label?: string
  text?: string
  skipped?: boolean
}
export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  kind?: 'error'
  content: string
  streaming?: boolean
  imageIds?: string[]
  confirmation?: ConfirmationPayload
  confirmationState?: 'pending' | 'confirmed' | 'cancelled' | 'blocked'
  resolvedParams?: ConfirmationPayload['params']
  choice?: ChoicePayload
  choiceState?: 'pending' | 'answered' | 'skipped'
  choiceAnswers?: ChoiceAnswer[]
}
interface AgentEvent {
  remaining?: number
  required?: number
  type: string
  sessionId?: string
  delta?: string
  status?: AgentStatus
  title?: string
  confirmation?: ConfirmationPayload
  choice?: ChoicePayload
  image?: AgentImage
  replay?: boolean
  message?: string
  limit?: number
  active?: number
  path?: string
  reason?: string
}
export interface AgentListItem {
  id: string
  title: string
  busy: boolean
}
type AgentTitleSource = 'default' | 'auto' | 'manual'
interface StoredAgent {
  id: string
  title: string
  titleSource?: AgentTitleSource
  sessionId?: string
  messages?: AgentChatMessage[]
  images?: AgentImage[]
  confirmation?: ConfirmationPayload | null
  choice?: ChoicePayload | null
  draft?: string
  status?: AgentStatus
  pending?: boolean
  busy?: boolean
  queueNotice?: string
  createdAt?: number
  updatedAt?: number
}
interface StoredLab {
  activeAgentId?: string
  agents?: StoredAgent[]
  sessionId?: string
  messages?: AgentChatMessage[]
  images?: AgentImage[]
  confirmation?: ConfirmationPayload | null
  choice?: ChoicePayload | null
}
const STORAGE_PREFIX = 'polox-agent-lab-v2:'
const COMPOSER_DRAFT_KEY = 'polox-agent-composer-draft'
let composerDraftMemory = ''
const MAX_CHAT_MESSAGES = 60
const MAX_CHAT_IMAGES = 48
const MAX_MESSAGE_CHARS = 8000
const MAX_AGENT_TITLE = 48
const DEFAULT_AGENT_TITLE = 'New agent'
function clipMessageContent(value: string) {
  if (value.length <= MAX_MESSAGE_CHARS)
    return value
  return value.slice(value.length - MAX_MESSAGE_CHARS)
}
function titleFromMessage(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact)
    return ''
  if (compact.length <= MAX_AGENT_TITLE)
    return compact
  return `${compact.slice(0, MAX_AGENT_TITLE).trim()}…`
}
function sanitizeChatMessages(items: AgentChatMessage[]) {
  const out: AgentChatMessage[] = []
  for (const item of items) {
    if (item.kind === 'error') {
      if (isAgentTransientMessage(item))
        continue
      out.push(item)
      continue
    }
    const raw = item.content || ''
    if (item.role === 'user' && isInternalAgentChatText(raw))
      continue
    if (item.role === 'user') {
      const content = publicAgentChatText(raw)
      // Keep attachment-only user turns (thumbs via imageIds) even if text strips empty.
      if (!content && !(item.imageIds?.length || item.confirmation))
        continue
      out.push(content === raw ? item : { ...item, content })
      continue
    }
    out.push(item)
  }
  return out
}
function trimChatMessages(items: AgentChatMessage[]) {
  const clipped = sanitizeChatMessages(items).map(item => (item.content.length > MAX_MESSAGE_CHARS
    ? { ...item, content: clipMessageContent(item.content) }
    : item))
  if (clipped.length <= MAX_CHAT_MESSAGES)
    return clipped
  const pending = clipped.filter(item => item.confirmationState === 'pending' || item.choiceState === 'pending')
  const kept = clipped.slice(-MAX_CHAT_MESSAGES)
  for (const item of pending) {
    if (!kept.some(row => row.id === item.id))
      kept.push(item)
  }
  return kept
}
function agentJobTaskId(imageId: string) {
  return `agent_${imageId}`.slice(0, 120)
}
function isRetryableJobFail(message: string) {
  return !/blocked|cancelled/i.test(message)
}
function isSessionLockError(message: string) {
  return /this session is already running|this agent lab session is already running/i.test(message)
}
function isEmptyStoredAgent(agent: StoredAgent) {
  return !agent.sessionId && !(agent.messages || []).length && !(agent.images || []).length
}
function mergeSessionImages(local: AgentImage[], remote: AgentImage[]) {
  const byId = new Map(local.map(item => [item.id, item]))
  return remote.map((item) => {
    const current = byId.get(item.id)
    if (!current)
      return item
    if (item.status === 'fail' || item.status === 'success')
      return item
    if (current.status === 'success' && current.url && item.status === 'generating')
      return current
    if (current.status === 'fail' && item.status === 'generating' && !item.url)
      return current
    return item
  })
}
function unionSessionImages(left: AgentImage[], right: AgentImage[]) {
  if (!left.length)
    return right
  if (!right.length)
    return left
  const ids = [...new Set([...left, ...right].map(item => item.id))]
  const byLeft = new Map(left.map(item => [item.id, item]))
  const byRight = new Map(right.map(item => [item.id, item]))
  return ids.map((id) => {
    const a = byLeft.get(id)
    const b = byRight.get(id)
    if (!a)
      return b!
    if (!b)
      return a
    return mergeSessionImages([a], [b])[0] || b
  })
}
function readStore(key: string): StoredLab | null {
  if (!import.meta.client || !key)
    return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw)
      return null
    return JSON.parse(raw) as StoredLab
  }
  catch {
    return null
  }
}
function parseSseBlock(block: string) {
  let eventName = ''
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:'))
      eventName = line.slice(6).trim()
    else if (line.startsWith('data:'))
      dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length)
    return null
  try {
    const parsed = JSON.parse(dataLines.join('\n')) as AgentEvent
    if (!parsed.type && eventName)
      parsed.type = eventName
    return parsed
  }
  catch {
    return null
  }
}
function readComposerDraft() {
  if (!import.meta.client)
    return composerDraftMemory
  try {
    const legacy = sessionStorage.getItem('polox-agent-guest-draft')
    if (legacy !== null) {
      if (sessionStorage.getItem(COMPOSER_DRAFT_KEY) === null)
        sessionStorage.setItem(COMPOSER_DRAFT_KEY, legacy)
      sessionStorage.removeItem('polox-agent-guest-draft')
    }
    return String(sessionStorage.getItem(COMPOSER_DRAFT_KEY) || composerDraftMemory || '')
  }
  catch {
    return composerDraftMemory
  }
}
function writeComposerDraft(value: string) {
  composerDraftMemory = value
  if (!import.meta.client)
    return
  try {
    if (value)
      sessionStorage.setItem(COMPOSER_DRAFT_KEY, value)
    else
      sessionStorage.removeItem(COMPOSER_DRAFT_KEY)
  }
  catch {
    // Ignore quota / private mode.
  }
}
function clearComposerDraft() {
  writeComposerDraft('')
}
const agentLabs = new Map<string, ReturnType<typeof createAgentLab>>()
function agentLabCacheKey(projectId: string) {
  const pid = String(projectId || '').trim()
  if (!pid)
    return ''
  return pid
}

const AGENT_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
])
const AGENT_DOCUMENT_EXT = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|csv)$/i

function isAgentDocumentFile(file: File) {
  const type = file.type.toLowerCase().split(';')[0]!.trim()
  if (AGENT_DOCUMENT_TYPES.has(type))
    return true
  return (!type || type === 'application/octet-stream') && AGENT_DOCUMENT_EXT.test(file.name)
}
export function useAgentLab(options?: {
  projectId?: MaybeRefOrGetter<string>
  onJobs?: (jobs: GenerationJobPublic[]) => void
}) {
  const connection = useServiceConnection()
  function resolveLab() {
    const projectId = String(toValue(options?.projectId) || '').trim()
    const key = agentLabCacheKey(projectId)
    const existing = key ? agentLabs.get(key) : undefined
    if (existing) {
      existing.bindOptions({ onJobs: options?.onJobs })
      return existing
    }
    // Keep a runtime bound to its original project, including pending async work.
    const lab = effectScope(true).run(() => createAgentLab({
      projectId,
      onJobs: options?.onJobs,
    }))!
    if (key)
      agentLabs.set(key, lab)
    return lab
  }
  const currentLab = shallowRef(resolveLab())
  watch(() => agentLabCacheKey(String(toValue(options?.projectId) || '')), () => {
    currentLab.value.flush()
    currentLab.value = resolveLab()
    void currentLab.value.ensureHydrated()
  }, { flush: 'sync' })
  onMounted(() => { void currentLab.value.ensureHydrated() })
  onUnmounted(() => { currentLab.value.flush() })
  // Consumers destructure refs and actions, so both must follow the active runtime.
  return Object.fromEntries(Object.entries(currentLab.value).map(([key, value]) => {
    const read = () => Reflect.get(currentLab.value, key)
    return [key, isRef(value)
      ? computed({
          get: () => read().value,
          set: (next) => { read().value = next },
        })
      : key === 'sendMessage'
        ? async (...args: unknown[]) => {
            if (!await connection.ensureConnected()) return false
            return Reflect.apply(read(), currentLab.value, args)
          }
        : (...args: unknown[]) => Reflect.apply(read(), currentLab.value, args)]
  })) as ReturnType<typeof createAgentLab>
}
function createAgentLab(options?: {
  projectId?: MaybeRefOrGetter<string>
  onJobs?: (jobs: GenerationJobPublic[]) => void
}) {
  let bootstrapped = false
  const baseUrl = '/api/agent'
  const onJobs = ref(options?.onJobs)
  const projectScope = ref(String(toValue(options?.projectId) || '').trim())
  const persistedCanvasIds = new Set<string>()
  const patchedInputIds = new Set<string>()
  const storageKey = computed(() => `${STORAGE_PREFIX}${projectScope.value || 'home'}`)
  const sessionId = ref('')
  const messages = ref<AgentChatMessage[]>([])
  const images = ref<AgentImage[]>([])
  const status = ref<AgentStatus>('idle')
  const confirmation = ref<ConfirmationPayload | null>(null)
  const choice = ref<ChoicePayload | null>(null)
  const online = ref<boolean | null>(null)
  const error = ref('')
  let agentWriteRetryAt = 0
  const pending = ref(false)
  const stopping = ref(false)
  const draft = ref('')
  const attachments = ref<PendingAttachment[]>([])
  const { qualityPreference, confirmPolicy } = useAgentPreferences()
  const storedAgents = ref<StoredAgent[]>([])
  const activeAgentId = ref('')
  const agentTitle = ref(DEFAULT_AGENT_TITLE)
  const titleSource = ref<AgentTitleSource>('default')
  const queueNotice = ref('')
  let streamEpoch = 0
  let activeTurns = 0
  let hydrating = false
  // Auto-retry / fail notices only apply to failures observed live on this page.
  // Fails already present in history (e.g. interrupted by a deploy days ago, refunded
  // and regenerated) must never trigger another paid generation after a reload.
  let failBaselineAgentId = ''
  let failBaselineReady = false
  let failBaselineAt = 0
  const baselineFailIds = new Set<string>()
  /** Media ids seen `generating` (or failing in a live, non-replayed SSE event) after the baseline. */
  const liveObservedIds = new Set<string>()
  // Server/client clocks may drift; older job failures than this are history.
  const FAIL_BASELINE_SLACK_MS = 2 * 60 * 1000

  const busy = computed(() => pending.value || status.value !== 'idle')
  const waitingForUserConfirm = computed(() => Boolean(confirmation.value) && confirmation.value?.approvedBy !== 'agent')
  const waitingForUserChoice = computed(() => Boolean(choice.value))
  const waitingForUser = computed(() => waitingForUserConfirm.value || waitingForUserChoice.value)
  const uploadingSketch = ref(false)
  const attaching = computed(() => uploadingSketch.value || attachments.value.some(item => item.status === 'uploading'))
  const readyAttachments = computed(() => attachments.value.filter(item => item.status === 'ready' && item.url))
  const canSwitchAgent = computed(() => {
    if (attaching.value)
      return false
    if (status.value === 'thinking' || status.value === 'calling_tool')
      return false
    return true
  })
  const canCreateAgent = computed(() => canSwitchAgent.value)
  const agents = computed<AgentListItem[]>(() => [...storedAgents.value].sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0)).map((agent) => {
    const active = agent.id === activeAgentId.value
    const title = active ? agentTitle.value : (agent.title || DEFAULT_AGENT_TITLE)
    const busy = active
      ? pending.value || (status.value !== 'idle')
      : Boolean(agent.busy || agent.pending || (agent.status && agent.status !== 'idle'))
    return { id: agent.id, title, busy }
  }))
  // The canvas is project-scoped: it must show every agent's media, not just
  // the active agent's. Otherwise creating a new agent (which resets the live
  // images list) would wipe earlier agents' uploads/references from the canvas
  // until a reload restores the stored agents.
  const allImages = computed<AgentImage[]>(() => {
    const byId = new Map<string, AgentImage>()
    for (const agent of storedAgents.value) {
      for (const image of agent.images || []) {
        if (!byId.has(image.id))
          byId.set(image.id, image)
      }
    }
    for (const image of images.value) {
      if (image.url)
        byId.set(image.id, image)
    }
    return [...byId.values()]
  })
  function bumpStream() {
    streamEpoch += 1
    return streamEpoch
  }
  function cloneMessages(items: AgentChatMessage[]): AgentChatMessage[] {
    return items.map(item => ({
      ...item,
      streaming: false,
      imageIds: item.imageIds ? [...item.imageIds] : undefined,
      confirmation: item.confirmation
        ? { ...item.confirmation, params: { ...item.confirmation.params } }
        : undefined,
      resolvedParams: item.resolvedParams ? { ...item.resolvedParams } : undefined,
      choice: item.choice
        ? {
            ...item.choice,
            questions: item.choice.questions.map(question => ({
              ...question,
              options: question.options.map(option => ({ ...option })),
            })),
          }
        : undefined,
      choiceAnswers: item.choiceAnswers?.map(answer => ({ ...answer })),
    }))
  }
  function snapshotCurrent(): StoredAgent {
    if (!activeAgentId.value)
      activeAgentId.value = crypto.randomUUID()
    return {
      id: activeAgentId.value,
      title: agentTitle.value || DEFAULT_AGENT_TITLE,
      titleSource: titleSource.value,
      sessionId: sessionId.value,
      messages: cloneMessages(messages.value),
      images: images.value.map(item => ({ ...item })),
      confirmation: confirmation.value,
      choice: choice.value,
      draft: draft.value,
      status: status.value,
      pending: pending.value,
      busy: pending.value || status.value !== 'idle',
      queueNotice: queueNotice.value,
      createdAt: storedAgents.value.find(agent => agent.id === activeAgentId.value)?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }
  }
  function commitCurrentAgent() {
    const current = snapshotCurrent()
    const list = storedAgents.value.slice()
    const idx = list.findIndex(agent => agent.id === current.id)
    if (idx >= 0)
      list[idx] = current
    else
      list.push(current)
    storedAgents.value = list
    return current
  }
  function nextDefaultTitle() {
    const used = new Set(storedAgents.value
      .map(agent => agent.title)
      .filter(title => /^New agent(?: \d+)?$/.test(title)))
    if (!used.has(DEFAULT_AGENT_TITLE))
      return DEFAULT_AGENT_TITLE
    let n = 2
    while (used.has(`New agent ${n}`))
      n += 1
    return `New agent ${n}`
  }
  function emptyStoredAgent(title: string): StoredAgent {
    return {
      id: crypto.randomUUID(),
      title,
      titleSource: 'default',
      sessionId: '',
      messages: [],
      images: [],
      confirmation: null,
      choice: null,
      draft: '',
      status: 'idle',
      pending: false,
      busy: false,
      queueNotice: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }
  function applyAgent(agent: StoredAgent) {
    if (agent.id !== failBaselineAgentId) {
      failBaselineAgentId = agent.id
      failBaselineAt = Date.now()
      // A fresh agent has no history to snapshot; a stored one waits for the server snapshot.
      failBaselineReady = !agent.sessionId
      for (const item of agent.images || []) {
        if (item.status === 'fail')
          baselineFailIds.add(item.id)
      }
    }
    activeAgentId.value = agent.id
    agentTitle.value = agent.title || DEFAULT_AGENT_TITLE
    titleSource.value = agent.titleSource || 'default'
    sessionId.value = agent.sessionId || ''
    messages.value = sanitizeChatMessages((agent.messages || []).map(item => ({
      ...item,
      streaming: false,
    })))
    images.value = [...(agent.images || [])]
    reconcileConfirmationStates(messages.value, images.value)
    const pendingCard = messages.value.find(item => item.confirmationState === 'pending' && item.confirmation)
    const pendingChoiceCard = messages.value.find(item => item.choiceState === 'pending' && item.choice)
    confirmation.value = pendingCard?.confirmation || agent.confirmation || null
    choice.value = pendingChoiceCard?.choice || agent.choice || null
    draft.value = agent.draft || ''
    queueNotice.value = agent.queueNotice || ''
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      status.value = 'generating'
      pending.value = true
    }
    else if (pendingCard || pendingChoiceCard) {
      status.value = 'idle'
      pending.value = true
    }
    else {
      status.value = 'idle'
      pending.value = false
    }
    if (!pending.value && status.value === 'idle')
      stopping.value = false
    attachments.value.forEach(revokePreview)
    attachments.value = []
    if (!pending.value && status.value === 'idle')
      clearLabError()
    trimLab()
  }
  function maybeAutoTitle() {
    if (titleSource.value !== 'default')
      return
    const first = messages.value.find(item => item.role === 'user' && item.content.trim())
    if (!first)
      return
    const next = titleFromMessage(first.content)
    if (!next)
      return
    agentTitle.value = next
    titleSource.value = 'auto'
  }
  function seedDefaultAgent() {
    const agent = emptyStoredAgent(DEFAULT_AGENT_TITLE)
    storedAgents.value = [agent]
    applyAgent(agent)
  }
  function clearLabError() {
    error.value = ''
  }
  function appendErrorMessage(message: string) {
    const content = message.trim()
    if (!content || isAgentTransientMessage({ kind: 'error', content }))
      return
    const last = messages.value[messages.value.length - 1]
    if (last?.kind === 'error' && last.content === content)
      return
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      kind: 'error',
      content,
    })
  }
  function setLabError(message: string, persist = false) {
    message = agentRecoveryNotice(message)
    if (persist && !isAgentTransientMessage({ kind: 'error', content: message })) {
      error.value = ''
      appendErrorMessage(message)
      return
    }
    error.value = message
  }
  function readErrorText(payload: Record<string, unknown>, fallback: string) {
    const nested = payload.data && typeof payload.data === 'object'
      ? (payload.data as {
          message?: unknown
        }).message
      : undefined
    for (const value of [payload.statusMessage, payload.message, payload.error, nested]) {
      if (typeof value === 'string' && value.trim() && value.trim() !== 'true')
        return value.trim()
    }
    return fallback
  }
  async function parseError(response: Response) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || 60
      agentWriteRetryAt = Date.now() + Math.max(1, seconds) * 1000
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown> & {
      data?: {
        message?: string
        remaining?: number
        required?: number
      }
    }
    if (response.status === 499)
      return 'The agent request was cancelled'
    return readErrorText(payload, `Agent service error (${response.status})`)
  }
  function labHeaders(json = false, idempotencyKey?: string) {
    const headers: Record<string, string> = {}
    if (json)
      headers['Content-Type'] = 'application/json'
    if (idempotencyKey)
      headers['Idempotency-Key'] = idempotencyKey
    if (projectScope.value)
      headers['x-agent-project-id'] = projectScope.value
    return headers
  }
  function agentContextSnapshot() {
    const history = messages.value
      .filter(item => item.kind !== 'error')
      .slice(-36)
      .map(item => ({
        role: item.role,
        kind: item.kind,
        content: clipMessageContent(item.content || ''),
        confirmation: item.confirmation
          ? {
              reason: item.confirmation.reason,

              inputUrls: item.confirmation.inputUrls,
              params: item.confirmation.params,
            }
          : undefined,
      }))
    const imagesOut = images.value.slice(0, MAX_CHAT_IMAGES).map(item => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      name: item.name,
      prompt: item.prompt,
      url: item.url,
      sourceUrl: item.sourceUrl,
      error: item.error,
      aspectRatio: item.aspectRatio,
      resolution: item.resolution,
      duration: item.duration,
      videoMode: item.videoMode,
      videoFamily: item.videoFamily,
      modelId: item.modelId,
      modelInput: item.modelInput,
      inputUrls: item.inputUrls,
      referenceVideoUrls: item.referenceVideoUrls,
    }))
    const seenUrls = new Set(imagesOut.map(item => item.url).filter(Boolean))
    for (const message of messages.value) {
      for (const url of message.confirmation?.inputUrls || []) {
        if (!url || seenUrls.has(url) || imagesOut.length >= MAX_CHAT_IMAGES)
          continue
        seenUrls.add(url)
        imagesOut.push({
          id: `ref:${url.slice(-96)}`,
          kind: 'upload',
          status: 'success',
          name: undefined,
          prompt: 'Session reference',
          url,
          sourceUrl: url,
          error: '',
          aspectRatio: '',
          resolution: '',
          duration: undefined,
          videoMode: undefined,
          videoFamily: undefined,
          modelId: undefined,
          modelInput: undefined,
          inputUrls: undefined,
          referenceVideoUrls: undefined,
        })
      }
    }
    return { history, images: imagesOut }
  }
  function trimLab() {
    messages.value = trimChatMessages(messages.value)
    const referenced = new Set(messages.value.flatMap(item => item.imageIds || []))
    const essential: AgentImage[] = []
    const seen = new Set<string>()
    for (const image of images.value) {
      const needed = image.status === 'generating'
        || image.status === 'fail'
        || image.kind === 'upload'
        || image.kind === 'document'
        || image.kind === 'video'
        || image.kind === 'still'
        || image.kind === 'cutout'
        || referenced.has(image.id)
        || (image.status === 'success' && image.kind !== 'upload' && !persistedCanvasIds.has(image.id))
      if (!needed)
        continue
      if (seen.has(image.id))
        continue
      essential.push(image)
      seen.add(image.id)
      if (essential.length >= MAX_CHAT_IMAGES)
        break
    }
    if (essential.length < MAX_CHAT_IMAGES) {
      for (const image of images.value) {
        if (seen.has(image.id))
          continue
        essential.push(image)
        seen.add(image.id)
        if (essential.length >= MAX_CHAT_IMAGES)
          break
      }
    }
    images.value = essential
  }
  function labSnapshot() {
    commitCurrentAgent()
    return {
      activeAgentId: activeAgentId.value,
      agents: storedAgents.value,
      sessionId: sessionId.value,
      messages: messages.value.map(item => ({
        ...item,
        streaming: false,
      })),
      images: images.value,
      confirmation: confirmation.value,
      choice: choice.value,
    } satisfies StoredLab
  }
  function shrinkAgentsForStorage(keepFullCount: number) {
    const sorted = [...storedAgents.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    const keepFull = new Set(sorted.slice(0, keepFullCount).map(a => a.id))
    // Always keep the active agent full so the current UI state survives.
    keepFull.add(activeAgentId.value)
    storedAgents.value = storedAgents.value.map((agent) => {
      if (keepFull.has(agent.id))
        return agent
      return {
        id: agent.id,
        title: agent.title,
        titleSource: agent.titleSource,
        sessionId: agent.sessionId,
        status: 'idle' as AgentStatus,
        pending: false,
        busy: false,
        queueNotice: '',
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        messages: [],
        images: [],
        confirmation: null,
        choice: null,
        draft: '',
      }
    })
  }

  function writeStore() {
    if (!import.meta.client || !storageKey.value)
      return
    trimLab()
    try {
      localStorage.setItem(storageKey.value, JSON.stringify(labSnapshot()))
      return
    }
    catch {
      // First fallback: trim the active agent's history.
      messages.value = trimChatMessages(messages.value.slice(-24))
      images.value = images.value.slice(0, 12)
      storedAgents.value = storedAgents.value.map((agent) => {
        if (agent.id !== activeAgentId.value)
          return agent
        return {
          ...agent,
          messages: trimChatMessages((agent.messages || []).slice(-24)),
          images: (agent.images || []).slice(0, 12),
        }
      })
    }
    try {
      localStorage.setItem(storageKey.value, JSON.stringify(labSnapshot()))
      return
    }
    catch {
      // Second fallback: drop full history for older agents, keep only metadata.
      // They will be re-hydrated from the server when selected.
      for (const keepCount of [10, 5, 2, 1]) {
        shrinkAgentsForStorage(keepCount)
        try {
          localStorage.setItem(storageKey.value, JSON.stringify(labSnapshot()))
          return
        }
        catch {
          // continue with fewer agents
        }
      }
    }
    // Last resort: drop the snapshot rather than crashing the tab.
  }
  async function persistChat(required = false) {
    if (!import.meta.client || !sessionId.value)
      return
    if (!messages.value.length && !images.value.length)
      return
    try {
      await $fetch('/api/ai/agent-chat', {
        method: 'POST',
        body: {
          sessionId: sessionId.value,
          projectId: projectScope.value,
          messages: messages.value
            .filter(item => !(item.kind === 'error' && isDisconnectError(item.content)))
            .map(item => ({
              id: item.id,
              role: item.role,
              kind: item.kind,
              content: item.content,
              imageIds: item.imageIds,
              confirmationState: item.confirmationState,
              confirmation: item.confirmation,
              resolvedParams: item.resolvedParams,
              choiceState: item.choiceState,
              choice: item.choice,
              choiceAnswers: item.choiceAnswers,
            })),
          images: images.value,
        },
      })
    }
    catch (cause) {
      if (required)
        throw cause
      // Local chat still remains if archive fails.
    }
  }
  function hydrateLocal() {
    const saved = readStore(storageKey.value) || readStore(projectScope.value
      ? `${STORAGE_PREFIX}local:${projectScope.value}`
      : `${STORAGE_PREFIX}local`)
    if (!saved) {
      seedDefaultAgent()
      return
    }
    if (saved.agents?.length) {
      storedAgents.value = saved.agents.map(agent => ({
        ...agent,
        createdAt: agent.createdAt || agent.updatedAt || 0,
        messages: (agent.messages || []).map(item => ({
          ...item,
          streaming: false,
        })),
        images: [...(agent.images || [])],
      }))
      const active = storedAgents.value.find(agent => agent.id === saved.activeAgentId)
        || storedAgents.value[0]
      if (active)
        applyAgent(active)
      else
        seedDefaultAgent()
      maybeAutoTitle()
      return
    }
    const migrated = emptyStoredAgent(DEFAULT_AGENT_TITLE)
    migrated.sessionId = saved.sessionId || ''
    migrated.messages = (saved.messages || []).map(item => ({
      ...item,
      streaming: false,
    }))
    migrated.images = [...(saved.images || [])]
    migrated.confirmation = saved.confirmation || null
    storedAgents.value = [migrated]
    applyAgent(migrated)
    maybeAutoTitle()
  }
  function canvasItems(source: AgentImage[]) {
    return source.filter(item => item.status === 'success'
      && item.kind !== 'upload'
      && /^https?:\/\//i.test(item.url))
  }
  function batchReferenceUrls() {
    const fromOpen = confirmation.value?.inputUrls || []
    if (fromOpen.length)
      return fromOpen
    for (let index = messages.value.length - 1; index >= 0; index--) {
      const urls = messages.value[index]?.confirmation?.inputUrls
      if (urls?.length)
        return urls
    }
    return []
  }
  function confirmationUrlsFor(item: AgentImage) {
    const owner = messages.value.find(message => message.imageIds?.includes(item.id) && Boolean(message.confirmation?.inputUrls?.length))
    if (owner?.confirmation?.inputUrls?.length)
      return owner.confirmation.inputUrls
    return batchReferenceUrls()
  }
  function stillRefsFor(item: AgentImage) {
    if (item.inputUrls?.length)
      return item.inputUrls.filter(url => /^https?:\/\//i.test(url) && !isMediaVideoUrl(url))
    if (item.videoMode === 'reference') {
      const batch = confirmationUrlsFor(item).filter(url => /^https?:\/\//i.test(url) && !isMediaVideoUrl(url))
      if (batch.length)
        return batch
    }
    if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl) && !isMediaVideoUrl(item.sourceUrl))
      return [item.sourceUrl]
    return []
  }
  function videoRefsFor(item: AgentImage) {
    if (item.referenceVideoUrls?.length)
      return item.referenceVideoUrls.filter(url => /^https?:\/\//i.test(url))
    if (item.videoMode === 'reference')
      return confirmationUrlsFor(item).filter(url => /^https?:\/\//i.test(url) && isMediaVideoUrl(url))
    return []
  }
  async function persistCanvasResults(source?: AgentImage[]) {
    const pid = projectScope.value
    if (!pid)
      return
    const pendingItems = canvasItems(source || images.value)
      .filter((item) => {
        if (!persistedCanvasIds.has(item.id))
          return true
        return !patchedInputIds.has(item.id) && stillRefsFor(item).length > 1
      })
      .map(item => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        prompt: item.prompt,
        url: item.url,
        sourceUrl: item.sourceUrl,
        inputUrls: stillRefsFor(item),
        referenceVideoUrls: videoRefsFor(item),
        aspectRatio: item.aspectRatio,
        resolution: item.resolution,
        duration: item.duration,
        videoMode: item.videoMode,
        videoFamily: item.videoFamily,
        modelId: item.modelId,
        modelInput: item.modelInput,
      }))
    if (!pendingItems.length)
      return
    for (let offset = 0; offset < pendingItems.length; offset += 8) {
      const chunk = pendingItems.slice(offset, offset + 8)
      try {
        const data = await $fetch<{
          jobs?: GenerationJobPublic[]
          importedIds?: string[]
        }>('/api/ai/agent-results', {
          method: 'POST',
          body: {
            projectId: pid,
            items: chunk,
          },
        })
        if (projectScope.value !== pid)
          return
        for (const id of data.importedIds || []) {
          persistedCanvasIds.add(id)
          patchedInputIds.add(id)
        }
        if (data.jobs?.length)
          onJobs.value?.(data.jobs)
      }
      catch {
        // Chat still keeps the result if canvas import fails.
      }
    }
  }
  function storedAgentFromChat(chat: {
    sessionId: string
    preview?: string
    createdAt?: number
    updatedAt?: number
    messages?: Array<{
      id?: string
      role?: 'user' | 'assistant'
      kind?: string
      content?: string
      imageIds?: string[]
      confirmationState?: AgentChatMessage['confirmationState']
      confirmation?: AgentChatMessage['confirmation']
      resolvedParams?: AgentChatMessage['resolvedParams']
      choice?: AgentChatMessage['choice']
      choiceState?: AgentChatMessage['choiceState']
      choiceAnswers?: AgentChatMessage['choiceAnswers']
    }>
    images?: Array<{
      id?: string
      kind?: string
      status?: AgentImage['status']
      name?: string
      prompt?: string
      url?: string
      error?: string
      sourceUrl?: string
      aspectRatio?: string
      resolution?: string
      duration?: number
    }>
  }): StoredAgent {
    const messages = sanitizeChatMessages((chat.messages || [])
      .filter(item => !(item.kind === 'error' && isDisconnectError(item.content || '')))
      .map(item => ({
        id: item.id || crypto.randomUUID(),
        role: item.role === 'user' ? 'user' as const : 'assistant' as const,
        kind: item.kind === 'error' ? 'error' as const : undefined,
        content: item.content || '',
        imageIds: item.imageIds,
        confirmationState: item.confirmationState,
        confirmation: item.confirmation || undefined,
        resolvedParams: item.resolvedParams || undefined,
        choice: item.choice || undefined,
        choiceState: item.choiceState || undefined,
        choiceAnswers: item.choiceAnswers,
      })))
    const images = (chat.images || [])
      .filter(item => item.id)
      .map(item => ({
        id: item.id || '',
        kind: (item.kind as AgentImage['kind']) || 'still',
        status: item.status || 'success',
        name: item.name,
        prompt: item.prompt || '',
        aspectRatio: item.aspectRatio || '',
        resolution: item.resolution || '',
        url: item.url || '',
        error: item.error || '',
        sourceUrl: item.sourceUrl || '',
        duration: item.duration || undefined,
      }))
    const title = titleFromMessage(chat.preview || '') || DEFAULT_AGENT_TITLE
    return {
      id: chat.sessionId,
      title,
      titleSource: title === DEFAULT_AGENT_TITLE ? 'default' : 'auto',
      sessionId: chat.sessionId,
      messages,
      images,
      confirmation: null,
      choice: null,
      draft: '',
      status: images.some(item => item.status === 'generating') ? 'generating' : 'idle',
      pending: false,
      busy: false,
      queueNotice: '',
      createdAt: chat.createdAt || chat.updatedAt || 0,
      updatedAt: chat.updatedAt || Date.now(),
    }
  }
  function mergeStoredAgents(current: StoredAgent, incoming: StoredAgent): StoredAgent {
    const currentMessages = current.messages || []
    const incomingMessages = incoming.messages || []
    // Session list rows use sessionId as agent id; keep the local UUID when present so
    // activeAgentId continues to resolve after homepage → project handoff.
    const preferIncomingId = (incomingMessages.length > currentMessages.length)
      && Boolean(incoming.choice || incoming.confirmation || incoming.messages?.some(item => item.choice || item.confirmation))
    return {
      ...current,
      id: preferIncomingId ? incoming.id : (current.id || incoming.id),
      title: current.titleSource === 'manual' ? current.title : (incoming.title || current.title),
      titleSource: current.titleSource === 'manual' ? 'manual' : (incoming.titleSource || current.titleSource),
      sessionId: current.sessionId || incoming.sessionId,
      messages: recoverAgentTranscript(currentMessages, incomingMessages, row => ({
        ...row,
        id: row.id || crypto.randomUUID(),
      })),
      images: unionSessionImages(current.images || [], incoming.images || []),
      confirmation: current.confirmation || incoming.confirmation || null,
      choice: current.choice || incoming.choice || null,
      draft: current.draft || incoming.draft || '',
      createdAt: current.createdAt || incoming.createdAt || current.updatedAt || incoming.updatedAt || 0,
      updatedAt: Math.max(current.updatedAt || 0, incoming.updatedAt || 0),
    }
  }
  function adoptRemoteAgents(incoming: StoredAgent[]) {
    // A read started before send can finish after the turn has begun. Applying
    // that archive would replace the active agent ID and orphan its SSE events.
    if (!incoming.length || activeTurns > 0)
      return
    // Homepage new-agent handoff writes the live transcript via SSE before
    // storedAgents is committed. Merge from the live snapshot or applyAgent
    // can replace a finished reply/choice with a stale user-only agent.
    commitCurrentAgent()
    const liveMessageCount = messages.value.length
    const liveChoiceId = choice.value?.id || ''
    const liveConfirmId = confirmation.value?.id || ''
    const byKey = new Map<string, StoredAgent>()
    for (const agent of [...incoming, ...storedAgents.value]) {
      const key = agent.sessionId || agent.id
      const previous = byKey.get(key)
      byKey.set(key, previous ? mergeStoredAgents(previous, agent) : agent)
    }
    const merged = [...byKey.values()]
    const activeId = activeAgentId.value
    // Keep the currently active agent even when it is still empty (e.g. homepage
    // Sketch to Image just called createAgent and only has a draft skill mention).
    // Dropping it here would fall back to an older nonempty agent after navigate.
    const nonempty = merged.filter(agent => !isEmptyStoredAgent(agent) || agent.id === activeId)
    storedAgents.value = nonempty.length ? nonempty : merged
    const active = storedAgents.value.find(agent => agent.id === activeId)
      || storedAgents.value.find(agent => agent.sessionId === sessionId.value && !isEmptyStoredAgent(agent))
      || storedAgents.value.find(agent => !isEmptyStoredAgent(agent))
      || storedAgents.value[0]
    if (!active)
      return
    const nextCount = (active.messages || []).length
    const nextHasLiveChoice = Boolean(liveChoiceId && active.messages?.some(item => item.choice?.id === liveChoiceId))
    const nextHasLiveConfirm = Boolean(liveConfirmId && active.messages?.some(item => item.confirmation?.id === liveConfirmId))
    // Never clobber a richer in-memory turn (common after / → project navigation).
    if (nextCount < liveMessageCount && (choice.value || confirmation.value || pending.value))
      return
    if ((liveChoiceId && !nextHasLiveChoice && choice.value) || (liveConfirmId && !nextHasLiveConfirm && confirmation.value))
      return
    applyAgent(active)
  }
  async function hydrateRemoteChats() {
    if (!projectScope.value)
      return
    try {
      const data = await $fetch<{
        items: Array<Parameters<typeof storedAgentFromChat>[0]>
      }>('/api/ai/agent-chats', {
        query: { projectId: projectScope.value },
      })
      adoptRemoteAgents((data.items || []).map(storedAgentFromChat))
    }
    catch {
      // Keep the local snapshot if archive is unavailable.
    }
  }
  async function hydrateRemoteSessions() {
    if (!projectScope.value)
      return
    try {
      const response = await fetch(`${baseUrl}/v1/sessions?projectId=${encodeURIComponent(projectScope.value)}&knownSessionIds=${encodeURIComponent(storedAgents.value.map(agent => agent.sessionId).filter(Boolean).join(','))}`, {
        credentials: 'omit',
      })
      if (!response.ok)
        return
      const data = await response.json() as {
        excludedSessionIds?: string[]
        items?: Array<{
          sessionId?: string
          title?: string
          images?: AgentImage[]
          messages?: Array<{
            role?: string
            content?: string
            imageIds?: string[]
          }>
          createdAt?: number
          updatedAt?: number
        }>
      }
      if (data.excludedSessionIds?.length && activeTurns === 0) {
        const excluded = new Set(data.excludedSessionIds)
        storedAgents.value = storedAgents.value.filter(agent => !excluded.has(agent.sessionId || ''))
        if (excluded.has(sessionId.value)) {
          const next = storedAgents.value[0] || emptyStoredAgent(DEFAULT_AGENT_TITLE)
          if (!storedAgents.value.length) storedAgents.value = [next]
          applyAgent(next)
        }
        writeStore()
      }
      const incoming = (data.items || [])
        .filter(item => item.sessionId)
        .map((item) => {
          const messages = sanitizeChatMessages((item.messages || [])
            .filter(row => row.role === 'user' || row.role === 'assistant')
            .map(row => ({
              id: crypto.randomUUID(),
              role: row.role as 'user' | 'assistant',
              content: row.content || '',
              imageIds: row.imageIds,
            })))
          return {
            id: item.sessionId!,
            title: item.title?.trim() || titleFromMessage(messages.find(row => row.role === 'user')?.content || '') || DEFAULT_AGENT_TITLE,
            titleSource: 'auto' as const,
            sessionId: item.sessionId,
            messages,
            images: item.images || [],
            confirmation: null,
            choice: null,
            draft: '',
            status: (item.images || []).some(image => image.status === 'generating') ? 'generating' as const : 'idle' as const,
            pending: false,
            busy: false,
            queueNotice: '',
            createdAt: item.createdAt || item.updatedAt || 0,
            updatedAt: item.updatedAt || Date.now(),
          } satisfies StoredAgent
        })
      adoptRemoteAgents(incoming)
    }
    catch {
      // Keep the local snapshot if the agent runtime is unavailable.
    }
  }
  function syncLabBusyFromImages() {
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      if (status.value === 'idle' || status.value === 'generating' || status.value === 'queued') {
        status.value = 'generating'
        pending.value = true
      }
      return
    }
    void maybeSettleMedia()
  }
  async function hydrateServer() {
    if (!sessionId.value)
      return { busy: false, hasPendingConfirm: false }
    const requestedSessionId = sessionId.value
    const requestedAgentId = activeAgentId.value
    const requestedEpoch = streamEpoch
    try {
      const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(requestedSessionId)}`, {
        credentials: 'omit',
      })
      if (!response.ok)
        return { busy: false, hasPendingConfirm: false }
      const data = await response.json() as {
        title?: string
        images?: AgentImage[]
        pendingConfirmation?: ConfirmationPayload | null
        pendingChoice?: ChoicePayload | null
        messages?: Array<{
          id?: string
          role: 'user' | 'assistant'
          content: string
          imageIds?: string[]
        }>
        busy?: boolean
      }
      if (requestedSessionId !== sessionId.value || requestedAgentId !== activeAgentId.value || requestedEpoch !== streamEpoch)
        return { busy: false, hasPendingConfirm: false }
      if (Date.now() >= agentWriteRetryAt && isAgentTransientMessage({ kind: 'error', content: error.value }))
        error.value = ''
      // SSE and polling must not both append the same assistant turn.
      if (activeTurns === 0 && Array.isArray(data.messages)) {
        messages.value = recoverAgentTranscript(messages.value, data.messages, row => ({
          ...row,
          id: row.id || crypto.randomUUID(),
          streaming: false,
        }))
      }
      if (typeof data.title === 'string' && data.title.trim() && titleSource.value !== 'manual') {
        agentTitle.value = data.title.trim()
        titleSource.value = 'auto'
      }
      if (Array.isArray(data.images) && data.images.length)
        images.value = unionSessionImages(images.value, data.images)
      trackSnapshotFails(images.value)
      syncLabBusyFromImages()
      let hasPendingConfirm = false
      if (data.pendingConfirmation) {
        const pendingCard = data.pendingConfirmation
        const message = messages.value.find(item => item.confirmation?.id === pendingCard.id)
        const auto = shouldAutoApprove(pendingCard)
        const payload = auto
          ? { ...pendingCard, approvedBy: 'agent' as const }
          : pendingCard
        if (message) {
          message.confirmation = { ...payload, approvedBy: payload.approvedBy || message.confirmation?.approvedBy }
          if (auto) {
            message.confirmationState = 'confirmed'
            message.resolvedParams = payload.params
          }
          else if (!message.confirmationState || message.confirmationState === 'pending') {
            message.confirmationState = 'pending'
          }
        }
        else if (auto || !messages.value.some(item => item.confirmation?.id === pendingCard.id)) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            confirmation: payload,
            confirmationState: auto ? 'confirmed' : 'pending',
            resolvedParams: auto ? payload.params : undefined,
          })
        }
        confirmation.value = payload
        hasPendingConfirm = true
        if (!auto) {
          status.value = 'idle'
          queueNotice.value = ''
          pending.value = true
        }
        if (auto) {
          status.value = status.value === 'idle' ? 'generating' : status.value
          pending.value = true
        }
      }
      if (data.pendingChoice) {
        const pendingCard = data.pendingChoice
        const message = messages.value.find(item => item.choice?.id === pendingCard.id)
        if (message) {
          message.choice = pendingCard
          if ((!data.busy && activeTurns === 0) || (message.choiceState !== 'answered' && message.choiceState !== 'skipped'))
            message.choiceState = 'pending'
        }
        else if (!messages.value.some(item => item.choice?.id === pendingCard.id)) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            choice: pendingCard,
            choiceState: 'pending',
          })
        }
        choice.value = pendingCard
        status.value = 'idle'
        queueNotice.value = ''
        pending.value = true
      }
      const busy = Boolean(data.busy)
      if (busy && !data.pendingChoice && !(data.pendingConfirmation && !shouldAutoApprove(data.pendingConfirmation))) {
        if (status.value === 'idle' || status.value === 'generating' || status.value === 'queued')
          status.value = images.value.some(item => item.status === 'generating') ? 'generating' : 'thinking'
        pending.value = true
      }
      if (activeTurns === 0) {
        if (data.pendingConfirmation === null) {
          confirmation.value = null
          for (const message of messages.value) {
            if (message.confirmationState === 'pending')
              message.confirmationState = message.imageIds?.length || message.confirmation?.approvedBy === 'agent' ? 'confirmed' : 'cancelled'
          }
        }
        if (data.pendingChoice === null) {
          choice.value = null
          for (const message of messages.value) {
            if (message.choiceState === 'pending')
              message.choiceState = message.choiceAnswers?.length ? 'answered' : 'skipped'
          }
        }
      }
      reconcileConfirmationStates(messages.value, images.value)
      if (activeTurns === 0 && data.busy === false) {
        const generating = images.value.some(item => item.status === 'generating')
          || Boolean(confirmation.value && shouldAutoApprove(confirmation.value))
        status.value = generating ? 'generating' : 'idle'
        pending.value = generating || waitingForUser.value
        queueNotice.value = ''
        if (!pending.value)
          stopping.value = false
        if (isDisconnectError(error.value))
          error.value = ''
      }
      return { busy, hasPendingConfirm }
    }
    catch {
      // Keep the local snapshot if the agent runtime is unavailable.
      return { busy: false, hasPendingConfirm: false }
    }
  }
  function patchStoredAgent(id: string, patch: (agent: StoredAgent) => StoredAgent) {
    storedAgents.value = storedAgents.value.map((agent) => {
      if (agent.id !== id)
        return agent
      return patch({
        ...agent,
        messages: (agent.messages || []).map(item => ({ ...item })),
        images: (agent.images || []).map(item => ({ ...item })),
      })
    })
  }
  function applyEventToState(event: AgentEvent, state: {
    sessionId: string
    messages: AgentChatMessage[]
    images: AgentImage[]
    confirmation: ConfirmationPayload | null
    choice: ChoicePayload | null
    status: AgentStatus
    title: string
    titleSource: AgentTitleSource
    queueNotice: string
    pending: boolean
  }) {
    if (event.type === 'session' && event.sessionId)
      state.sessionId = event.sessionId
    if (event.type === 'status' && event.status) {
      const generatingMedia = state.images.some(item => item.status === 'generating')
      const holdForAutoConfirm = state.confirmation?.approvedBy === 'agent'
      if (event.status === 'idle' && (generatingMedia || holdForAutoConfirm)) {
        state.status = generatingMedia ? 'generating' : (state.status === 'idle' ? 'generating' : state.status)
        state.pending = true
      }
      else {
        state.status = event.status
        if (event.status === 'idle') {
          state.pending = Boolean(state.confirmation && state.confirmation.approvedBy !== 'agent')
            || Boolean(state.choice)
        }
        else {
          state.pending = true
        }
        if (event.status !== 'queued')
          state.queueNotice = ''
      }
    }
    if (event.type === 'title' && event.title) {
      state.title = event.title
      state.titleSource = 'auto'
    }
    if (event.type === 'queue' && event.message) {
      state.status = 'queued'
      state.pending = true
      state.queueNotice = event.message
    }
    if (event.type === 'text_replace' && event.delta) {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        last.content = event.delta
      }
      else {
        state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: event.delta, streaming: true })
      }
    }
    if (event.type === 'text' && event.delta) {
      const last = state.messages[state.messages.length - 1]
      const duplicateStop = event.delta.includes('Stopped.') && last?.role === 'assistant' && last.content.includes('Stopped.')
      if (!duplicateStop) {
        if (last?.role === 'assistant' && last.kind !== 'error' && last.streaming) {
          last.content += event.delta
          last.content = clipMessageContent(last.content)
        }
        else if (last?.role === 'assistant' && last.kind !== 'error' && !last.content && last.imageIds?.length) {
          last.content = event.delta
          last.streaming = true
        }
        else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.delta,
            streaming: true,
          })
        }
      }
    }
    if (event.type === 'confirmation' && event.confirmation) {
      const auto = shouldAutoApprove(event.confirmation)
      const payload = auto
        ? { ...event.confirmation, approvedBy: 'agent' as const }
        : event.confirmation
      state.confirmation = payload
      state.status = auto ? 'generating' : 'idle'
      state.queueNotice = ''
      state.pending = true
      const existing = state.messages.find(message => message.confirmation?.id === payload.id)
      const last = existing || state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.kind !== 'error' && (existing || (!last.confirmation && !last.choice && !last.imageIds?.length))) {
        last.streaming = false
        last.confirmation = { ...payload, approvedBy: payload.approvedBy || last.confirmation?.approvedBy }
        last.confirmationState = auto ? 'confirmed' : (last.confirmationState || 'pending')
        if (auto) {
          last.resolvedParams = payload.params
          state.status = 'generating'
          state.pending = true
        }
      }
      else {
        state.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          confirmation: payload,
          confirmationState: auto ? 'confirmed' : 'pending',
          resolvedParams: auto ? payload.params : undefined,
        })
        if (auto) {
          state.status = 'generating'
          state.pending = true
        }
      }
    }
    if (event.type === 'choice' && event.choice) {
      state.choice = event.choice
      state.status = 'idle'
      state.queueNotice = ''
      state.pending = true
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant' && last.kind !== 'error') {
        last.streaming = false
        const sameChoice = last.choice?.id === event.choice.id
        last.choice = event.choice
        last.choiceState = sameChoice && (last.choiceState === 'answered' || last.choiceState === 'skipped')
          ? last.choiceState
          : 'pending'
      }
      else {
        state.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          choice: event.choice,
          choiceState: 'pending',
        })
      }
    }
    if (event.type === 'image' && event.image) {
      const index = state.images.findIndex(item => item.id === event.image!.id)
      const known = index >= 0
      if (index >= 0)
        state.images[index] = event.image
      else
        state.images.unshift(event.image)
      if (!known && !event.replay && event.image.kind !== 'upload') {
        const owner = state.messages.find(message => message.confirmation && confirmationMedia(message, [event.image!]).length)
        const last = owner || state.messages[state.messages.length - 1]
        if (last?.role === 'assistant' && last.kind !== 'error') {
          const ids = last.imageIds || []
          if (!ids.includes(event.image.id))
            last.imageIds = [...ids, event.image.id]
        }
        else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            imageIds: [event.image.id],
          })
        }
      }
      reconcileConfirmationStates(state.messages, state.images)
      if (event.image.status === 'generating') {
        state.status = 'generating'
        state.pending = true
      }
      if (event.image.status === 'success')
        void persistCanvasResults([event.image])
    }
    if (event.type === 'error' && event.message) {
      const content = event.message.trim()
      if (content && /pending generation first/i.test(content) && state.confirmation) {
        // Confirmation was re-attached in the same stream; auto-approve / the card will continue.
      }
      else if (content && /pending questions first/i.test(content) && state.choice) {
        // Choice card was re-attached in the same stream.
      }
      else if (content && !isAgentTransientMessage({ kind: 'error', content })) {
        const last = state.messages[state.messages.length - 1]
        if (!(last?.kind === 'error' && last.content === content)) {
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            kind: 'error',
            content,
          })
        }
      }
    }
    if (event.type === 'navigate' && event.path) {
      const target = String(event.path || '').trim()
      if (target.startsWith('/')) {
        const reason = String((event as { reason?: string }).reason || '').trim()
        if (reason === 'test_now' && import.meta.client) {
          try {
            sessionStorage.setItem('polox-force-skill-mode', 'test')
          }
          catch {
            // Ignore private-mode failures.
          }
        }
        try {
          const url = new URL(target, 'http://local.invalid')
          const query = Object.fromEntries(url.searchParams.entries()) as Record<string, string>
          if (reason === 'test_now') {
            query.mode = query.mode || 'agent'
            query.skillMode = 'test'
            // Ensure the route actually changes when already on this project page.
            query.skillSwitch = String(Date.now())
          }
          void navigateTo({ path: url.pathname, query }, { replace: Boolean(reason === 'test_now' || reason === 'save_and_exit') })
        }
        catch {
          void navigateTo(target)
        }
      }
    }
    if (event.type === 'done') {
      const last = state.messages[state.messages.length - 1]
      if (last?.streaming)
        last.streaming = false
      const generatingMedia = state.images.some(item => item.status === 'generating')
      const holdForAutoConfirm = state.confirmation?.approvedBy === 'agent'
      if (state.status !== 'idle' && !generatingMedia && !holdForAutoConfirm)
        state.status = 'idle'
      else if (generatingMedia || holdForAutoConfirm)
        state.status = 'generating'
      state.pending = Boolean(state.confirmation && state.confirmation.approvedBy !== 'agent')
        || Boolean(state.choice)
        || generatingMedia
        || holdForAutoConfirm
        || state.status === 'generating'
        || state.status === 'queued'
      if (state.status === 'idle')
        state.queueNotice = ''
    }
    return state
  }
  function applyEvent(event: AgentEvent, agentId = activeAgentId.value) {
    if (agentId && agentId !== activeAgentId.value) {
      patchStoredAgent(agentId, (agent) => {
        const next = applyEventToState(event, {
          sessionId: agent.sessionId || '',
          messages: agent.messages || [],
          images: agent.images || [],
          confirmation: agent.confirmation || null,
          choice: agent.choice || null,
          status: agent.status || 'idle',
          title: agent.title || DEFAULT_AGENT_TITLE,
          titleSource: agent.titleSource || 'default',
          queueNotice: agent.queueNotice || '',
          pending: Boolean(agent.pending),
        })
        return {
          ...agent,
          sessionId: next.sessionId,
          messages: next.messages,
          images: next.images,
          confirmation: next.confirmation,
          choice: next.choice,
          status: next.status,
          title: next.title,
          titleSource: next.titleSource,
          queueNotice: next.queueNotice,
          pending: next.pending,
          busy: next.pending || next.status !== 'idle',
          updatedAt: Date.now(),
        }
      })
      return
    }

    if (event.type === 'image' && event.image && !event.replay && event.image.kind !== 'upload' && failBaselineReady
      && (event.image.status === 'generating' || event.image.status === 'fail')) {
      // Live SSE output of the current turn (replayed catch-up images are history).
      liveObservedIds.add(event.image.id)
    }
    const next = applyEventToState(event, {
      sessionId: sessionId.value,
      messages: messages.value,
      images: images.value,
      confirmation: confirmation.value,
      choice: choice.value,
      status: status.value,
      title: agentTitle.value,
      titleSource: titleSource.value,
      queueNotice: queueNotice.value,
      pending: pending.value,
    })
    sessionId.value = next.sessionId
    messages.value = next.messages
    images.value = next.images
    confirmation.value = next.confirmation
    choice.value = next.choice
    status.value = next.status
    agentTitle.value = next.title
    titleSource.value = next.titleSource
    queueNotice.value = next.queueNotice
    pending.value = next.pending
    if (event.type === 'error' && event.message)
      error.value = ''
    if (event.type === 'done')
      trimLab()
  }
  async function consumeSse(response: Response, epoch = streamEpoch, agentId = activeAgentId.value) {
    if (!response.ok)
      throw new Error(await parseError(response))
    if (!response.body)
      throw new Error('Agent service returned an empty stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let locked = false
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let idx = buffer.indexOf('\n\n')
      while (idx >= 0) {
        const event = parseSseBlock(buffer.slice(0, idx))
        buffer = buffer.slice(idx + 2)
        idx = buffer.indexOf('\n\n')
        if (!event)
          continue
        if (event.type === 'error' && isSessionLockError(String(event.message || ''))) {
          locked = true
          continue
        }
        if (epoch === streamEpoch || agentId !== activeAgentId.value)
          applyEvent(event, agentId)
      }
    }
    return locked
  }
  async function ping() {
    try {
      const response = await fetch(`${baseUrl}/health`, { credentials: 'omit' })
      online.value = response.ok
    }
    catch {
      online.value = false
    }
  }
  async function ensureSession() {
    if (sessionId.value)
      return sessionId.value
    const response = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      credentials: 'omit',
      headers: labHeaders(false, crypto.randomUUID()),
    })
    const data = await response.json().catch(() => ({})) as {
      sessionId?: string
      error?: string
    }
    if (!response.ok || !data.sessionId)
      throw new Error(data.error || 'Could not start an agent session')
    sessionId.value = data.sessionId
    return sessionId.value
  }
  function revokePreview(item: PendingAttachment) {
    if (item.previewUrl.startsWith('blob:'))
      URL.revokeObjectURL(item.previewUrl)
  }
  function removeAttachment(id: string) {
    const item = attachments.value.find(entry => entry.id === id)
    if (item)
      revokePreview(item)
    attachments.value = attachments.value.filter(entry => entry.id !== id)
  }
  function attachUrls(items: Array<{
    url: string
    name?: string
    kind?: 'image' | 'audio' | 'video' | 'document'
  }>) {
    const next = items.filter((item) => {
      const url = String(item.url || '').trim()
      return /^https?:\/\//i.test(url) && !url.toLowerCase().startsWith('blob:')
    })
    if (!next.length) {
      setLabError('Only project media can be attached')
      return
    }
    const unique = next.filter(item => !attachments.value.some(existing => existing.url === item.url))
    if (!unique.length)
      return
    if (attachments.value.length + unique.length > 9) {
      setLabError('Up to 9 attachments per message')
      return
    }
    clearLabError()
    for (const item of unique) {
      // Media is project-scoped: look up the url across every agent, not just
      // the active one, so attaching a canvas asset never duplicates its record.
      const existing = images.value.find(image => image.url === item.url)
        || storedAgents.value.flatMap(agent => agent.images || []).find(image => image.url === item.url)
      const audio = item.kind === 'audio' || existing?.kind === 'audio' || isMediaAudioUrl(item.url)
      const video = !audio && (item.kind === 'video' || existing?.kind === 'video' || isMediaVideoUrl(item.url))
      const document = !audio && !video && (item.kind === 'document' || existing?.kind === 'document' || isMediaDocumentUrl(item.url) || /\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(item.name || ''))
      const imageId = existing?.id || crypto.randomUUID()
      const local = images.value.find(image => image.url === item.url)
      if (!local) {
        images.value.unshift({
          id: imageId,
          kind: document ? 'document' : audio ? 'audio' : video ? 'video' : 'upload',
          status: 'success',
          name: item.name || (document ? 'Document' : audio ? 'Voice reference' : video ? 'Video reference' : 'Canvas still'),
          prompt: item.name || (document ? 'Document' : audio ? 'Voice reference' : video ? 'Video reference' : 'Canvas still'),
          aspectRatio: 'auto',
          resolution: '',
          url: item.url,
          error: '',
        })
      }
      attachments.value = [...attachments.value, {
        id: crypto.randomUUID(),
        name: item.name || (document ? 'Document' : audio ? 'Voice reference' : video ? 'Video reference' : 'Canvas still'),
        previewUrl: (audio || document) ? '' : item.url,
        url: item.url,
        status: 'ready',
        error: '',
        imageId,
        kind: document ? 'document' : audio ? 'audio' : video ? 'video' : 'image',
      }]
    }
  }
  async function uploadAnnotationImage(file: File, requirePersist = false) {
    const isImage = isAgentImageFile(file)
    const isAudio = isAgentAudioFile(file)
    if (!isImage && !isAudio)
      throw new Error('Upload a JPEG, PNG, WEBP, GIF, or MP3/WAV/AAC/OGG/M4A/WEBM up to the size limit.')
    if (isImage && file.size > 10 * 1024 * 1024)
      throw new Error('Upload a JPEG, PNG, WEBP, or GIF up to 10MB.')
    if (isAudio && file.size > 15 * 1024 * 1024)
      throw new Error('Upload MP3/WAV/AAC/OGG/M4A/WEBM audio up to 15MB.')
    const id = await ensureSession()
    const body = new FormData()
    body.append('file', file)
    const response = await fetch(`${baseUrl}/v1/uploads?sessionId=${encodeURIComponent(id)}`, {
      method: 'POST',
      credentials: 'include',
      headers: labHeaders(false, crypto.randomUUID()),
      body,
    })
    const payload = await response.json() as { image?: AgentImage, error?: string }
    if (!response.ok || !payload.image?.url)
      throw new Error(payload.error || 'Upload failed')
    const image = payload.image
    images.value = [image, ...images.value.filter(item => item.id !== image.id)]
    await persistChat(requirePersist)
    return { url: image.url!, name: image.name || file.name.slice(0, 100) }
  }

  async function attachFiles(fileList: File[]) {
    const accepted = fileList.filter(file => isAgentImageFile(file) || isAgentAudioFile(file) || isAgentVideoFile(file) || isAgentDocumentFile(file))
    if (!accepted.length) {
      setLabError('Upload JPEG, PNG, WEBP, GIF, MP4/MOV/WEBM video, MP3/WAV/AAC/OGG/M4A/WEBM audio, or PDF/DOCX/PPTX/XLSX/CSV')
      return
    }
    if (attachments.value.length + accepted.length > 9) {
      setLabError('Up to 9 attachments per message')
      return
    }
    clearLabError()
    const id = await ensureSession()
    for (const file of accepted) {
      const audio = isAgentAudioFile(file)
      const video = !audio && isAgentVideoFile(file)
      const document = !audio && !video && isAgentDocumentFile(file)
      const maxBytes = audio ? 15 * 1024 * 1024 : video ? 200 * 1024 * 1024 : document ? 40 * 1024 * 1024 : 10 * 1024 * 1024
      if (file.size > maxBytes) {
        setLabError(audio
          ? 'Each audio file must be 15MB or smaller'
          : video
            ? 'Each video must be 200MB or smaller'
            : document
              ? 'Each document must be 40MB or smaller'
              : 'Each image must be 10MB or smaller')
        continue
      }
      const local: PendingAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        previewUrl: (audio || document) ? '' : URL.createObjectURL(file),
        url: '',
        status: 'uploading',
        error: '',
        kind: audio ? 'audio' : video ? 'video' : document ? 'document' : 'image',
      }
      attachments.value = [...attachments.value, local]
      try {
        const body = new FormData()
        body.append('file', file)
        const response = await fetch(`${baseUrl}/v1/uploads?sessionId=${encodeURIComponent(id)}`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(false, crypto.randomUUID()),
          body,
        })
        const payload = await response.json().catch(() => ({})) as {
          sessionId?: string
          image?: AgentImage
          error?: string
        }
        if (!response.ok || !payload.image?.url)
          throw new Error(readErrorMessage(payload, 'Upload failed'))
        if (payload.sessionId)
          sessionId.value = payload.sessionId
        const current = attachments.value.find(item => item.id === local.id)
        if (current) {
          current.status = 'ready'
          current.url = payload.image.url
          current.imageId = payload.image.id
          if (payload.image.kind === 'document')
            current.kind = 'document'
          else if (payload.image.kind === 'audio')
            current.kind = 'audio'
          else if (payload.image.kind === 'video')
            current.kind = 'video'
        }
        const index = images.value.findIndex(item => item.id === payload.image!.id)
        if (index >= 0)
          images.value[index] = payload.image
        else
          images.value.unshift(payload.image)
      }
      catch (err) {
        const current = attachments.value.find(item => item.id === local.id)
        if (current) {
          current.status = 'fail'
          current.error = err instanceof Error ? err.message : 'Upload failed'
        }
        setLabError(err instanceof Error ? err.message : 'Upload failed')
      }
    }
  }
  /** Transcript-only: Skill Creator markers, ignoring the current title. */
    function agentTranscriptLooksLikeSkillEdit(agent: StoredAgent) {
      const messages = agent.messages || []
      return messages.some((item) => {
        const content = String(item.content || '')
        return /(?:^|\s)\/skill-creator(?=\s|$)/.test(content)
          || content.includes('INTERNAL_EDIT_CONTEXT')
          || content.includes('exit_skill_creator')
          || content.includes('save_user_skill')
      })
    }


    function agentLooksLikeSkillEdit(agent: StoredAgent) {
      // Title alone is not enough — auto-titles and swapped titles lied to us before.
      return agentTranscriptLooksLikeSkillEdit(agent)
    }


    function richestSkillCreatorAgent(excludeIds: string[] = []) {
      const skip = new Set(excludeIds)
      return [...storedAgents.value]
        .filter(agent => !skip.has(agent.id) && agentTranscriptLooksLikeSkillEdit(agent))
        .sort((a, b) => ((b.messages || []).length - (a.messages || []).length) || ((b.updatedAt || 0) - (a.updatedAt || 0)))[0]
    }

  /** Force Skill Creator transcripts onto Edit, and keep Test free of creator history. */
    function reconcileSkillWorkspaceAgents() {
      const lock = (id: string, title: 'Edit' | 'Test') => {
        const list = storedAgents.value.slice()
        const idx = list.findIndex(agent => agent.id === id)
        if (idx < 0)
          return
        const row = list[idx]!
        if (row.title === title && row.titleSource === 'manual')
          return
        list[idx] = { ...row, title, titleSource: 'manual', updatedAt: Date.now() }
        storedAgents.value = list
        if (activeAgentId.value === id) {
          agentTitle.value = title
          titleSource.value = 'manual'
        }
      }

      const creator = richestSkillCreatorAgent()
      if (creator) {
        const titledEdit = storedAgents.value.find(agent => String(agent.title || '').trim() === 'Edit')
        // Demote a wrongly titled Edit that is not the creator transcript.
        if (titledEdit && titledEdit.id !== creator.id && !agentTranscriptLooksLikeSkillEdit(titledEdit)) {
          const hasOtherTest = storedAgents.value.some(agent =>
            agent.id !== titledEdit.id && String(agent.title || '').trim() === 'Test',
          )
          lock(titledEdit.id, hasOtherTest ? 'Test' : 'Test')
        }
        lock(creator.id, 'Edit')
      }

      // If something titled Test still holds Skill Creator history, strip that title so
      // ensureNamedAgent('Test') can mint a clean Test agent.
      for (const agent of storedAgents.value) {
        if (String(agent.title || '').trim() !== 'Test')
          continue
        if (!agentTranscriptLooksLikeSkillEdit(agent))
          continue
        // Creator path above should have renamed it Edit; if another Edit exists, retitle this away.
        if (String(richestSkillCreatorAgent()?.id || '') === agent.id)
          lock(agent.id, 'Edit')
        else
          lock(agent.id, 'Edit')
      }
      writeStore()
    }

  /** Find or create a named agent (Edit vs Test) so skill modes keep separate chat history. */
    function ensureNamedAgent(title: string) {
      reconcileSkillWorkspaceAgents()
      const wanted = String(title || '').trim() || DEFAULT_AGENT_TITLE
      const lockTitle = (id: string) => {
        const list = storedAgents.value.slice()
        const idx = list.findIndex(agent => agent.id === id)
        if (idx < 0)
          return id
        const row = list[idx]!
        if (row.title === wanted && row.titleSource === 'manual')
          return id
        list[idx] = { ...row, title: wanted, titleSource: 'manual', updatedAt: Date.now() }
        storedAgents.value = list
        if (activeAgentId.value === id) {
          agentTitle.value = wanted
          titleSource.value = 'manual'
        }
        writeStore()
        return id
      }

      if (wanted === 'Edit') {
        const creator = richestSkillCreatorAgent()
        if (creator)
          return lockTitle(creator.id)
        const byTitle = storedAgents.value.find(agent => String(agent.title || '').trim() === 'Edit')
        if (byTitle)
          return lockTitle(byTitle.id)
        commitCurrentAgent()
        void persistChat()
        const next = emptyStoredAgent('Edit')
        next.titleSource = 'manual'
        storedAgents.value = [...storedAgents.value, next]
        writeStore()
        return next.id
      }

      if (wanted === 'Test') {
        // Never reuse a Skill Creator transcript as Test.
        const byTitle = storedAgents.value.find(agent =>
          String(agent.title || '').trim() === 'Test' && !agentTranscriptLooksLikeSkillEdit(agent),
        )
        if (byTitle)
          return lockTitle(byTitle.id)
        commitCurrentAgent()
        void persistChat()
        const next = emptyStoredAgent('Test')
        next.titleSource = 'manual'
        storedAgents.value = [...storedAgents.value, next]
        writeStore()
        return next.id
      }

      const byTitle = storedAgents.value.find(agent => String(agent.title || '').trim() === wanted)
      if (byTitle)
        return lockTitle(byTitle.id)

      commitCurrentAgent()
      void persistChat()
      const next = emptyStoredAgent(wanted)
      next.titleSource = 'manual'
      storedAgents.value = [...storedAgents.value, next]
      writeStore()
      return next.id
    }


  function stripLockedSkillCommands(raw: string, ids: readonly string[]) {
    let next = String(raw || '')
    for (const id of ids) {
      if (!id)
        continue
      next = next.replace(new RegExp(`(?:^|\s)/${id}(?=\s|$)`, 'g'), ' ')
    }
    return next.replace(/\s+/g, ' ').trim()
  }


  function historyHasSkillCommand(id: string) {
    if (!id)
      return false
    const re = new RegExp(`(?:^|\s)/${id}(?=\s|$)`)
    return messages.value.some(item => item.role === 'user' && re.test(item.content || ''))
  }


  function consumeEditSkillBrief(outboundText: string) {
    if (!import.meta.client)
      return ''
    if (!/(?:^|\s)\/skill-creator(?=\s|$)/.test(outboundText))
      return ''
    try {
      const brief = String(sessionStorage.getItem('polox-edit-skill-brief') || '').trim()
      if (!brief)
        return ''
      sessionStorage.removeItem('polox-edit-skill-brief')
      return brief
    }
    catch {
      return ''
    }
  }

  async function sendMessage(options?: { newAgent?: boolean, sketchFile?: File, lockedSkillIds?: string[] }): Promise<boolean> {
    if (options?.sketchFile) {
      if (pending.value || waitingForUser.value || attaching.value || status.value === 'generating' || status.value === 'queued')
        return false
      if (attachments.value.length >= 9)
        throw new Error('Remove an attachment to make room for your sketch (up to 9 images per message).')
      const originAgent = activeAgentId.value
      let sketchAttachmentId = ''
      uploadingSketch.value = true
      try {
        const image = await uploadAnnotationImage(options.sketchFile, true)
        if (originAgent !== activeAgentId.value)
          throw new Error('The active agent changed. Return to your sketch and send again.')
        attachUrls([image])
        const sketch = attachments.value.find(item => item.url === image.url)
        if (!sketch)
          throw new Error('Could not attach your sketch. Please try again.')
        sketchAttachmentId = sketch.id
        attachments.value = [sketch, ...attachments.value.filter(item => item.id !== sketch.id)]
      }
      finally {
        uploadingSketch.value = false
      }
      try {
        const sent = await sendMessage({ ...options, sketchFile: undefined })
        if (!sent)
          removeAttachment(sketchAttachmentId)
        return sent
      }
      catch (error) {
        removeAttachment(sketchAttachmentId)
        throw error
      }
    }
    const text = draft.value.trim()
    const editBrief = consumeEditSkillBrief(text)
    const lockedIds = [...new Set((options?.lockedSkillIds || []).map(id => String(id || '').trim()).filter(Boolean))]
    // Locked Test/Edit skills: composer keeps the chip; only prime `/id` once per chat so later
    // turns do not resend the trigger (and burn tokens) on every message.
    const primeIds = lockedIds.filter(id => !historyHasSkillCommand(id))
    const bodyWithoutLocked = lockedIds.length ? stripLockedSkillCommands(text, lockedIds) : text
    const primedBody = primeIds.length
      ? [primeIds.map(id => `/${id}`).join(' '), bodyWithoutLocked].filter(Boolean).join(' ').trim()
      : bodyWithoutLocked
    const outbound = editBrief ? `${editBrief}\n\n${primedBody}` : primedBody
    const ready = readyAttachments.value
    if (options?.newAgent) {
      if ((!outbound && !ready.length) || attaching.value || attachments.value.some(item => item.status === 'fail')) {
        return false
      }
      if (!canCreateAgent.value) {
        setLabError('Cannot create a new agent right now. Wait for the current turn to finish.')
        return false
      }
      // Move the submitted input into a fresh agent without carrying its history.
      const inputImages = images.value.filter(item => ready.some(attachment => attachment.imageId === item.id))
      const inputAttachments = attachments.value
      attachments.value = []
      createAgent()
      draft.value = text
      attachments.value = inputAttachments
      images.value = inputImages
    }
    if (!confirmation.value && sessionId.value)
      await hydrateServer()
    if (confirmation.value && shouldAutoApprove(confirmation.value)) {
      clearLabError()
      draft.value = ''
      clearComposerDraft()
      await maybeAutoApprove()
      if (confirmation.value || pending.value || status.value === 'generating' || status.value === 'queued')
        return false
    }
    if (waitingForUserChoice.value) {
      setLabError('Answer or skip the pending questions first')
      return false
    }
    if (waitingForUserConfirm.value) {
      setLabError('Confirm or cancel the pending generation first')
      return false
    }
    if ((!outbound && !ready.length) || pending.value || waitingForUser.value || attaching.value || status.value === 'generating' || status.value === 'queued') {
      return false
    }
    if (attachments.value.some(item => item.status === 'fail'))
      return false
    clearLabError()
    draft.value = ''
    clearComposerDraft()
    const imageIds = ready.map(item => item.imageId).filter((id): id is string => Boolean(id))
    const urls = ready.map(item => item.url)
    attachments.value.forEach(revokePreview)
    attachments.value = []
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: outbound,
      imageIds,
    })
    pending.value = true
    status.value = 'thinking'
    stopping.value = false
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    writeStore()
    void runAgentTurn(epoch, runAgentId, outbound, urls)
    return true
  }
  async function stopAgent() {
    if (!sessionId.value || stopping.value)
      return false
    if (!pending.value && status.value === 'idle')
      return false
    stopping.value = true
    try {
      const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId.value)}/stop`, {
        method: 'POST',
        credentials: 'omit',
        headers: labHeaders(true, crypto.randomUUID()),
        body: '{}',
      })
      if (!response.ok) {
        const text = await parseError(response).catch(() => `Stop failed (${response.status})`)
        throw new Error(text || `Stop failed (${response.status})`)
      }
      const alreadyNoted = messages.value.some(item => item.role === 'assistant' && item.content.includes('Stopped.'))
      if (!alreadyNoted) {
        const last = messages.value[messages.value.length - 1]
        if (last?.role === 'assistant' && last.streaming)
          last.streaming = false
        messages.value.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Stopped. In-progress generations will keep running.',
        })
      }
      if (confirmation.value?.approvedBy !== 'agent') {
        const open = confirmation.value
        if (open) {
          const message = messages.value.find(item => item.confirmation?.id === open.id)
          if (message && message.confirmationState === 'pending')
            message.confirmationState = 'cancelled'
        }
        confirmation.value = null
      }
      if (choice.value) {
        const open = choice.value
        const message = messages.value.find(item => item.choice?.id === open.id)
        if (message && message.choiceState === 'pending')
          message.choiceState = 'skipped'
        choice.value = null
      }
      await hydrateServer().catch(() => { })
      return true
    }
    catch (err) {
      stopping.value = false
      setLabError(err instanceof Error ? err.message : 'Could not stop the agent')
      return false
    }
  }
  async function runAgentTurn(epoch: number, runAgentId: string, text: string, urls: string[]) {
    activeTurns += 1
    try {
      let locked = false
      let started = false
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/chat`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            sessionId: sessionId.value || undefined,
            message: text,
            attachments: urls,
            confirmPolicy: confirmPolicy.value,
            ...agentContextSnapshot(),
          }),
        })
        if (response.status === 409) {
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        started = true
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked)
          break
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return
      if (!started || locked)
        throw new Error('This session is already running')
      if (activeAgentId.value === runAgentId)
        await maybeAutoApprove()
    }
    catch (err) {
      if (epoch !== streamEpoch)
        return
      if (isDisconnectError(err) || (err instanceof Error && (err.name === 'AbortError' || err.message === 'This operation was aborted'))) {
        setLabError(agentRecoveryNotice(err instanceof Error ? err.message : String(err)))
        // Browser can drop mid-SSE; recover pending confirm and start generation server-side.
        await hydrateServer().catch(() => { })
        await maybeAutoApprove().catch(() => { })
        scheduleAutoApproveRetry(800)
        scheduleAutoApproveRetry(2500)
        return
      }
      const text = err instanceof Error ? err.message : 'Failed to reach the agent runtime'
      if (/pending generation first/i.test(text)) {
        await hydrateServer()
        await maybeAutoApprove()
        if (!waitingForUser.value) {
          clearLabError()
          return
        }
      }
      if (/pending questions first/i.test(text)) {
        await hydrateServer()
        if (waitingForUserChoice.value) {
          clearLabError()
          return
        }
      }
      setLabError(text, !isSessionLockError(text))
      if (!isSessionLockError(text))
        online.value = false
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch) {
        if (activeAgentId.value !== runAgentId) {
          patchStoredAgent(runAgentId, (agent) => {
            const busy = agent.status === 'generating' || agent.status === 'queued' || Boolean(agent.pending)
            return { ...agent, pending: busy, busy, updatedAt: Date.now() }
          })
        }
        else {
          await hydrateServer()
          await maybeAutoApprove()
          await finishTurnBusy()
          const last = messages.value[messages.value.length - 1]
          if (last?.streaming)
            last.streaming = false
          writeStore()
          void persistCanvasResults().then(() => {
            if (epoch !== streamEpoch)
              return
            trimLab()
            writeStore()
            void persistChat()
          })
        }
      }
    }
  }
  function shouldAutoApprove(payload: ConfirmationPayload | null) {
    if (!payload)
      return false
    if (confirmPolicy.value === 'auto')
      return true
    if (confirmPolicy.value === 'always')
      return false
    return !(payload.uncertainFields?.length)
  }

  /** Auto-approve POST in flight for these confirmation ids. */
  const autoApprovingIds = new Set<string>()
  /** Auto-approve already accepted (or server says it is no longer pending): never POST again. */
  const autoApprovedIds = new Set<string>()
  /** Failed auto-approve attempts per id (network / lock errors); capped to stop 409 storms. */
  const autoApproveAttempts = new Map<string, number>()
  const AUTO_APPROVE_MAX_ATTEMPTS = 3

  async function maybeAutoApprove() {
    if (stopping.value || Date.now() < agentWriteRetryAt)
      return
    const open = confirmation.value
    if (!open || !sessionId.value || !shouldAutoApprove(open) || autoApprovingIds.has(open.id) || autoApprovedIds.has(open.id))
      return
    if ((autoApproveAttempts.get(open.id) || 0) >= AUTO_APPROVE_MAX_ATTEMPTS)
      return
    autoApprovingIds.add(open.id)
    autoApproveAttempts.set(open.id, (autoApproveAttempts.get(open.id) || 0) + 1)
    try {
      const outcome = await resolveConfirmation('confirm', open.params, 'agent')
      if (outcome === 'accepted' || outcome === 'stale')
        autoApprovedIds.add(open.id)
    }
    finally {
      autoApprovingIds.delete(open.id)
    }
  }
  function scheduleAutoApproveRetry(delayMs = 1200) {
    if (!import.meta.client)
      return
    window.setTimeout(() => {
      void (async () => {
        await hydrateServer().catch(() => { })
        await maybeAutoApprove()
      })()
    }, delayMs)
  }
  watch(confirmPolicy, () => {
    void maybeAutoApprove()
  })
  const AUTO_RETRY_LIMIT = 2
  const autoRetries = new Map<string, number>()
  let syncingJobs = false
  let settlingMedia = false
  let jobSyncTimer: ReturnType<typeof setInterval> | undefined
  function stopJobSync() {
    if (!jobSyncTimer)
      return
    clearInterval(jobSyncTimer)
    jobSyncTimer = undefined
  }
  /** Recent human user text leans Chinese → zh UI copy; otherwise English (matches prompt default). */
  function sessionPrefersChineseUi() {
    const recent = [...messages.value]
      .reverse()
      .filter(item => item.role === 'user' && !isAutoRetryUserInstruction(item.content || ''))
      .slice(0, 8)
      .map(item => publicAgentChatText(String(item.content || '')))
      .filter(Boolean)
    const joined = recent.join('\n')
    if (!joined.trim())
      return false
    const han = (joined.match(/\p{Script=Han}/gu) || []).length
    const letters = (joined.match(/[A-Za-z\p{Script=Han}]/gu) || []).length
    return letters > 0 && han / letters >= 0.3
  }

  async function retryFailedMedia(items: AgentImage[]) {
    const retryable = items.filter((item) => {
      // Splits have an exact source/box plan; a generic LLM retry can rerun successful images.
      if (item.modelId === 'image-layer-splitter')
        return false
      if (!isRetryableJobFail(item.error || ''))
        return false
      return (autoRetries.get(item.id) || 0) < AUTO_RETRY_LIMIT
    })
    if (!retryable.length)
      return false
    const retryIds = new Set(retryable.map(item => item.id))
    for (const item of retryable)
      autoRetries.set(item.id, (autoRetries.get(item.id) || 0) + 1)
    // Mirror the server marker so a snapshot saved from this page never retries them again.
    images.value = images.value.map(item => retryIds.has(item.id) ? { ...item, autoRetryHandled: true } : item)

    const zh = sessionPrefersChineseUi()
    const note = retryable.length === 1
      ? (zh ? '有一条镜头生成失败，正在自动重试。' : 'One shot failed to generate. Retrying automatically.')
      : (zh
          ? `有 ${retryable.length} 条镜头生成失败，正在自动重试。`
          : `${retryable.length} shots failed to generate. Retrying automatically.`)
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: note,
    })
    // Always English for the synthetic user turn: matches server prompt language policy and
    // avoids flipping an English session to Chinese. INTERNAL_AUTO_RETRY_MARKER hides this
    // turn from chat UI (users only see what they typed).
    const instructionBody = retryable.length === 1
      ? `A shot just failed (reason: ${publicGenerationFailMessage(retryable[0]?.error)}). Retry only that failed shot with the same reference images, duration, aspect ratio, and prompt. Do not remake the whole film. Failed shot: ${retryable[0]?.prompt || ''}`
      : `Some shots just failed. Retry only the failed shots with the same reference images, duration, aspect ratio, and prompts. Do not remake the whole film.\n${retryable.map(item => `- ${item.prompt} (${publicGenerationFailMessage(item.error)})`).join('\n')}`
    // The id line lets the server refuse stale/duplicate auto retries (it is stripped before the LLM).
    const instruction = [INTERNAL_AUTO_RETRY_MARKER, instructionBody, formatAutoRetryIds([...retryIds])].filter(Boolean).join('\n')
    pending.value = true
    status.value = 'thinking'
    stopping.value = false
    const epoch = bumpStream()
    const runAgentId = activeAgentId.value
    writeStore()
    void runAgentTurn(epoch, runAgentId, instruction, [])
    return true
  }
  function notifyFailedMedia(items: AgentImage[]) {
    if (!items.length)
      return
    const zh = sessionPrefersChineseUi()
    const content = items.length === 1
      ? (zh ? '有一条镜头生成失败。需要我再试这一镜吗？' : 'One shot failed to generate. Want me to retry that shot?')
      : (zh
          ? `有 ${items.length} 条镜头生成失败。需要我再试吗？`
          : `${items.length} shots failed to generate. Want me to retry?`)
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant' && last.content === content)
      return
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
    })
  }
  const notifiedFails = new Set<string>()

  /**
   * Called with every authoritative server snapshot. The first one after load marks all
   * current fails as history; afterwards, record media the server reports as running.
   */
  function trackSnapshotFails(list: AgentImage[]) {
    if (!failBaselineReady) {
      for (const item of list) {
        if (item.status === 'fail')
          baselineFailIds.add(item.id)
      }
      failBaselineReady = true
    }
    for (const item of list) {
      if (item.status === 'generating' && item.kind !== 'upload')
        liveObservedIds.add(item.id)
    }
  }

  /** Same shot already regenerated (success or still running) outside its own batch. */
  function failSupersededInChat(fail: AgentImage) {
    const siblings = new Set<string>([fail.id])
    for (const message of messages.value) {
      const ids = message.imageIds || []
      const batch = message.confirmation ? confirmationMedia(message, images.value).map(item => item.id) : []
      if (!ids.includes(fail.id) && !batch.includes(fail.id))
        continue
      // Same-prompt variations from the same card/turn are siblings, not replacements.
      for (const id of [...ids, ...batch])
        siblings.add(id)
    }
    return isFailSuperseded(fail, images.value, siblings)
  }

  /** Only failures that turned `fail` while this page watched may be retried or announced. */
  function isFreshFail(item: AgentImage) {
    if (item.status !== 'fail' || item.kind === 'upload')
      return false
    if (!failBaselineReady || baselineFailIds.has(item.id) || !liveObservedIds.has(item.id))
      return false
    if (item.autoRetryHandled)
      return false
    if (item.failedAt && item.failedAt < failBaselineAt - FAIL_BASELINE_SLACK_MS)
      return false
    return !failSupersededInChat(item)
  }

  function unnotifiedFails(items: AgentImage[]) {
    return items.filter((item) => {
      if (item.status !== 'fail' || notifiedFails.has(item.id))
        return false
      if (!isFreshFail(item)) {
        // History fails stay silent. Leave live-but-not-yet-confirmed ones for a later pass.
        if (!failBaselineReady || baselineFailIds.has(item.id) || !liveObservedIds.has(item.id) || item.autoRetryHandled)
          return false
        notifiedFails.add(item.id)
        return false
      }
      notifiedFails.add(item.id)
      return true
    })
  }
  function applyJobToImage(job: GenerationJobPublic) {
    const taskId = String(job.taskId || '')
    if (!taskId.startsWith('agent_'))
      return null
    const imageId = taskId.slice('agent_'.length)
    const index = images.value.findIndex(item => item.id === imageId || agentJobTaskId(item.id) === taskId)
    if (index < 0)
      return null
    const current = images.value[index]
    if (!current)
      return null
    const layers = completedLayerResults(current, job)
    if (layers.length) {
      for (const layer of layers) {
        const existing = images.value.findIndex(item => item.id === layer.id)
        if (existing >= 0)
          images.value[existing] = layer
        else
          images.value.push(layer)
      }
      const completionId = `layers-complete:${taskId}`
      const imageIds = layers.map(layer => layer.id)
      const content = `图层拆分已完成，共 ${layers.length} 个图层（含背景）。结果如下，也已添加到画布。`
      const isFallback = (message: AgentChatMessage) => message.id.replace(/^ui:/, '') === completionId
        || (message.content === content && message.imageIds?.some(id => imageIds.includes(id)))
      // Polling recovers missing layers; it must not announce the same output
      // again when SSE or the transcript already attached it to a real turn.
      const owner = messages.value.find(item => item.confirmation && confirmationMedia(item, layers).length)
        || messages.value.find(item => item.role === 'assistant' && !isFallback(item) && item.imageIds?.some(id => imageIds.includes(id)))
      const existingMessage = owner || messages.value.find(isFallback)
      let changed = false
      if (existingMessage) {
        const ids = [...new Set([...(existingMessage.imageIds || []), ...imageIds])]
        if (ids.length !== existingMessage.imageIds?.length) {
          existingMessage.imageIds = ids
          changed = true
        }
        const retained = messages.value.filter(item => item === existingMessage || !isFallback(item))
        if (retained.length !== messages.value.length) {
          messages.value = retained
          changed = true
        }
      }
      else {
        messages.value.push({
          id: completionId,
          role: 'assistant',
          content,
          imageIds,
        })
        changed = true
      }
      if (changed)
        void persistChat()
      autoRetries.delete(current.id)
      return null
    }
    if (current.status !== 'generating')
      return current.status === 'fail' ? current : null
    const previewUrl = job.resultUrls[0]
    const ready = Boolean(previewUrl) && (job.state === 'success'
      || job.state === 'archiving'
      || job.state === 'moderating')
    if (ready || job.state === 'fail') {
      if (ready && previewUrl) {
        const next = {
          ...current,
          status: 'success' as const,
          url: previewUrl,
          error: '',
        }
        images.value[index] = next
        autoRetries.delete(current.id)
        void persistCanvasResults([next])
        return null
      }
    }
    if (job.state === 'fail') {
      const failedAt = Date.parse(job.completedAt || job.updatedAt || '')
      const next = {
        ...current,
        status: 'fail' as const,
        error: job.failMsg || 'Generation failed',
        ...(Number.isFinite(failedAt) && failedAt > 0 ? { failedAt } : {}),
      }
      images.value[index] = next
      // A job that already failed before this page loaded (e.g. a deploy restart while
      // the tab was closed) is history even though the local snapshot still said generating.
      if (!failBaselineReady || (Number.isFinite(failedAt) && failedAt < failBaselineAt - FAIL_BASELINE_SLACK_MS))
        baselineFailIds.add(next.id)
      return next
    }
    return null
  }
  let latestCanvasJobs: GenerationJobPublic[] = []
  function applyCanvasJobs(jobs: GenerationJobPublic[]) {
    latestCanvasJobs = jobs
    if (hydrating)
      return
    const newlyFailed = jobs.map(job => applyJobToImage(job)).filter((item): item is AgentImage => Boolean(item))
    void maybeSettleMedia(newlyFailed)
  }
  async function maybeSettleMedia(newlyFailed: AgentImage[] = []) {
    if (activeTurns > 0)
      return
    if (images.value.some(item => item.status === 'generating'))
      return
    if (status.value === 'thinking' || status.value === 'calling_tool')
      return
    if (waitingForUser.value)
      return
    if (!(status.value === 'generating' || status.value === 'queued' || pending.value))
      return
    const failed = unnotifiedFails([
      ...newlyFailed,
      ...images.value.filter(item => item.status === 'fail'),
    ])
    await settleFinishedMedia(failed)
  }
  async function finishTurnBusy() {
    await hydrateServer().catch(() => { })
    await maybeAutoApprove()
    await maybeSettleMedia()
    if (status.value === 'thinking' || status.value === 'calling_tool') {
      pending.value = true
      return
    }
    if (confirmation.value && shouldAutoApprove(confirmation.value)) {
      status.value = 'generating'
      pending.value = true
      return
    }
    const generatingMedia = images.value.some(item => item.status === 'generating')
    if (generatingMedia) {
      status.value = 'generating'
      pending.value = true
      return
    }
    pending.value = waitingForUser.value
    if (status.value === 'generating' || status.value === 'queued' || !pending.value)
      status.value = 'idle'
    if (!pending.value && status.value === 'idle')
      stopping.value = false
  }
  async function settleFinishedMedia(failed: AgentImage[]) {
    if (settlingMedia)
      return
    settlingMedia = true
    try {
      // Detached confirm turns lose SSE; pick up the next confirmation / busy loop here.
      const remote = await hydrateServer().catch(() => ({ busy: false, hasPendingConfirm: false }))
      await maybeAutoApprove()
      if (waitingForUser.value) {
        pending.value = true
        return
      }
      if (confirmation.value && shouldAutoApprove(confirmation.value)) {
        pending.value = true
        status.value = 'generating'
        return
      }
      if (remote?.busy || images.value.some(item => item.status === 'generating')) {
        pending.value = true
        status.value = images.value.some(item => item.status === 'generating') ? 'generating' : 'thinking'
        return
      }
      pending.value = false
      status.value = 'idle'
      if (!failed.length)
        return
      if (stopping.value) {
        notifyFailedMedia(failed)
        return
      }
      const retried = await retryFailedMedia(failed)
      if (!retried)
        notifyFailedMedia(failed)
    }
    finally {
      settlingMedia = false
      void persistChat()
    }
  }
  async function syncGeneratingJobs() {
    if (syncingJobs || hydrating)
      return
    const generating = images.value.filter(item => item.status === 'generating' && item.kind !== 'upload')
    const holdBusy = status.value === 'generating'
      || status.value === 'queued'
      || status.value === 'thinking'
      || status.value === 'calling_tool'
      || (pending.value && !waitingForUser.value)
      || Boolean(confirmation.value && shouldAutoApprove(confirmation.value))
    if (!generating.length && !holdBusy)
      return
    syncingJobs = true
    const newlyFailed: AgentImage[] = []
    try {
      if (sessionId.value) {
        await hydrateServer()
        await maybeAutoApprove()
      }
      {
        const stillGenerating = images.value.filter(item => item.status === 'generating' && item.kind !== 'upload')
        await Promise.all(stillGenerating.map(async (item) => {
          try {
            const job = await $fetch<GenerationJobPublic>(`/api/ai/jobs/${encodeURIComponent(agentJobTaskId(item.id))}`)
            const failed = applyJobToImage(job)
            if (failed)
              newlyFailed.push(failed)
          }
          catch {
            // The canvas job may not exist yet.
          }
        }))
      }
      await maybeSettleMedia(newlyFailed)
    }
    finally {
      syncingJobs = false
    }
  }
  watch(() => images.value.some(item => item.status === 'generating')
    || status.value === 'generating'
    || status.value === 'queued'
    || status.value === 'thinking'
    || status.value === 'calling_tool'
    || (pending.value && !waitingForUser.value)
    || Boolean(confirmation.value && shouldAutoApprove(confirmation.value)), (busy) => {
    if (!import.meta.client)
      return
    if (busy) {
      if (!jobSyncTimer) {
        void syncGeneratingJobs()
        jobSyncTimer = setInterval(() => {
          void syncGeneratingJobs()
        }, 3000)
      }
      return
    }
    stopJobSync()
  }, { immediate: true })
  /**
   * `accepted`: server took the request. `stale`: the confirmation is no longer pending
   * server-side (already started / processed). `failed`: error surfaced or aborted.
   */
  async function resolveConfirmation(action: 'confirm' | 'cancel', params?: ConfirmationPayload['params'], approvedBy: 'agent' | 'user' = 'user'): Promise<'accepted' | 'stale' | 'failed' | undefined> {
    if (!confirmation.value || !sessionId.value)
      return
    if (action === 'confirm' && params && (confirmation.value.kind || 'image') === 'image') {
      const combo = gptImage2ComboError(params.aspectRatio as GptImage2AspectRatio, params.resolution as GptImage2Resolution)
      if (combo)
        throw new Error(combo)
    }
    const confirmationId = confirmation.value.id
    const message = messages.value.find(item => item.confirmation?.id === confirmationId)
    if (message) {
      message.confirmationState = action === 'confirm' ? 'confirmed' : 'cancelled'
      if (action === 'confirm' && params)
        message.resolvedParams = params
      if (action === 'confirm' && message.confirmation) {
        message.confirmation = {
          ...message.confirmation,
          approvedBy: message.confirmation.approvedBy || approvedBy,
        }
      }
    }
    pending.value = true
    confirmation.value = null
    clearLabError()
    status.value = action === 'confirm' ? 'generating' : 'thinking'
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    const confirmSessionId = sessionId.value
    const autoApproval = approvedBy === 'agent'
    let outcome: 'accepted' | 'stale' | 'failed' = 'failed'
    activeTurns += 1
    try {
      let locked = false
      let started = false
      let busyMessage = ''
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(confirmSessionId)}/confirm`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            confirmationId,
            action,
            params,
          }),
        })
        if (response.status === 409) {
          busyMessage = await parseError(response)
          // Auto-approve: the card is no longer pending server-side (task already started or
          // another tab/poll confirmed it). Re-POSTing the same id only yields more 409s.
          if (autoApproval && /already processed|already in progress|no matching confirmation/i.test(busyMessage)) {
            started = true
            locked = false
            outcome = 'stale'
            if ((confirmation.value as ConfirmationPayload | null)?.id === confirmationId)
              confirmation.value = null
            if (action === 'confirm' && activeAgentId.value === runAgentId)
              status.value = 'generating'
            break
          }
          // Confirm was already accepted server-side (browser may have closed mid-flight).
          if (/already processed|already in progress|no matching confirmation/i.test(busyMessage)) {
            await hydrateServer()
            const stillOpen = (confirmation.value as ConfirmationPayload | null)?.id === confirmationId
            if (!stillOpen) {
              started = true
              locked = false
              outcome = 'stale'
              if (action === 'confirm' && activeAgentId.value === runAgentId)
                status.value = 'generating'
              break
            }
          }
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        if (epoch !== streamEpoch)
          return response.ok ? 'accepted' : outcome
        started = true
        const contentType = response.headers.get('content-type') || ''
        // Detached confirm: BFF returns JSON after kicking off server-side generation.
        if (contentType.includes('application/json')) {
          if (!response.ok)
            throw new Error(await parseError(response))
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean
            status?: string
            error?: string
          }
          if (payload.error)
            throw new Error(payload.error)
          if (action === 'confirm' && activeAgentId.value === runAgentId)
            status.value = payload.status === 'idle' ? 'idle' : 'generating'
          locked = false
          outcome = 'accepted'
          break
        }
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked) {
          outcome = 'accepted'
          break
        }
        busyMessage = 'This session is already running'
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return outcome
      if (!started || locked)
        throw new Error(busyMessage || 'This session is already running')
    }
    catch (err) {
      outcome = 'failed'
      if (epoch !== streamEpoch)
        return outcome
      if (autoApproval && /no matching confirmation/i.test(err instanceof Error ? err.message : '')) {
        // Stale auto-approve: nothing for the user to act on.
        outcome = 'stale'
      }
      else if (activeAgentId.value === runAgentId) {
        const text = err instanceof Error ? err.message : 'Failed to resolve confirmation'
        setLabError(text, !isSessionLockError(text))
        if (message?.confirmation) {
          confirmation.value = {
            ...message.confirmation,
            approvedBy: message.confirmation.approvedBy || approvedBy,
          }
          if (message.confirmation.approvedBy === 'agent' || approvedBy === 'agent') {
            message.confirmationState = 'confirmed'
            scheduleAutoApproveRetry(1000)
            scheduleAutoApproveRetry(3000)
          }
          else if (message.confirmationState === 'confirmed') {
            message.confirmationState = 'pending'
          }
        }
      }
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch && activeAgentId.value === runAgentId) {
        await hydrateServer()
        await persistCanvasResults()
        trimLab()
        await persistChat()
        await maybeAutoApprove()
        // Detached confirm drops SSE; keep probing for the next auto card / busy turn.
        if (action === 'confirm' && (approvedBy === 'agent' || message?.confirmation?.approvedBy === 'agent' || shouldAutoApprove(confirmation.value))) {
          scheduleAutoApproveRetry(1200)
          scheduleAutoApproveRetry(3500)
          scheduleAutoApproveRetry(8000)
        }
        await finishTurnBusy()
        const last = messages.value[messages.value.length - 1]
        if (last?.streaming)
          last.streaming = false
      }
    }
    return outcome
  }
  async function resolveChoice(action: 'submit' | 'skip', answers?: ChoiceAnswer[]) {
    if (!choice.value || !sessionId.value)
      return
    const choiceId = choice.value.id
    const message = messages.value.find(item => item.choice?.id === choiceId)
    if (message) {
      message.choiceState = action === 'skip' ? 'skipped' : 'answered'
      if (action === 'submit' && answers)
        message.choiceAnswers = answers
    }
    pending.value = true
    choice.value = null
    clearLabError()
    status.value = 'thinking'
    const epoch = streamEpoch
    const runAgentId = activeAgentId.value
    const choiceSessionId = sessionId.value
    activeTurns += 1
    try {
      let locked = false
      let started = false
      let busyMessage = ''
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(choiceSessionId)}/choice`, {
          method: 'POST',
          credentials: 'omit',
          headers: labHeaders(true, crypto.randomUUID()),
          body: JSON.stringify({
            choiceId,
            action,
            answers,
          }),
        })
        if (response.status === 409) {
          busyMessage = await parseError(response)
          if (/already processed|already in progress|no matching questions/i.test(busyMessage)) {
            await hydrateServer()
            const stillOpen = (choice.value as ChoicePayload | null)?.id === choiceId
            if (!stillOpen) {
              started = true
              locked = false
              break
            }
          }
          locked = true
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
          continue
        }
        if (epoch !== streamEpoch)
          return
        started = true
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          if (!response.ok)
            throw new Error(await parseError(response))
          const payload = await response.json().catch(() => ({})) as {
            ok?: boolean
            status?: string
            error?: string
          }
          if (payload.error)
            throw new Error(payload.error)
          if (activeAgentId.value === runAgentId)
            status.value = payload.status === 'idle' ? 'idle' : 'thinking'
          locked = false
          break
        }
        locked = await consumeSse(response, epoch, runAgentId)
        if (!locked)
          break
        busyMessage = 'This session is already running'
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
      }
      if (epoch !== streamEpoch)
        return
      if (!started || locked)
        throw new Error(busyMessage || 'This session is already running')
    }
    catch (err) {
      if (epoch !== streamEpoch)
        return
      if (isDisconnectError(err)) {
        // The server may already have accepted the answer and continued. Do not
        // reopen the old choice or resend it; recover the authoritative snapshot.
        return
      }
      if (activeAgentId.value === runAgentId) {
        const text = err instanceof Error ? err.message : 'Failed to send your choices'
        setLabError(text, !isSessionLockError(text))
        if (message?.choice) {
          choice.value = message.choice
          if (message.choiceState === 'answered' || message.choiceState === 'skipped')
            message.choiceState = 'pending'
        }
      }
    }
    finally {
      activeTurns = Math.max(0, activeTurns - 1)
      if (epoch === streamEpoch && activeAgentId.value === runAgentId) {
        await hydrateServer()
        trimLab()
        await persistChat()
        await finishTurnBusy()
        const last = messages.value[messages.value.length - 1]
        if (last?.streaming)
          last.streaming = false
      }
    }
  }
  function resetLab() {
    bumpStream()
    stopJobSync()
    autoRetries.clear()
    // Next applyAgent re-snapshots history fails and waits for a fresh server snapshot.
    failBaselineAgentId = ''
    failBaselineReady = false
    persistedCanvasIds.clear()
    patchedInputIds.clear()
    storedAgents.value = []
    activeAgentId.value = ''
    agentTitle.value = DEFAULT_AGENT_TITLE
    titleSource.value = 'default'
    queueNotice.value = ''
    sessionId.value = ''
    messages.value = []
    images.value = []
    confirmation.value = null
    choice.value = null
    status.value = 'idle'
    pending.value = false
    clearLabError()
    draft.value = ''
    attachments.value.forEach(revokePreview)
    attachments.value = []
  }
  function createAgent() {
    if (!canCreateAgent.value)
      return
    commitCurrentAgent()
    void persistChat()
    const next = emptyStoredAgent(nextDefaultTitle())
    storedAgents.value = [...storedAgents.value, next]
    hydrating = true
    applyAgent(next)
    hydrating = false
    writeStore()
  }
  async function selectAgent(id: string, options?: { force?: boolean }) {
    if (!id || id === activeAgentId.value)
      return
    if (!options?.force && !canSwitchAgent.value)
      return
    commitCurrentAgent()
    await persistChat()
    const found = storedAgents.value.find(agent => agent.id === id)
    if (!found)
      return
    hydrating = true
    try {
      applyAgent(found)
      await hydrateServer()
    }
    finally {
      hydrating = false
    }
    applyCanvasJobs(latestCanvasJobs)
    writeStore()
  }
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  function restoreComposerDraft(consume: boolean) {
    const pendingDraft = draft.value || readComposerDraft()
    if (!pendingDraft)
      return
    draft.value = pendingDraft
    writeComposerDraft(pendingDraft)
    if (consume)
      clearComposerDraft()
  }
  function stashComposerDraft() {
    writeComposerDraft(draft.value || readComposerDraft())
  }
  async function hydrate() {
    if (hydrating)
      return
    const carry = draft.value || readComposerDraft()
    hydrating = true
    try {
      resetLab()
      if (!storageKey.value) {
        seedDefaultAgent()
        online.value = null
        if (healthTimer) {
          clearInterval(healthTimer)
          healthTimer = undefined
        }
        if (carry)
          draft.value = carry
        restoreComposerDraft(false)
        return
      }
      hydrateLocal()
      ping()
      await hydrateRemoteChats()
      await hydrateRemoteSessions()
      await hydrateServer()
      await persistCanvasResults()
      trimLab()
      await persistChat()
      if (!healthTimer)
        healthTimer = setInterval(ping, 10000)
      if (carry)
        draft.value = carry
      restoreComposerDraft(Boolean(projectScope.value))
      writeStore()
    }
    finally {
      hydrating = false
    }
    applyCanvasJobs(latestCanvasJobs)
  }
  const persistScope = effectScope(true)
  persistScope.run(() => {
    watch(draft, (value) => {
      if (hydrating)
        return
      writeComposerDraft(value)
    })
    watch(storageKey, (key, previous) => {
      if (key === previous)
        return
      bootstrapped = true
      void hydrate()
    })
    if (import.meta.client) {
      useEventListener(document, 'visibilitychange', () => {
        if (document.visibilityState !== 'hidden')
          return
        writeStore()
        void persistChat()
      })
    }
    watch([sessionId, messages, images, confirmation, choice, draft, agentTitle, status, pending, queueNotice], () => {
      if (hydrating)
        return
      if (saveTimer)
        clearTimeout(saveTimer)
      saveTimer = setTimeout(writeStore, 150)
      if (persistTimer)
        clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        void persistChat()
      }, 800)
    }, { deep: true })
  })
  async function syncRemoteAgents() {
    // A page handoff must not replace a live turn with an archived snapshot.
    if (activeTurns > 0)
      return
    commitCurrentAgent()
    await hydrateRemoteChats()
    await hydrateRemoteSessions()
    await hydrateServer()
    writeStore()
  }
  let hydrationPromise: Promise<void> | null = null
  async function ensureHydrated() {
    // Project switches and tool submissions can request the same hydration together.
    if (hydrationPromise)
      return hydrationPromise
    if (hydrating)
      return
    hydrationPromise = (async () => {
      if (!bootstrapped) {
        bootstrapped = true
        await hydrate()
        return
      }
      await syncRemoteAgents()
    })()
    try {
      await hydrationPromise
    }
    finally {
      hydrationPromise = null
    }
  }
  function bindOptions(next?: {
    projectId?: MaybeRefOrGetter<string>
    onJobs?: (jobs: GenerationJobPublic[]) => void
  }) {
    onJobs.value = next?.onJobs
  }
  function flush() {
    writeStore()
    void persistChat()
  }
  return {
    sessionId,
    messages,
    images,
    status,
    confirmation,
    waitingForUserConfirm,
    waitingForUserChoice,
    online,
    error,
    pending,
    draft,
    qualityPreference,
    confirmPolicy,
    attachments,
    attaching,
    busy,
    queueNotice,
    agents,
    allImages,
    activeAgentId,
    canCreateAgent,
    canSwitchAgent,
    createAgent,
    selectAgent,
    ensureNamedAgent,
    sendMessage,
    stopAgent,
    stopping,
    attachFiles,
    uploadAnnotationImage,
    attachUrls,
    removeAttachment,
    resolveConfirmation,
    resolveChoice,
    bindOptions,
    ensureHydrated,
    flush,
    stashComposerDraft,
    applyCanvasJobs,
  }
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    agentLabs.clear()
  })
}
