import type { GenerationJobPublic, GenerationJobsList } from '~~/shared/types/generation'
import type { AiCategory, AiFormValues, AiTask, FieldConfig } from '@/types/aiModel'
import { FetchError } from 'ofetch'
import { toast } from 'vue-sonner'
import { isGenerationActive, isGenerationQueued, isGenerationTerminal } from '~~/shared/types/generation'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { isFlux3GenerateModel } from '~~/shared/utils/flux3'
import { gptCompatibleAspect, gptCompatibleResolution } from '~~/shared/utils/gptImage2'
import { useToolAgent } from '@/composables/useToolAgent'
import { AI_CATEGORIES, AI_MODELS, AI_TASKS } from '@/constants/aiModels'
import { createDefaultValues, getFieldsByPlacement, getInputSchema, isFormValid, mergePreservedValues, parseFieldConfigs } from '@/lib/aiModelSchema'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const DEFAULT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
const GENERATION_POLL_MS = 2500
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
export function readApiError(error: unknown, fallback: string) {
  return readErrorMessage(error, fallback)
}
export interface GeneratorUploadItem {
  id: string
  previewUrl: string
  remoteUrl: string | null
  progress: number
  status: 'uploading' | 'ready' | 'error'
  kind: 'image' | 'video' | 'audio'
  durationSeconds?: number
}
function readMediaDuration(file: File) {
  if (!import.meta.client)
    return Promise.resolve(0)
  return new Promise<number>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video')
    const cleanup = () => {
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(objectUrl)
    }
    element.preload = 'metadata'
    element.onloadedmetadata = () => {
      const duration = element.duration
      cleanup()
      if (!Number.isFinite(duration) || duration <= 0)
        reject(new Error('Could not read duration'))
      else
        resolve(duration)
    }
    element.onerror = () => {
      cleanup()
      reject(new Error('Could not read duration'))
    }
    element.src = objectUrl
  })
}
function parseAcceptList(accept: string) {
  return accept.split(',').map(part => part.trim()).filter(Boolean)
}
function uploadKindForType(type: string): GeneratorUploadItem['kind'] {
  if (type.startsWith('video/'))
    return 'video'
  if (type.startsWith('audio/'))
    return 'audio'
  return 'image'
}
function maxBytesForType(type: string) {
  if (type.startsWith('video/'))
    return MAX_VIDEO_BYTES
  if (type.startsWith('audio/'))
    return MAX_AUDIO_BYTES
  return MAX_IMAGE_BYTES
}
export function fileMatchesAccept(file: File, accept: string) {
  const types = parseAcceptList(accept)
  if (!types.length)
    return true
  const name = file.name.toLowerCase()
  return types.some((entry) => {
    if (entry.endsWith('/*'))
      return file.type.startsWith(entry.slice(0, -1))
    if (file.type === entry)
      return true
    if (entry === 'image/bmp' && name.endsWith('.bmp'))
      return true
    if (entry === 'image/jpeg' && (name.endsWith('.jpg') || name.endsWith('.jpeg')))
      return true
    if (entry === 'image/gif' && name.endsWith('.gif'))
      return true
    if (entry === 'image/avif' && name.endsWith('.avif'))
      return true
    if (entry === 'video/quicktime' && name.endsWith('.mov'))
      return true
    if (entry === 'video/mp4' && name.endsWith('.mp4'))
      return true
    return false
  })
}
export function acceptHint(accept: string, maxBytes?: number) {
  const fallback = accept.includes('video/')
    ? MAX_VIDEO_BYTES
    : accept.includes('audio/')
      ? MAX_AUDIO_BYTES
      : MAX_IMAGE_BYTES
  const mb = Math.round((maxBytes || fallback) / (1024 * 1024))
  if (accept.includes('video/'))
    return `Use MP4 or MOV videos up to ${mb}MB`
  if (accept.includes('audio/'))
    return `Use MP3 or WAV files up to ${mb}MB`
  if (accept.includes('image/bmp'))
    return `Use JPEG, PNG, WEBP, or BMP images up to ${mb}MB`
  if (accept.includes('image/gif') && accept.includes('image/avif'))
    return `Use JPEG, PNG, WEBP, GIF, or AVIF images up to ${mb}MB`
  if (accept.includes('image/gif'))
    return `Use JPEG, PNG, WEBP, or GIF images up to ${mb}MB`
  return `Use JPEG, PNG, or WEBP images up to ${mb}MB`
}
export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
export function uploadFileWithProgress(file: File, onProgress: (percent: number) => void, xhrRef: {
  current: XMLHttpRequest | null
}) {
  return new Promise<{
    url: string
    duration?: number
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', '/api/uploads')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(readUploadError(xhr)))
        return
      }
      try {
        const data = JSON.parse(xhr.responseText) as {
          url?: string
          duration?: number
        }
        if (!data.url) {
          reject(new Error('Upload did not return a URL'))
          return
        }
        resolve({
          url: data.url,
          duration: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : undefined,
        })
      }
      catch {
        reject(new Error('Upload did not return a URL'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    const body = new FormData()
    body.append('file', file)
    xhr.send(body)
  })
}
function readUploadError(xhr: XMLHttpRequest) {
  try {
    const data = JSON.parse(xhr.responseText) as {
      statusMessage?: string
      message?: string
    }
    return data.statusMessage || data.message || `Upload failed (${xhr.status})`
  }
  catch {
    return `Upload failed (${xhr.status})`
  }
}
export function useAiGeneratorCategory() {
  const selectedCategory = useState<AiCategory>('ai-generator-category', () => 'Image')
  if (selectedCategory.value === 'Tools')
    selectedCategory.value = 'Image'

  return {
    categories: AI_CATEGORIES,
    selectedCategory,
  }
}
export function useAiGeneratorTask() {
  const { selectedCategory } = useAiGeneratorCategory()
  const selectedTask = useState<AiTask>('ai-generator-task', () => AI_MODELS[0]?.task ?? 'Image to Image')
  const categoryTasks = computed(() => AI_TASKS.filter(task => task.category === selectedCategory.value))
  const availableTasks = computed(() => categoryTasks.value.filter(task => !task.comingSoon))
  watch([selectedCategory, selectedTask], () => {
    if (!availableTasks.value.some(task => task.value === selectedTask.value))
      selectedTask.value = availableTasks.value[0]?.value ?? selectedTask.value
  }, { immediate: true })
  return {
    selectedTask,
    availableTasks,
    categoryTasks,
  }
}
export function applyGeneratorSelection(modelId: string) {
  const model = AI_MODELS.find(item => item.id === modelId)
  if (!model || model.category === 'Tools')
    return false
  const selectedCategory = useState<AiCategory>('ai-generator-category', () => 'Image')
  const selectedTask = useState<AiTask>('ai-generator-task', () => AI_MODELS[0]?.task ?? 'Image to Image')
  const selectedModelId = useState('ai-generator-model', () => AI_MODELS[0]?.id ?? '')
  selectedModelId.value = model.id
  selectedCategory.value = model.category
  selectedTask.value = model.task
  return true
}
export function useAiGeneratorForm() {
  const { selectedCategory } = useAiGeneratorCategory()
  const { selectedTask, availableTasks } = useAiGeneratorTask()
  const { selectedProjectId } = useProjects()
  const { startToolAgent } = useToolAgent()
  const selectedModelId = useState('ai-generator-model', () => AI_MODELS[0]?.id ?? '')
  const formValues = ref<AiFormValues>({})
  const uploadedByField = ref<Record<string, GeneratorUploadItem[]>>({})
  const uploadRequests = new Map<string, XMLHttpRequest>()
  const isSubmitting = ref(false)

  const recentJobs = ref<GenerationJobPublic[]>([])
  const jobsReady = ref(false)
  const pollingTaskIds = new Set<string>()
  const locallyDeletedTaskIds = new Set<string>()
  let pollEpoch = 0
  const availableModels = computed(() => AI_MODELS.filter(model => model.category === selectedCategory.value
    && model.task === selectedTask.value))
  const selectedModel = computed(() => availableModels.value.find(model => model.id === selectedModelId.value)
    ?? availableModels.value[0])
  const fields = computed<FieldConfig[]>(() => {
    if (!selectedModel.value)
      return []
    return parseFieldConfigs(getInputSchema(selectedModel.value.schema))
  })
  const primaryFields = computed(() => getFieldsByPlacement(fields.value, 'primary'))
  const toolbarFields = computed(() => getFieldsByPlacement(fields.value, 'toolbar'))
  const advancedFields = computed(() => getFieldsByPlacement(fields.value, 'advanced'))
  const uploadFields = computed(() => primaryFields.value.filter(field => field.widget === 'upload'))
  const isUploading = computed(() => Object.values(uploadedByField.value).some(items => items.some(item => item.status === 'uploading')))
  const hasReferenceUploads = computed(() => {
    const keys = selectedModel.value?.id.startsWith('minimax-h3/') || selectedModel.value?.id.startsWith('wan/')
      ? ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls']
      : ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls', 'image_urls', 'video_urls', 'audio_urls']
    return keys.some(key => Boolean(typeof formValues.value[key] === 'string' ? formValues.value[key] : Array.isArray(formValues.value[key]) && (formValues.value[key] as unknown[]).length))
  })
  const hasI2vFrame = computed(() => ['first_frame_url', 'last_frame_url', 'image_url', 'start_image_url', 'end_image_url']
    .some(key => Boolean(typeof formValues.value[key] === 'string' ? formValues.value[key] : Array.isArray(formValues.value[key]) && (formValues.value[key] as unknown[]).length)))
  const hasFirstFrame = computed(() => ['first_frame_url', 'image_url']
    .some(key => Boolean(typeof formValues.value[key] === 'string' ? formValues.value[key] : Array.isArray(formValues.value[key]) && (formValues.value[key] as unknown[]).length)))
  const canGenerate = computed(() => {
    const modelId = selectedModel.value?.id ?? ''
    return Boolean(selectedModel.value)
      && isFormValid(fields.value, formValues.value)
      && (!modelId.includes('reference-to-video') || hasReferenceUploads.value)
      && (modelId !== 'minimax-h3/image-to-video' || hasI2vFrame.value)
      && (!isFlux3GenerateModel(modelId) || !modelId.includes('image-to-video') || hasFirstFrame.value)
      && !isUploading.value
      && !isSubmitting.value
  })
  const resultJobs = computed(() => recentJobs.value)
  function upsertJob(job: GenerationJobPublic) {
    if (locallyDeletedTaskIds.has(job.taskId))
      return
    recentJobs.value = [
      job,
      ...recentJobs.value.filter(entry => entry.taskId !== job.taskId),
    ].slice(0, 10)
  }
  function removeJob(taskId: string) {
    locallyDeletedTaskIds.add(taskId)
    recentJobs.value = recentJobs.value.filter(entry => entry.taskId !== taskId)
    pollingTaskIds.delete(taskId)
  }
  const deletingTaskId = ref<string | null>(null)
  const deleteConfirmOpen = ref(false)
  const pendingDeleteTaskId = ref('')
  function requestDeleteJob(taskId: string) {
    const job = recentJobs.value.find(item => item.taskId === taskId)
    if (job && isGenerationActive(job.state))
      return
    pendingDeleteTaskId.value = taskId
    deleteConfirmOpen.value = true
  }
  async function confirmDeleteJob() {
    const taskId = pendingDeleteTaskId.value
    if (!taskId || deletingTaskId.value)
      return
    deletingTaskId.value = taskId
    try {
      await $fetch(`/api/ai/jobs/${taskId}`, { method: 'DELETE' })
      removeJob(taskId)
      deleteConfirmOpen.value = false
      pendingDeleteTaskId.value = ''
    }
    catch (error) {
      if (error instanceof FetchError && error.statusCode === 404)
        removeJob(taskId)
      else
        toast.error(readApiError(error, 'Could not delete this result'))
      deleteConfirmOpen.value = false
    }
    finally {
      deletingTaskId.value = null
    }
  }
  function itemsForField(key: string) {
    return uploadedByField.value[key] ?? []
  }
  function setItemsForField(key: string, items: GeneratorUploadItem[]) {
    uploadedByField.value = {
      ...uploadedByField.value,
      [key]: items,
    }
  }
  function revokePreview(item: GeneratorUploadItem) {
    if (item.previewUrl.startsWith('blob:'))
      URL.revokeObjectURL(item.previewUrl)
  }
  function patchUploadItem(fieldKey: string, id: string, patch: Partial<GeneratorUploadItem>) {
    setItemsForField(fieldKey, itemsForField(fieldKey).map(item => item.id === id ? { ...item, ...patch } : item))
  }
  function syncUploadField(fieldKey: string) {
    const field = fields.value.find(entry => entry.key === fieldKey && entry.widget === 'upload')
    if (!field)
      return
    const urls = itemsForField(fieldKey).map(item => item.remoteUrl).filter((url): url is string => Boolean(url))
    setFieldValue(fieldKey, field.property.type === 'string' ? urls[0] || '' : urls)
  }
  function pruneUnusedUploads() {
    const allowed = new Set(fields.value.filter(field => field.widget === 'upload').map(field => field.key))
    const next = { ...uploadedByField.value }
    let changed = false
    for (const key of Object.keys(next)) {
      if (allowed.has(key))
        continue
      next[key]?.forEach(revokePreview)
      delete next[key]
      changed = true
    }
    if (changed)
      uploadedByField.value = next
    for (const key of allowed)
      syncUploadField(key)
  }
  function initializeFormValues(preserve = false) {
    const defaults = createDefaultValues(fields.value)
    formValues.value = preserve
      ? mergePreservedValues(defaults, formValues.value, fields.value)
      : defaults
    pruneUnusedUploads()
  }
  function syncModelForTask() {
    const matchingModels = AI_MODELS.filter(model => model.category === selectedCategory.value
      && model.task === selectedTask.value)
    const currentName = AI_MODELS.find(model => model.id === selectedModelId.value)?.name
    const nextModel = matchingModels.find(model => model.id === selectedModelId.value)
      ?? matchingModels.find(model => model.name === currentName)
      ?? matchingModels[0]
    selectedModelId.value = nextModel?.id ?? ''
  }
  function syncSelectionForCategory() {
    const tasks = availableTasks.value
    if (!tasks.some(task => task.value === selectedTask.value))
      selectedTask.value = tasks[0]?.value ?? selectedTask.value
    syncModelForTask()
  }
  watch([selectedCategory, selectedTask], () => {
    syncSelectionForCategory()
  }, { immediate: true })
  watch(() => selectedModel.value?.id, () => {
    initializeFormValues(true)
  }, { immediate: true })
  const inputVideoDuration = computed(() => itemsForField('reference_video_urls').filter(item => item.status === 'ready').reduce((total, item) => total + (item.durationSeconds || 0), 0))
  function setFieldValue(key: string, value: unknown) {
    const nextValues: AiFormValues = {
      ...formValues.value,
      [key]: value,
    }
    if (selectedModel.value?.id.startsWith('gpt-image-2')) {
      const aspect = String(nextValues.aspect_ratio ?? 'auto')
      const resolution = String(nextValues.resolution ?? '1K')
      if (key === 'resolution')
        nextValues.aspect_ratio = gptCompatibleAspect(resolution, aspect)
      else if (key === 'aspect_ratio')
        nextValues.resolution = gptCompatibleResolution(aspect, resolution)
    }
    formValues.value = nextValues
  }
  async function addUploadedFiles(fieldKey: string, files: FileList | File[]) {
    const uploadField = fields.value.find(field => field.key === fieldKey && field.widget === 'upload')
    if (!uploadField)
      return
    const accept = uploadField.property['x-accept'] || DEFAULT_IMAGE_ACCEPT
    const maxItems = uploadField.property.maxItems ?? 10
    const remaining = Math.max(0, maxItems - itemsForField(fieldKey).length)
    const accepted: Array<{
      file: File
      durationSeconds?: number
    }> = []
    const minSeconds = uploadField.property['x-min-seconds'] ?? 2
    const maxSeconds = uploadField.property['x-max-seconds'] ?? 30
    const maxTotalSeconds = uploadField.property['x-max-total-seconds'] ?? 30
    const currentVideoSeconds = (fieldKey === 'reference_video_urls' || fieldKey === 'video_urls')
      ? itemsForField(fieldKey).reduce((total, item) => total + (item.durationSeconds || 0), 0)
      : 0
    let extraVideoSeconds = 0
    for (const file of Array.from(files).slice(0, remaining)) {
      const maxBytes = uploadField.property['x-max-bytes'] || maxBytesForType(file.type)
      if (!fileMatchesAccept(file, accept)) {
        toast.error(acceptHint(accept, maxBytes))
        continue
      }
      if (file.size > maxBytes) {
        toast.error(acceptHint(accept, maxBytes))
        continue
      }
      let durationSeconds: number | undefined
      if ((fieldKey === 'reference_video_urls' || fieldKey === 'video_urls')) {
        try {
          durationSeconds = await readMediaDuration(file)
          if (durationSeconds < minSeconds || durationSeconds > maxSeconds) {
            toast.error(`Each reference video must be ${minSeconds}-${maxSeconds} seconds`)
            continue
          }
          if (currentVideoSeconds + extraVideoSeconds + durationSeconds > maxTotalSeconds) {
            toast.error(`Reference videos cannot exceed ${maxTotalSeconds} seconds in total`)
            continue
          }
          extraVideoSeconds += durationSeconds
        }
        catch {
          toast.error('Could not read this video. Try another MP4 or MOV file.')
          continue
        }
      }
      accepted.push({ file, durationSeconds })
    }
    await Promise.all(accepted.map(item => startFileUpload(fieldKey, item.file, item.durationSeconds)))
  }
  async function startFileUpload(fieldKey: string, file: File, durationSeconds?: number) {
    const id = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)
    const xhrRef: {
      current: XMLHttpRequest | null
    } = { current: null }
    setItemsForField(fieldKey, [
      ...itemsForField(fieldKey),
      {
        id,
        previewUrl,
        remoteUrl: null,
        progress: 0,
        status: 'uploading',
        kind: uploadKindForType(file.type),
        durationSeconds,
      },
    ])
    try {
      const uploadPromise = uploadFileWithProgress(file, (progress) => {
        patchUploadItem(fieldKey, id, { progress })
      }, xhrRef)
      if (xhrRef.current)
        uploadRequests.set(id, xhrRef.current)
      const uploaded = await uploadPromise
      const measuredDuration = uploaded.duration ?? durationSeconds
      if ((fieldKey === 'reference_video_urls' || fieldKey === 'video_urls') && measuredDuration != null) {
        const uploadField = fields.value.find(field => field.key === fieldKey && field.widget === 'upload')
        const minSeconds = uploadField?.property['x-min-seconds'] ?? 2
        const maxSeconds = uploadField?.property['x-max-seconds'] ?? 30
        const maxTotalSeconds = uploadField?.property['x-max-total-seconds'] ?? 30
        const otherSeconds = itemsForField(fieldKey)
          .filter(item => item.id !== id)
          .reduce((total, item) => total + (item.durationSeconds || 0), 0)
        if (measuredDuration < minSeconds || measuredDuration > maxSeconds) {
          toast.error(`Each reference video must be ${minSeconds}-${maxSeconds} seconds`)
          removeUploadedItem(fieldKey, id)
          return
        }
        if (otherSeconds + measuredDuration > maxTotalSeconds) {
          toast.error(`Reference videos cannot exceed ${maxTotalSeconds} seconds in total`)
          removeUploadedItem(fieldKey, id)
          return
        }
      }
      patchUploadItem(fieldKey, id, {
        remoteUrl: uploaded.url,
        progress: 100,
        status: 'ready',
        durationSeconds: measuredDuration,
      })
      syncUploadField(fieldKey)
    }
    catch (error) {
      if (isAbortError(error)) {
        return
      }
      toast.error(error instanceof Error ? error.message : 'Upload failed')
      removeUploadedItem(fieldKey, id)
    }
    finally {
      uploadRequests.delete(id)
    }
  }
  function removeUploadedItem(fieldKey: string, id: string) {
    const item = itemsForField(fieldKey).find(entry => entry.id === id)
    if (!item)
      return
    uploadRequests.get(id)?.abort()
    uploadRequests.delete(id)
    revokePreview(item)
    setItemsForField(fieldKey, itemsForField(fieldKey).filter(entry => entry.id !== id))
    syncUploadField(fieldKey)
  }

  async function pollJob(taskId: string, epoch: number) {
    let generatingSince = 0
    try {
      for (;;) {
        if (epoch !== pollEpoch)
          return
        if (generatingSince && Date.now() - generatingSince > GENERATION_TIMEOUT_MS) {
          toast.error('Generation is taking longer than expected. Results will appear when ready.')
          return
        }
        const job = await $fetch<GenerationJobPublic>(`/api/ai/jobs/${taskId}`)
        if (epoch !== pollEpoch)
          return
        upsertJob(job)
        if (job.state === 'success') {
          return
        }
        if (job.state === 'fail') {
          toast.error(job.failMsg || 'Generation failed')
          return
        }
        if (isGenerationQueued(job.state))
          generatingSince = 0
        else if (!generatingSince)
          generatingSince = Date.now()
        await sleep(GENERATION_POLL_MS)
      }
    }
    catch (error) {
      if (epoch !== pollEpoch)
        return
      if (error instanceof FetchError && error.statusCode === 404) {
        removeJob(taskId)
        return
      }
      toast.error(readApiError(error, 'Generation failed'))
    }
    finally {
      pollingTaskIds.delete(taskId)
    }
  }
  function startPolling(taskId: string) {
    if (!taskId || pollingTaskIds.has(taskId))
      return
    pollingTaskIds.add(taskId)
    void pollJob(taskId, pollEpoch)
  }
  function stopAllPolls() {
    pollEpoch += 1
    pollingTaskIds.clear()
  }
  function resumeInflightJobs(jobs: GenerationJobPublic[]) {
    for (const job of jobs) {
      if (!isGenerationTerminal(job.state))
        startPolling(job.taskId)
    }
  }
  async function loadRecentJobs() {
    jobsReady.value = false
    try {
      const data = await $fetch<GenerationJobsList>('/api/ai/jobs', {
        query: { page: 1, limit: 10 },
      })
      recentJobs.value = data.items
      resumeInflightJobs(recentJobs.value)
    }
    catch (error) {
      console.error('[AI jobs]', error)
    }
    finally {
      jobsReady.value = true
    }
  }
  async function handleGenerate(options: {
    inAgent?: boolean
  } = {}) {
    if (isUploading.value || isSubmitting.value || !canGenerate.value || !selectedModel.value) {
      return
    }

    const payload = Object.fromEntries(fields.value.map(field => [field.key, formValues.value[field.key]]))
    isSubmitting.value = true
    try {
      if (options.inAgent) {
        await startToolAgent(selectedModel.value.id, payload)
        return
      }
      const job = await $fetch<GenerationJobPublic>('/api/ai/generate', {
        method: 'POST',
        body: {
          model: selectedModel.value.id,
          category: selectedCategory.value,
          task: selectedTask.value,
          projectId: selectedProjectId.value || undefined,
          input: payload,
          inputVideoDuration: inputVideoDuration.value,
        },
      })
      upsertJob(job)

      startPolling(job.taskId)
      return job
    }
    catch (error) {
      toast.error(readApiError(error, 'Generation failed'))
    }
    finally {
      isSubmitting.value = false
    }
  }

  onBeforeUnmount(() => {
    stopAllPolls()
    for (const xhr of uploadRequests.values())
      xhr.abort()
    uploadRequests.clear()
    Object.values(uploadedByField.value).forEach((items) => {
      items.forEach(revokePreview)
    })
  })
  async function ingestGeneratedJob(job: GenerationJobPublic) {
    upsertJob(job)

    startPolling(job.taskId)
  }
  onMounted(() => { void loadRecentJobs() })

  return {
    categories: AI_CATEGORIES,
    tasks: AI_TASKS,
    availableTasks,
    availableModels,
    selectedCategory,
    selectedTask,
    selectedModelId,
    selectedModel,
    formValues,
    uploadFields,
    itemsForField,
    primaryFields,
    toolbarFields,
    advancedFields,
    canGenerate,
    isUploading,
    isSubmitting,
    resultJobs,
    jobsReady,
    deletingTaskId,
    deleteConfirmOpen,
    requestDeleteJob,
    confirmDeleteJob,
    inputVideoDuration,
    setFieldValue,
    addUploadedFiles,
    removeUploadedItem,
    handleGenerate,
    ingestGeneratedJob,
  }
}
