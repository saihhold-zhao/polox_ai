<script setup lang="ts">
import type { AiModelConfig } from '~~/shared/types/aiModel'
import type { GenerationJobPublic } from '~~/shared/types/generation'
import type { ImageAnnotationReference } from '~~/shared/utils/imageAnnotations'
import type { SketchElement } from '~~/shared/utils/sketchToImage'
import type { AgentChatMessage, AgentConfirmPolicy, AgentImage, AgentListItem, AgentQuality, AgentStatus, ChoiceAnswer, ConfirmationPayload, PendingAttachment } from '~/composables/useAgentLab'
import { ArrowUp, ChevronDown, Paperclip, Plus, Square, X } from 'lucide-vue-next'
import { normalizeComposerSelection } from '~~/shared/utils/agentComposerSelection'
import { AGENT_MODELS, agentModelLogo, modelMention, publicAgentModels, readModelMentions, stripModelMentions } from '~~/shared/utils/agentModels'
import { composerPlaceholderForSkills, findComposerCommand, mergeAgentSkillCatalog, PUBLIC_AGENT_SKILLS, readSkillCommands, searchAgentSkills, stripSkillCommands, type CatalogAgentSkill } from '~~/shared/utils/agentSkills'
import { isMediaAudioUrl, isMediaDocumentUrl, isMediaVideoUrl, mediaDocumentLabel } from '~~/shared/utils/seedance25'
import { SKETCH_TO_IMAGE_TOOL } from '~~/shared/utils/sketchToImage'
import { agentComposerPlaceholder } from '~/utils/agentComposerPlaceholder'
import { confirmationWorking } from '~/utils/agentConfirmationState'
import { messageMedia } from '~/utils/agentMessageMedia'
import { presentAgentResults } from '~/utils/agentResultPresentation'

const props = withDefaults(defineProps<{
  messages: AgentChatMessage[]
  sessionId?: string
  images: AgentImage[]
  projectImages?: AgentImage[]
  projectJobs?: GenerationJobPublic[]
  uploadAnnotationImage?: (file: File) => Promise<ImageAnnotationReference>
  saveSketch?: (file: File) => Promise<boolean>
  sketchInProjectOnly?: boolean
  projectAssetsLoading?: boolean
  projectAssetsError?: string
  attachments: PendingAttachment[]
  status: AgentStatus
  pending: boolean
  attaching: boolean
  stopping?: boolean
  error: string
  confirmationOpen: boolean
  choiceOpen?: boolean
  queueNotice?: string
  agents?: AgentListItem[]
  activeAgentId?: string
  canCreateAgent?: boolean
  canSwitchAgent?: boolean
  composerOnly?: boolean
  hideAgentChrome?: boolean
  /** Skill ids that cannot be removed from the composer (e.g. skill project Edit/Test). */
  lockedSkillIds?: string[]
  hideTranscript?: boolean
}>(), {
  projectJobs: () => [],
  queueNotice: '',
  agents: () => [],
  activeAgentId: '',
  canCreateAgent: true,
  canSwitchAgent: true,
  composerOnly: false,
  hideAgentChrome: false,
  lockedSkillIds: () => [],
  hideTranscript: false,
  stopping: false,
  choiceOpen: false,
})
const emit = defineEmits<{
  send: [
  ]
  openSketch: []
  stop: [
  ]
  browseAssets: [
  ]
  attach: [
        files: File[],
  ]
  attachAsset: [
        items: Array<{
          url: string
          name: string
          kind?: 'image' | 'audio' | 'video' | 'document'
        }>,
  ]
  removeAttachment: [
        id: string,
  ]
  confirm: [
        params: ConfirmationPayload['params'],
  ]
  cancel: [
  ]
  submitChoice: [
        answers: ChoiceAnswer[],
  ]
  skipChoice: [
  ]
  createAgent: [
  ]
  selectAgent: [
        id: string,
  ]
}>()
const draft = defineModel<string>('draft', { default: '' })
const qualityPreference = defineModel<AgentQuality>('qualityPreference', { default: 'hobby' })
const confirmPolicy = defineModel<AgentConfirmPolicy>('confirmPolicy', { default: 'always' })
// Also normalize restored drafts and selections pasted into the composer.
watch(draft, (text) => {
  const normalized = normalizeComposerSelection(text)
  if (normalized !== text)
    draft.value = normalized
}, { immediate: true, flush: 'sync' })

const { data: skillsApi } = useFetch<{ catalog?: CatalogAgentSkill[], userSkills?: CatalogAgentSkill[] }>('/api/skills', {
  default: () => ({ catalog: [], userSkills: [] }),
})
const skillCatalog = computed(() => {
  if (skillsApi.value?.catalog?.length)
    return skillsApi.value.catalog
  return mergeAgentSkillCatalog(skillsApi.value?.userSkills || [])
})

const selectedSkills = computed(() => readSkillCommands(draft.value, skillCatalog.value))
const selectedSkillCommands = computed(() => selectedSkills.value.map(skill => `/${skill.id}`))
const selectedModels = computed(() => readModelMentions(draft.value).map(id => AGENT_MODELS.find(model => model.id === id)!))
const sketchSelected = computed(() => selectedModels.value.some(model => model.id === SKETCH_TO_IMAGE_TOOL) || selectedSkills.value.some(skill => skill.id === SKETCH_TO_IMAGE_TOOL))
const sketchVisible = computed(() => sketchSelected.value && !props.sketchInProjectOnly)
const sketchDrafts = useState<Record<string, SketchElement[]>>('agent-sketch-drafts', () => ({}))
const sketchKey = computed(() => props.activeAgentId || 'local')
const sketchElements = computed({
  get: () => sketchDrafts.value[sketchKey.value] || [],
  set: (value: SketchElement[]) => { sketchDrafts.value[sketchKey.value] = value },
})
const sketchCanvas = useTemplateRef('sketchCanvas')
const sketchEditor = useTemplateRef('sketchEditor')
const sketchHasText = ref(false)
const submittingSketch = ref(false)
const sketchError = ref('')
watch(sketchKey, () => {
  sketchHasText.value = false
  sketchError.value = ''
})
const composerText = computed({
  get: () => stripSkillCommands(stripModelMentions(draft.value), skillCatalog.value),
  set: (text: string) => { draft.value = [...selectedModels.value.map(modelMention), ...selectedSkillCommands.value, text].join(' ') },
})
const mention = ref<ReturnType<typeof findComposerCommand>>(null)
const skillMatches = computed(() => (props.lockedSkillIds || []).length ? [] as CatalogAgentSkill[] : searchAgentSkills(mention.value?.query || '', skillCatalog.value).filter(skill => !selectedSkills.value.some(selected => selected.id === skill.id)))
watch(() => mention.value?.trigger, (trigger) => {
  if (trigger === '@')
    emit('browseAssets')
})
const mentionIndex = ref(0)
const mentionColumn = ref<'models' | 'assets' | 'skills'>('models')
const mentionStyle = ref<Record<string, string>>({})
const modelListId = `model-list-${useId()}`
let composerElement: HTMLTextAreaElement | null = null
const composerInput = useTemplateRef('composerInput')
const modelMatches = computed(() => {
  const query = (mention.value?.query || '').toLowerCase().trim()
  const taskQuery = ['image-to-image', 'reference-to-video'].includes(query) ? query.replaceAll('-', ' ') : null
  const terms = query.split(/\s+/).filter(Boolean)
  return publicAgentModels().filter(model => !PUBLIC_AGENT_SKILLS.some(skill => skill.id === model.id) && !selectedModels.value.some(selected => selected.id === model.id)
    && (taskQuery
      ? model.task.toLowerCase() === taskQuery
      : terms.every(term => `${model.name} ${model.task} ${model.id}`.toLowerCase().includes(term))))
})
const projectAssets = computed(() => {
  const result = new Map<string, { id: string, name: string, url: string, video: boolean, audio: boolean, document: boolean }>()
  for (const job of props.projectJobs) {
    for (const [index, url] of job.resultUrls.entries()) {
      if (!url)
        continue
      const audio = isMediaAudioUrl(url)
      const video = !audio && (job.category === 'Video' || isMediaVideoUrl(url))
      const document = !audio && !video && isMediaDocumentUrl(url)
      result.set(url, { id: `${job.taskId}:${index}`, url, name: job.layers?.[index]?.name || String(job.input.asset_name || job.prompt || job.model).slice(0, 100), video, audio, document })
    }
  }
  for (const image of [...(props.projectImages || []), ...props.images]) {
    if (image.url && !result.has(image.url)) {
      const audio = image.kind === 'audio' || isMediaAudioUrl(image.url)
      const video = !audio && (image.kind === 'video' || isMediaVideoUrl(image.url))
      const document = !audio && !video && (image.kind === 'document' || isMediaDocumentUrl(image.url) || /\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(image.name || ''))
      result.set(image.url, { id: image.id, url: image.url, name: image.name || image.prompt.slice(0, 100) || 'Untitled asset', video, audio, document })
    }
  }
  return [...result.values()]
})
const assetMatches = computed(() => {
  const terms = (mention.value?.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  return projectAssets.value.filter(asset => terms.every(term => asset.name.toLowerCase().includes(term)))
})
const mentionCount = computed(() => mentionColumn.value === 'skills' ? skillMatches.value.length : mentionColumn.value === 'models' ? modelMatches.value.length : assetMatches.value.length)
const activeMentionId = computed(() => mention.value && mentionCount.value ? `${modelListId}-${mentionColumn.value}-${mentionIndex.value}` : undefined)
watch(mentionCount, (count) => { mentionIndex.value = Math.max(0, Math.min(mentionIndex.value, count - 1)) })
function updateMention(event: Event) {
  const input = event.target as HTMLTextAreaElement
  composerElement = input
  const bounds = input.closest('[data-slot=input-group]')!.getBoundingClientRect()
  const above = bounds.top >= 220
  mentionStyle.value = {
    left: `${Math.max(8, bounds.left)}px`,
    width: `${Math.min(Math.max(bounds.width, 640), window.innerWidth - Math.max(8, bounds.left) - 8)}px`,
    maxHeight: `${Math.min(288, above ? bounds.top - 16 : window.innerHeight - bounds.bottom - 16)}px`,
    ...(above ? { bottom: `${window.innerHeight - bounds.top + 8}px` } : { top: `${bounds.bottom + 8}px` }),
  }
  const end = input.selectionStart || 0
  mention.value = findComposerCommand(input.value, end, skillCatalog.value)
  // Skill project Edit/Test: keep the locked skill chip only — do not open the skill picker on /
  if (mention.value?.trigger === '/' && (props.lockedSkillIds || []).length) {
    mention.value = null
    if (mentionColumn.value === 'skills')
      mentionColumn.value = 'models'
    mentionIndex.value = 0
    return
  }
  if (mention.value?.trigger === '/')
    mentionColumn.value = 'skills'
  else if (mentionColumn.value === 'skills')
    mentionColumn.value = 'models'
  mentionIndex.value = 0
}
function removeModel(id: string) {
  draft.value = [...selectedModels.value.filter(model => model.id !== id).map(modelMention), ...selectedSkillCommands.value, composerText.value].join(' ')
}

function isSkillLocked(id: string) {
  return (props.lockedSkillIds || []).includes(id)
}

function removeSkill(id: string) {
  if (isSkillLocked(id))
    return

  draft.value = [...selectedModels.value.map(modelMention), ...selectedSkills.value.filter(skill => skill.id !== id).map(skill => `/${skill.id}`), composerText.value].join(' ')
}
watch(draft, (text) => {
  const locked = props.lockedSkillIds || []
  if (!locked.length)
    return
  const raw = String(text || '')
  const skills = readSkillCommands(raw, skillCatalog.value)
  const unauthorized = skills.filter(skill => !locked.includes(skill.id))
  const missing = locked.filter(id => !new RegExp(`(?:^|\\s)/${id}(?=\\s|$)`).test(raw))
  if (!unauthorized.length && !missing.length)
    return
  const clean = stripSkillCommands(stripModelMentions(raw), skillCatalog.value).replace(/\s+/g, ' ').trim()
  draft.value = [
    ...selectedModels.value.map(modelMention),
    ...locked.map(id => `/${id}`),
    clean,
  ].filter(Boolean).join(' ')
})


watch(() => props.activeAgentId, () => { mention.value = null })
watch(draft, (text) => {
  if (!text)
    mention.value = null
})

const route = useRoute()
watch(() => route.fullPath, () => { mention.value = null })
function clearMentionOnBlur() {
  mention.value = null
}
onMounted(() => {
  if (!import.meta.client)
    return
  window.addEventListener('blur', clearMentionOnBlur)
})
onUnmounted(() => {
  if (!import.meta.client)
    return
  window.removeEventListener('blur', clearMentionOnBlur)
})

const pinnedToBottom = ref(true)
const historyPanel = ref<{
  load: () => Promise<void>
} | null>(null)
const visibleMessageCount = ref(40)
const presentedMessages = computed(() => presentAgentResults(props.messages, message => messageMedia(message, props.images)))
const visibleMessages = computed(() => presentedMessages.value.slice(-visibleMessageCount.value))
let loadingCachedHistory = false
watch(() => props.sessionId, () => { visibleMessageCount.value = 40 })

const STICKY_THRESHOLD = 96
const scroller = ref<HTMLElement | null>(null)
const transcript = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const fileDropActive = ref(false)
let fileDragDepth = 0

const ATTACH_ACCEPT = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/mp4',
])

function isFileDrag(event: DragEvent) {
  const types = event.dataTransfer?.types
  if (!types)
    return false
  return [...types].includes('Files')
}

function filesFromDrop(event: DragEvent) {
  const list = event.dataTransfer?.files
  if (!list?.length)
    return [] as File[]
  return [...list].filter((file) => {
    if (ATTACH_ACCEPT.has(file.type))
      return true
    // Some browsers omit type for audio/images; fall back to extension.
    const name = file.name.toLowerCase()
    return /\.(jpe?g|png|webp|gif|mp3|wav|aac|ogg|m4a)$/.test(name)
  })
}

function onComposerDragEnter(event: DragEvent) {
  if (!isFileDrag(event) || composerLocked.value)
    return
  event.preventDefault()
  fileDragDepth += 1
  fileDropActive.value = true
}

function onComposerDragOver(event: DragEvent) {
  if (!isFileDrag(event) || composerLocked.value)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'copy'
  fileDropActive.value = true
}

function onComposerDragLeave(event: DragEvent) {
  if (!isFileDrag(event))
    return
  event.preventDefault()
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (!fileDragDepth)
    fileDropActive.value = false
}

function onComposerDrop(event: DragEvent) {
  if (!isFileDrag(event))
    return
  event.preventDefault()
  fileDragDepth = 0
  fileDropActive.value = false
  if (composerLocked.value)
    return
  const files = filesFromDrop(event)
  if (files.length)
    emit('attach', files)
}

let programmaticScroll = false
let lastScrollTop = 0
async function openHistory() {
  if (loadingCachedHistory)
    return
  pinnedToBottom.value = false
  const node = scroller.value
  if (visibleMessageCount.value < presentedMessages.value.length) {
    loadingCachedHistory = true
    const height = node?.scrollHeight || 0
    const top = node?.scrollTop || 0
    visibleMessageCount.value += 40
    await nextTick()
    if (node) {
      node.scrollTop = top + node.scrollHeight - height
      lastScrollTop = node.scrollTop
    }
    loadingCachedHistory = false
    return
  }
  if (props.sessionId)
    await historyPanel.value?.load()
}
function isNearBottom(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= STICKY_THRESHOLD
}
function onScrollerScroll() {
  const node = scroller.value
  if (!node)
    return
  if (programmaticScroll) {
    lastScrollTop = node.scrollTop
    return
  }
  if (node.scrollTop + 1 < lastScrollTop) {
    pinnedToBottom.value = false
  }
  else {
    pinnedToBottom.value = isNearBottom(node)
  }
  lastScrollTop = node.scrollTop
  if (!pinnedToBottom.value && node.scrollTop <= 120)
    openHistory()
}
function onUserScrollUp() {
  pinnedToBottom.value = false
}
function onScrollerWheel(event: WheelEvent) {
  if (event.deltaY < 0) {
    onUserScrollUp()
    if (scroller.value && scroller.value.scrollTop <= 120)
      openHistory()
  }
}
let touchY = 0
function onScrollerTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY || 0
}
function onScrollerTouchMove(event: TouchEvent) {
  const nextY = event.touches[0]?.clientY || 0
  if (nextY > touchY) {
    onUserScrollUp()
    if (scroller.value && scroller.value.scrollTop <= 120)
      openHistory()
  }
  touchY = nextY
}
function scrollToBottom() {
  const node = scroller.value
  if (!node)
    return
  programmaticScroll = true
  node.scrollTop = node.scrollHeight
  lastScrollTop = node.scrollTop
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      programmaticScroll = false
    })
  })
}
async function scrollToBottomSoon(force = false) {
  if (!force && !pinnedToBottom.value)
    return
  await nextTick()
  if (!force && !pinnedToBottom.value)
    return
  scrollToBottom()
}
watch(() => [
  props.messages.length,
  props.messages.at(-1)?.role,
  props.messages.at(-1)?.content,
  props.messages.at(-1)?.imageIds?.join(),
  props.messages.at(-1)?.confirmation?.id,
  props.messages.at(-1)?.choice?.id,
  props.images.map(item => `${item.id}:${item.status}:${item.url}`).join(),
  props.status,
  props.error,
  false,
], (next, prev) => {
  const lengthGrew = Array.isArray(next) && Array.isArray(prev) && Number(next[0]) > Number(prev[0] || 0)
  const userSent = lengthGrew && next[1] === 'user'
  if (userSent) {
    pinnedToBottom.value = true
  }
  void scrollToBottomSoon(userSent)
}, { flush: 'post' })
async function revealSketchEditor() {
  pinnedToBottom.value = false
  await nextTick()
  const node = scroller.value
  const editor = sketchEditor.value?.$el as HTMLElement | undefined
  if (node && editor)
    node.scrollTop += editor.getBoundingClientRect().top - node.getBoundingClientRect().top - 16
}

watch(sketchVisible, (visible) => {
  if (visible)
    void revealSketchEditor()
  else
    void scrollToBottomSoon(true)
})

useResizeObserver(transcript, () => {
  if (pinnedToBottom.value && !sketchVisible.value)
    scrollToBottom()
})
onMounted(() => {
  if (sketchVisible.value) {
    void revealSketchEditor()
    return
  }
  pinnedToBottom.value = true
  void scrollToBottomSoon(true)
})
watch(() => props.activeAgentId, (id, previous) => {
  if (!previous || id === previous)
    return
  pinnedToBottom.value = true
  void scrollToBottomSoon(true)
})
const hasReadyAttachment = computed(() => props.attachments.some(item => item.status === 'ready' && item.url))
const hasFailedAttachment = computed(() => props.attachments.some(item => item.status === 'fail'))
const hasGeneratingMedia = computed(() => props.images.some(item => item.status === 'generating'))
const composerLocked = computed(() =>
  submittingSketch.value
  || props.pending
  || props.status === 'generating'
  || props.status === 'queued'
  || (props.confirmationOpen)
  || props.choiceOpen)
const agentRunning = computed(() => props.pending
  || props.status === 'thinking'
  || props.status === 'calling_tool'
  || props.status === 'generating'
  || props.status === 'queued')
const canStop = computed(() => agentRunning.value && !props.confirmationOpen)
const canSend = computed(() => {
  return (Boolean(draft.value.trim()) || hasReadyAttachment.value)
    && !composerLocked.value
    && !props.attaching
    && !hasFailedAttachment.value
    && (!sketchVisible.value || Boolean(sketchElements.value.length || sketchHasText.value))
})
async function closeSketch() {
  if (composerLocked.value)
    return
  await sketchCanvas.value?.saveDraft()
  removeModel(SKETCH_TO_IMAGE_TOOL)
  removeSkill(SKETCH_TO_IMAGE_TOOL)
  sketchHasText.value = false
  sketchError.value = ''
  await nextTick()
  const input = composerInput.value?.$el as HTMLTextAreaElement | undefined
  input?.focus({ preventScroll: true })
}

async function mentionModel(modelId: string) {
  const model = AGENT_MODELS.find(item => item.id === modelId)
  if (!model)
    return
  const skill = skillCatalog.value.find(item => item.id === modelId) || PUBLIC_AGENT_SKILLS.find(item => item.id === modelId)
  if (skill) {
    await mentionSkill(skill.id)
    return
  }
  // Still insert when locked so homepage / deep links are not no-ops (same as mentionSkill).
  draft.value = [modelMention(model), composerText.value].join(' ')
  qualityPreference.value = 'custom'
  mention.value = null
  await nextTick()
  if (composerLocked.value)
    return
  composerElement?.focus({ preventScroll: true })
}
async function mentionTask(task: string) {
  if (composerLocked.value)
    return
  const text = composerText.value.replace(/(?:^|\s)@[^@\n]*$/, '').trimEnd()
  composerText.value = `${text}${text ? ' ' : ''}@${task}`
  mentionColumn.value = 'models'
  await nextTick()
  const input = composerInput.value?.$el as HTMLTextAreaElement | undefined
  if (!input)
    return
  input.focus({ preventScroll: true })
  input.setSelectionRange(input.value.length, input.value.length)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mentionSkill(skillId: string) {
  const skill = skillCatalog.value.find(item => item.id === skillId) || PUBLIC_AGENT_SKILLS.find(item => item.id === skillId)
  if (!skill)
    return
  // Still insert the skill when the composer is locked (e.g. pending confirm on
  // another agent context) so homepage skill cards / deep links are not no-ops.
  // Dedupe: never prepend a second /id when it is already selected.
  if (selectedSkills.value.some(item => item.id === skill.id)) {
    mention.value = null
    await nextTick()
    if (!composerLocked.value)
      (composerInput.value?.$el as HTMLTextAreaElement | undefined)?.focus({ preventScroll: true })
    return
  }
  draft.value = [`/${skill.id}`, composerText.value].join(' ')
  mention.value = null
  await nextTick()
  if (composerLocked.value)
    return
  const input = composerInput.value?.$el as HTMLTextAreaElement | undefined
  input?.focus({ preventScroll: true })
}

defineExpose({ mentionModel, mentionTask, mentionSkill })

async function selectSkill(skill: ReturnType<typeof searchAgentSkills>[number]) {
  if (!mention.value || composerLocked.value)
    return
  const locked = props.lockedSkillIds || []
  if (locked.length && !locked.includes(skill.id))
    return
  const { start, end } = mention.value
  const text = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`
  draft.value = [`/${skill.id}`, text].join(' ')
  mention.value = null
  await nextTick()
  composerElement?.focus({ preventScroll: true })
  composerElement?.setSelectionRange(start, start)
}

async function selectAsset(asset: typeof projectAssets.value[number]) {
  if (!mention.value || composerLocked.value)
    return
  const { start, end } = mention.value
  composerText.value = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`
  emit('attachAsset', [{ url: asset.url, name: asset.name, kind: asset.audio ? 'audio' : asset.video ? 'video' : asset.document ? 'document' : 'image' }])
  mention.value = null
  await nextTick()
  composerElement?.focus()
  composerElement?.setSelectionRange(start, start)
}
async function selectModel(model: AiModelConfig) {
  if (!mention.value || composerLocked.value)
    return
  const { start, end } = mention.value
  const text = `${composerText.value.slice(0, start)}${composerText.value.slice(end)}`
  draft.value = [modelMention(model), text].join(' ')
  qualityPreference.value = 'custom'
  mention.value = null
  await nextTick()
  composerElement?.focus()
  composerElement?.setSelectionRange(start, start)
}
const { open: openMedia } = useMediaLightbox()

function isAudioAttachment(item: PendingAttachment) {
  if (item.kind === 'audio')
    return true
  return /\.(mp3|wav|aac|ogg|m4a)$/i.test(item.name || '')
}

function isDocumentAttachment(item: PendingAttachment) {
  if (item.kind === 'document')
    return true
  if (item.url && isMediaDocumentUrl(item.url))
    return true
  return /\.(pdf|docx?|pptx?|xlsx?|csv)$/i.test(item.name || '')
}

function isVideoAttachment(item: PendingAttachment) {
  if (item.kind === 'video')
    return true
  return /\.(mp4|mov|mkv|webm)$/i.test(item.name || '')
}

function openAttachment(item: PendingAttachment) {
  if (!item.previewUrl && !item.url)
    return
  if (isDocumentAttachment(item)) {
    openMedia({ url: item.url || item.previewUrl || '', kind: 'document', alt: item.name || 'Document' })
    return
  }
  openMedia({
    url: item.previewUrl || item.url,
    kind: 'image',
    alt: item.name || 'Attached still',
  })
}
const GENERATING_COPY = [
  'Working on media',
  'This can take a minute',
  'Still generating — hang tight',
  'Still working, not stuck',
  'Large jobs often take a bit longer',
] as const
const generatingCopyIndex = ref(0)
const { pause: pauseGeneratingCopy, resume: resumeGeneratingCopy } = useIntervalFn(() => {
  generatingCopyIndex.value = (generatingCopyIndex.value + 1) % GENERATING_COPY.length
}, 8000, { immediate: false })
watch(() => props.status, (status) => {
  generatingCopyIndex.value = 0
  if (status === 'generating' || status === 'queued' || hasGeneratingMedia.value)
    resumeGeneratingCopy()
  else
    pauseGeneratingCopy()
}, { immediate: true })
watch(hasGeneratingMedia, (busy) => {
  if (busy)
    resumeGeneratingCopy()
  else if (props.status !== 'generating' && props.status !== 'queued')
    pauseGeneratingCopy()
})
const statusLabel = computed(() => {
  const generating = props.status === 'generating' || hasGeneratingMedia.value
  if ((props.confirmationOpen || props.choiceOpen) && props.status !== 'queued' && !generating)
    return ''
  if (props.status === 'queued')
    return props.queueNotice || 'Waiting for a free generation slot. This will start automatically.'
  if (generating)
    return GENERATING_COPY[generatingCopyIndex.value] || GENERATING_COPY[0]
  if (props.status === 'calling_tool')
    return 'Calling tools'
  if (props.status === 'thinking' || props.pending)
    return 'Thinking'
  return ''
})
const mediaWorking = computed(() => props.status === 'generating' || props.status === 'queued' || hasGeneratingMedia.value)
const latestConfirmedId = computed(() => {
  for (let index = props.messages.length - 1; index >= 0; index--) {
    const message = props.messages[index]
    if (message?.confirmationState === 'confirmed')
      return message.id
  }
  return ''
})
const activeBusy = computed(() => props.pending || (props.status !== 'idle') || hasGeneratingMedia.value)
const prefsLocked = computed(() => activeBusy.value)
const compactComposer = computed(() => activeBusy.value)
function workingFor(message: AgentChatMessage) {
  return confirmationWorking(message, props.images, mediaWorking.value && message.id === latestConfirmedId.value)
}

function layerSourceImages(message: AgentChatMessage) {
  const index = props.messages.findIndex(item => item.id === message.id)
  if (message.choice?.questions.some(question => question.id === 'image_edit_method' || question.id === 'object_removal_method')) {
    const previous = props.messages.slice(0, index).reverse()
    const request = previous.find(item => item.role === 'user')
    const stills = (item: AgentChatMessage) => messageMedia(item, props.images)
      .filter(image => image.status === 'success' && image.url && image.kind !== 'video' && image.kind !== 'audio' && image.kind !== 'document' && !isMediaVideoUrl(image.url))
      .map(image => ({ id: image.id, url: image.url! }))
    if (request) {
      const attached = stills(request)
      if (attached.length || request.imageIds?.length)
        return attached
    }
    // Follow-up edits without attachments use the nearest image-bearing message,
    // never a gallery of all images from earlier requests.
    for (const item of previous) {
      const sources = stills(item)
      if (sources.length)
        return sources
    }
    return []
  }
  for (const item of props.messages.slice(0, index).reverse()) {
    if (item.role !== 'user')
      continue
    const images = messageMedia(item, props.images).filter(image => image.url && image.kind !== 'video' && image.kind !== 'audio' && image.kind !== 'document' && !isMediaVideoUrl(image.url))
    if (images.length)
      return images.map(image => ({ id: image.id, url: image.url! }))
  }
  return []
}

function thumbsFor(message: AgentChatMessage & {
  media?: AgentImage[]
}) {
  return message.media || messageMedia(message, props.images)
}
function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (files.length)
    emit('attach', files)
}
function onComposerPaste(event: ClipboardEvent) {
  const clipboard = event.clipboardData
  if (!clipboard)
    return
  const files = [...clipboard.files]
  if (!files.length) {
    for (const item of clipboard.items) {
      if (item.kind !== 'file')
        continue
      const file = item.getAsFile()
      if (file)
        files.push(file)
    }
  }
  if (!files.length)
    return
    // File pastes use the same validation, previews and upload flow as the picker.
  event.preventDefault()
  if (!composerLocked.value)
    emit('attach', files)
}

// IME (Chinese/Japanese) candidate confirmation also presses Enter. Safari fires that
// keydown after compositionend with isComposing=false, so track composition ourselves.
const draftComposing = ref(false)
let draftCompositionEndAt = 0
function onDraftCompositionStart() {
  draftComposing.value = true
}
function onDraftCompositionEnd() {
  draftComposing.value = false
  draftCompositionEndAt = Date.now()
}
function isImeKeyEvent(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229 || draftComposing.value || Date.now() - draftCompositionEndAt < 80
}

function onDraftKeydown(event: KeyboardEvent) {
  const imeActive = isImeKeyEvent(event)
  if (mention.value && !imeActive) {
    if (event.key === 'Escape') {
      event.preventDefault()
      mention.value = null
      return
    }
    if (mentionColumn.value !== 'skills' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      mentionColumn.value = event.key === 'ArrowLeft' ? 'models' : 'assets'
      mentionIndex.value = 0
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const count = mentionCount.value
      if (count)
        mentionIndex.value = (mentionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
      nextTick(() => document.getElementById(`${modelListId}-${mentionColumn.value}-${mentionIndex.value}`)?.scrollIntoView({ block: 'nearest' }))
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const skill = mentionColumn.value === 'skills' ? skillMatches.value[mentionIndex.value] : undefined
      if (skill) {
        event.preventDefault()
        void selectSkill(skill)
        return
      }
      const asset = mentionColumn.value === 'assets' ? assetMatches.value[mentionIndex.value] : undefined
      if (asset) {
        event.preventDefault()
        void selectAsset(asset)
        return
      }
      const model = mentionColumn.value === 'models' ? modelMatches.value[mentionIndex.value] : undefined
      if (model) {
        event.preventDefault()
        void selectModel(model)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        return
      }
    }
  }
  if (event.key !== 'Enter' || event.shiftKey || event.repeat || imeActive)
    return
  event.preventDefault()
  if (canSend.value)
    void submitMessage()
}
async function submitMessage() {
  if (!canSend.value)
    return
  if (sketchSelected.value && props.sketchInProjectOnly) {
    emit('openSketch')
    return
  }
  if (!sketchSelected.value) {
    emit('send')
    return
  }
  const key = sketchKey.value
  submittingSketch.value = true
  sketchError.value = ''
  try {
    if (!sketchCanvas.value || !props.saveSketch)
      throw new Error('Could not save your sketch. Please try again.')
    const file = await sketchCanvas.value.exportFile()
    if (await props.saveSketch(file))
      delete sketchDrafts.value[key]
  }
  catch (error) {
    sketchError.value = error instanceof Error ? error.message : 'Could not save your sketch. Please try again.'
  }
  finally {
    submittingSketch.value = false
  }
}

function onComposerSubmit() {
  if (canStop.value) {
    emit('stop')
    return
  }
  if (canSend.value)
    void submitMessage()
}
function setConfirmPolicy(value: unknown) {
  if (prefsLocked.value)
    return
  const next = Array.isArray(value) ? value[0] : value
  if (next === 'auto' || next === 'when_needed' || next === 'always')
    confirmPolicy.value = next
}
const confirmPolicyLabel = computed(() => {
  if (confirmPolicy.value === 'auto')
    return 'Automatic'
  if (confirmPolicy.value === 'when_needed')
    return 'Review when needed'
  return 'Always review'
})
const activeTitle = computed(() => props.agents.find(agent => agent.id === props.activeAgentId)?.title || 'New agent')
function setActiveAgent(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value
  if (typeof next === 'string' && next)
    emit('selectAgent', next)
}
</script>

<template>
  <section
    class="relative flex min-h-0 flex-col bg-sidebar"
    :class="[
      composerOnly ? undefined : 'h-full',
      fileDropActive ? 'ring-2 ring-inset ring-primary' : undefined,
    ]"
    @dragenter="onComposerDragEnter"
    @dragover="onComposerDragOver"
    @dragleave="onComposerDragLeave"
    @drop="onComposerDrop"
  >
    <div
      v-if="fileDropActive"
      class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/70"
      aria-hidden="true"
    >
      <div class="rounded-xl border border-dashed border-primary bg-card/90 px-4 py-3 text-sm font-medium text-foreground shadow-sm">
        Drop to attach
      </div>
    </div>

    <div
      v-if="!composerOnly && !hideAgentChrome"
      class="flex items-center justify-between gap-2 border-b border-border px-4 py-3"
    >
      <div class="flex min-w-0 flex-1 items-center gap-1">
        <h2 class="truncate text-sm font-medium tracking-tight">
          {{ activeTitle }}
        </h2>
        <Spinner
          v-if="activeBusy"
          class="size-3.5 shrink-0 text-muted-foreground"
        />
        <DropdownMenu :modal="false">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="size-7 shrink-0 rounded-lg"
              aria-label="Switch agent"
            >
              <ChevronDown class="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="min-w-48 max-w-72">
            <DropdownMenuRadioGroup
              :model-value="activeAgentId"
              @update:model-value="setActiveAgent"
            >
              <DropdownMenuRadioItem
                v-for="agent in agents"
                :key="agent.id"
                :value="agent.id"
                class="min-w-0 [&>span:first-child]:text-primary"
                :disabled="!canSwitchAgent && agent.id !== activeAgentId"
              >
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  <span class="min-w-0 truncate">{{ agent.title }}</span>
                  <Spinner
                    v-if="agent.busy"
                    class="size-3.5 shrink-0 text-muted-foreground"
                  />
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-8 shrink-0 gap-1 rounded-lg px-2 text-xs font-medium shadow-none"
        :disabled="!canCreateAgent"
        aria-label="New agent"
        @click="emit('createAgent')"
      >
        <Plus class="size-3.5" />
        New
      </Button>
    </div>

    <div
      v-if="!composerOnly && !hideTranscript"
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
      @scroll="onScrollerScroll"
      @wheel="onScrollerWheel"
      @touchstart.passive="onScrollerTouchStart"
      @touchmove.passive="onScrollerTouchMove"
    >
      <div ref="transcript" class="flex flex-col gap-2">
        <AgentLabHistoryPanel
          v-if="sessionId"
          :key="sessionId"
          ref="historyPanel"
          :endpoint="`/api/ai/agent-chats/${encodeURIComponent(sessionId)}/history`"
          :before-id="messages[0]?.id"
          :exclude-ids="messages.map(message => message.id)"
          :scroll-container="scroller"
          embedded
        />
        <AgentLabMessage
          v-for="message in visibleMessages"
          :key="message.id"
          :message="message"
          :images="thumbsFor(message)"
          :omit-skill-ids="lockedSkillIds"
        >
          <template v-if="message.confirmation || message.choice" #default>
            <AgentLabConfirmCard
              v-if="message.confirmation"
              :confirmation="message.confirmation"
              :state="message.confirmationState"
              :resolved-params="message.resolvedParams"
              :pending="workingFor(message) && pending"
              :working="workingFor(message)"
              @confirm="emit('confirm', $event)"
              @cancel="emit('cancel')"
            />

            <AgentLabChoiceCard
              v-if="message.choice"
              :choice="message.choice"
              :state="message.choiceState"
              :answers="message.choiceAnswers"
              :source-images="layerSourceImages(message)"
              :reference-images="projectAssets.filter(asset => !asset.video && !asset.audio && !asset.document)"
              :upload-image="uploadAnnotationImage"
              :upload-audio="uploadAnnotationImage"
              :pending="pending && !choiceOpen"
              @browse-assets="emit('browseAssets')"
              @submit="emit('submitChoice', $event)"
              @skip="emit('skipChoice')"
            />

          </template>
        </AgentLabMessage>

        <Card v-if="sketchVisible" ref="sketchEditor" class="relative w-full min-w-0 gap-4 rounded-2xl border-blue-500/70 py-4 shadow-none" role="region" aria-label="Sketch editor">
          <AgentLabCardBorder tone="attention" />
          <CardHeader class="px-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1.5">
                <CardTitle class="text-sm">
                  Sketch to Image
                </CardTitle>
                <CardDescription>Draw your idea, then save it to the project. Next, choose references and confirm the intended image to generate.</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="icon" class="size-7 shrink-0" :disabled="composerLocked" aria-label="Close sketch editor" @click="closeSketch">
                <X class="size-4" />
              </Button>
            </div>
          </CardHeader>
          <ToolsSketchCanvas
            :key="sketchKey"
            ref="sketchCanvas"
            v-model="sketchElements"
            :disabled="composerLocked"
            @editing="sketchHasText = $event"
          />
          <p v-if="sketchError" class="px-4 text-sm text-destructive" role="alert">
            {{ sketchError }}
          </p>
          <CardFooter class="justify-end gap-2 border-t px-4 pt-3">
            <Button type="button" variant="outline" size="sm" :disabled="composerLocked" @click="closeSketch">
              Cancel
            </Button>
            <Button type="button" size="sm" :disabled="!canSend" @click="submitMessage">
              <Spinner v-if="submittingSketch" />
              {{ submittingSketch ? 'Saving…' : 'Save sketch' }}
            </Button>
          </CardFooter>
        </Card>

        <div
          v-if="statusLabel"
          class="flex items-center gap-2 pt-1"
          role="status"
          aria-live="polite"
          :aria-label="statusLabel"
        >
          <span class="flex items-center gap-1.5" aria-hidden="true">
            <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span class="size-1.5 animate-bounce rounded-full bg-primary" />
          </span>
          <span class="text-xs text-muted-foreground">{{ statusLabel }}</span>
        </div>
        <p v-if="error" class="text-xs text-destructive">
          {{ error }}
        </p>
      </div>
    </div>

    <div
      v-if="(composerOnly || hideTranscript) && statusLabel"
      class="flex items-center gap-2 px-3 pt-3"
      role="status"
      aria-live="polite"
      :aria-label="statusLabel"
    >
      <span class="flex items-center gap-1.5" aria-hidden="true">
        <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span class="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span class="size-1.5 animate-bounce rounded-full bg-primary" />
      </span>
      <span class="text-xs text-muted-foreground">{{ statusLabel }}</span>
    </div>
    <p
      v-if="(composerOnly || hideTranscript) && error"
      class="px-3 pt-3 text-xs text-destructive"
    >
      {{ error }}
    </p>

    <form
      class="p-3"
      :class="composerOnly || hideTranscript ? undefined : 'border-t border-border'"
      @submit.prevent="onComposerSubmit"
      @paste="onComposerPaste"
    >
      <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-2">
        <div
          v-for="item in attachments"
          :key="item.id"
          class="relative overflow-hidden rounded-xl border border-border"
        >
          <button
            type="button"
            class="block size-14 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="isDocumentAttachment(item) ? `Document ${item.name}` : isAudioAttachment(item) ? `Voice reference ${item.name}` : isVideoAttachment(item) ? `Video reference ${item.name}` : `View ${item.name}`"
            @click="openAttachment(item)"
          >
            <div
              v-if="isDocumentAttachment(item)"
              class="flex size-14 flex-col items-center justify-center gap-0.5 bg-muted px-1 text-muted-foreground"
              :title="item.name"
            >
              <Icon name="lucide:file-text" class="size-5" />
              <span class="w-full truncate text-center text-[9px] leading-none">{{ item.name }}</span>
            </div>
            <div
              v-else-if="isAudioAttachment(item)"
              class="flex size-14 items-center justify-center bg-muted text-muted-foreground"
              :title="item.name"
            >
              <span class="text-lg" aria-hidden="true">♪</span>
            </div>
            <video
              v-else-if="isVideoAttachment(item)"
              :src="item.previewUrl || item.url"
              muted
              playsinline
              preload="metadata"
              class="size-14 object-cover"
            />
            <img
              v-else
              :src="item.previewUrl"
              :alt="item.name"
              class="size-14 object-cover"
            >
          </button>
          <div
            v-if="item.status !== 'ready'"
            class="absolute inset-0 flex items-center justify-center bg-background/70"
          >
            <Spinner v-if="item.status === 'uploading'" class="size-4" />
            <span v-else class="px-1 text-center text-[10px] text-destructive">
              Failed
            </span>
          </div>
          <button
            type="button"
            class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`Remove ${item.name}`"
            @click="emit('removeAttachment', item.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>
      <InputGroup class="rounded-xl bg-input/30 shadow-none">
        <Teleport to="body">
          <div
            v-if="mention && !composerLocked"
            :id="modelListId"
            role="listbox"
            :aria-label="mention.trigger === '/' ? 'Choose a skill' : 'Choose a model or project asset'"
            class="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            :style="mentionStyle"
            @mousedown.prevent
          >
            <p v-if="mention.trigger !== '/'" class="hidden px-3 py-2 text-xs text-muted-foreground md:block">
              ← → Switch columns · ↑ ↓ Navigate · Enter Select
            </p>
            <div v-if="mention.trigger === '/'" role="group" aria-label="Skills" class="min-h-0 overflow-y-auto overscroll-contain">
              <p class="px-3 py-2 text-xs font-semibold">
                Skills
              </p>
              <button
                v-for="(skill, index) in skillMatches"
                :id="`${modelListId}-skills-${index}`"
                :key="skill.id"
                type="button" role="option" :aria-selected="index === mentionIndex"
                class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                :class="index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                @click="selectSkill(skill)"
              >
                <Icon :name="skill.icon" class="size-6 shrink-0" />
                <span class="min-w-0"><span class="block text-sm font-medium">{{ skill.name }}</span><span class="block text-xs text-muted-foreground">{{ skill.description }}</span></span>
              </button>
              <p v-if="!skillMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                No matching skills
              </p>
            </div>
            <div v-else class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
              <div role="group" aria-label="Models" class="min-w-0 overflow-y-auto overscroll-contain">
                <p class="sticky top-0 z-10 bg-popover px-3 py-2 text-xs font-semibold">
                  Models
                </p>
                <button
                  v-for="(model, index) in modelMatches"
                  :id="`${modelListId}-models-${index}`"
                  :key="model.id"
                  type="button"
                  role="option"
                  :aria-selected="mentionColumn === 'models' && index === mentionIndex"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  :class="mentionColumn === 'models' && index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                  @click="selectModel(model)"
                >
                  <img v-if="agentModelLogo(model)" :src="agentModelLogo(model)" alt="" class="size-6 shrink-0 object-contain">
                  <Icon v-else :name="model.icon || 'lucide:box'" class="size-6 shrink-0" />
                  <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ model.name }}</span><span class="block text-xs text-muted-foreground">{{ model.task }}</span></span>
                </button>
                <p v-if="!modelMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                  No matching models
                </p>
              </div>
              <div role="group" aria-label="Project assets" class="min-w-0 overflow-y-auto overscroll-contain">
                <p class="sticky top-0 z-10 bg-popover px-3 py-2 text-xs font-semibold">
                  Project assets · {{ projectAssets.length }}
                </p>
                <button
                  v-for="(asset, index) in assetMatches" :id="`${modelListId}-assets-${index}`" :key="asset.id"
                  type="button" role="option" :aria-selected="mentionColumn === 'assets' && index === mentionIndex"
                  class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                  :class="mentionColumn === 'assets' && index === mentionIndex ? 'bg-accent text-accent-foreground' : ''"
                  @click="selectAsset(asset)"
                >
                  <Icon v-if="asset.audio" name="lucide:music" class="size-9 shrink-0 text-muted-foreground" />
                  <Icon v-else-if="asset.document" name="lucide:file-text" class="size-9 shrink-0 text-muted-foreground" />
                  <video
                    v-else-if="asset.video"
                    :src="asset.url"
                    muted
                    playsinline
                    preload="metadata"
                    class="size-9 shrink-0 rounded object-cover bg-muted/40"
                  />
                  <img v-else :src="asset.url" alt="" loading="lazy" class="size-9 shrink-0 rounded object-contain">
                  <span class="min-w-0"><span class="block truncate text-sm font-medium" :title="asset.name">{{ asset.name }}</span><span class="block text-xs text-muted-foreground">{{ asset.audio ? 'Audio' : asset.document ? mediaDocumentLabel(asset.name || asset.url) : asset.video ? 'Video' : 'Image' }}</span></span>
                </button>
                <p v-if="projectAssetsLoading" class="px-3 py-2 text-xs text-muted-foreground" role="status">
                  Loading project assets…
                </p>
                <p v-else-if="projectAssetsError" class="px-3 py-2 text-xs text-destructive" role="status">
                  {{ projectAssetsError }}
                </p>
                <p v-else-if="!assetMatches.length" class="px-3 py-4 text-sm text-muted-foreground" role="status">
                  {{ projectAssets.length ? 'No matching assets' : 'No assets in this project yet' }}
                </p>
              </div>
            </div>
          </div>
        </Teleport>
        <div v-if="selectedModels.length || selectedSkills.length" class="flex w-full flex-wrap gap-1.5 px-3 pt-3">
          <AgentLabSkillBadge v-for="skill in selectedSkills" :key="skill.id" :skill="skill" :removable="!isSkillLocked(skill.id)" :disabled="composerLocked" @remove="removeSkill(skill.id)" />
          <AgentLabModelBadge v-for="model in selectedModels" :key="model.id" :model="model" removable :disabled="composerLocked" @remove="removeModel(model.id)" />
        </div>
        <InputGroupTextarea
          ref="composerInput"
          v-model="composerText"
          :disabled="composerLocked"
          class="overflow-y-auto overscroll-contain rounded-xl [field-sizing:fixed] touch-pan-y"
          :class="compactComposer
            ? 'max-md:max-h-10 max-md:min-h-10 max-md:py-2 md:max-h-[min(40vh,20rem)] md:min-h-[88px]'
            : 'max-h-[min(40vh,20rem)] min-h-[88px]'"
          :placeholder="composerPlaceholderForSkills(selectedSkills) || (sketchVisible ? 'Describe how you want your sketch to look (optional)…' : agentComposerPlaceholder(selectedModels))"
          aria-label="Message to agent"
          :aria-expanded="Boolean(mention)"
          :aria-controls="mention ? modelListId : undefined"
          :aria-activedescendant="activeMentionId"
          @input="updateMention"
          @click="updateMention"
          @keyup.left="!mention && updateMention($event)"
          @keyup.right="!mention && updateMention($event)"
          @blur="mention = null"
          @keydown="onDraftKeydown"
          @compositionstart="onDraftCompositionStart"
          @compositionend="onDraftCompositionEnd"
        />
        <InputGroupAddon
          align="block-end"
          class="border-t border-border/80"
          :class="compactComposer && 'max-md:py-1'"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/aac,audio/ogg,audio/mp4,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv"
            multiple
            class="sr-only"
            @change="onPickFiles"
          >
          <InputGroupButton
            type="button"
            variant="ghost"
            size="icon-sm"
            class="rounded-lg"
            :disabled="composerLocked"
            aria-label="Attach image"
            @click="fileInput?.click()"
          >
            <Paperclip />
          </InputGroupButton>
          <div class="ms-auto flex min-w-0 items-center gap-2">
            <DropdownMenu :modal="false">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-8 max-w-full gap-1 rounded-lg px-2 text-xs font-medium shadow-none"
                  :disabled="prefsLocked"
                  aria-label="Generation approval"
                >
                  <span class="truncate">{{ confirmPolicyLabel }}</span>
                  <ChevronDown class="size-3.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    Generation approval
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    :model-value="confirmPolicy"
                    @update:model-value="setConfirmPolicy"
                  >
                    <DropdownMenuRadioItem value="auto" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>Automatic</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          Spend without clicking Confirm. The agent decides.
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="when_needed" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>Review when needed</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          Confirm only when the agent thinks a review is needed.
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="always" class="items-start">
                      <span class="flex flex-col gap-0.5">
                        <span>Always review</span>
                        <span class="text-xs font-normal text-muted-foreground">
                          Confirm every generation.
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              v-if="canStop"
              type="submit"
              variant="default"
              size="sm"
              class="rounded-lg"
              :disabled="stopping"
              aria-label="Stop agent"
            >
              <Square class="size-3.5 fill-current" data-icon="inline-start" />
              Stop
            </InputGroupButton>
            <InputGroupButton
              v-else
              type="submit"
              variant="default"
              size="sm"
              class="rounded-lg"
              :disabled="!canSend"
              aria-keyshortcuts="Enter"
            >
              <Spinner v-if="submittingSketch" class="size-4" />
              <ArrowUp v-else data-icon="inline-start" />
              {{ submittingSketch ? 'Saving…' : sketchSelected && sketchInProjectOnly ? 'Open in project' : sketchVisible ? 'Save sketch' : 'Send' }}
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  </section>
</template>
