<script setup lang="ts">
import type { ImageLayerRegion } from '~~/shared/utils/imageLayerSplitter'
import type { GeneratorUploadItem } from '@/composables/useAiGeneratorForm'
import { Scan, Upload, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { IDEOGRAM_REMOVE_BACKGROUND_MAX_BYTES, IDEOGRAM_REMOVE_BACKGROUND_MODEL } from '~~/shared/utils/ideogram'
import { IMAGE_LAYER_SPLITTER_MAX_BYTES, IMAGE_LAYER_SPLITTER_MODEL } from '~~/shared/utils/imageLayerSplitter'
import { readApiError } from '@/composables/useAiGeneratorForm'
import { useToolAgent } from '@/composables/useToolAgent'

const props = defineProps<{
  layerSplitter?: boolean
}>()
const toolModel = computed(() => props.layerSplitter ? IMAGE_LAYER_SPLITTER_MODEL : IDEOGRAM_REMOVE_BACKGROUND_MODEL)
const regions = ref<ImageLayerRegion[]>([])
const isSelecting = ref(false)
const failureMessage = computed(() => props.layerSplitter ? 'Image layer splitting failed' : 'Background removal failed')
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif'
const { startToolAgent } = useToolAgent()
const fileInputRef = ref<HTMLInputElement | null>(null)
const items = ref<GeneratorUploadItem[]>([])
const isSubmitting = ref(false)
let uploadXhr: XMLHttpRequest | null = null
const isUploading = computed(() => items.value.some(item => item.status === 'uploading'))
const readyUrl = computed(() => items.value.find(item => item.status === 'ready' && item.remoteUrl)?.remoteUrl || '')
const canRun = computed(() => Boolean(readyUrl.value) && !isUploading.value && !isSubmitting.value && (!props.layerSplitter || (regions.value.length > 0 && !isSelecting.value)))
function revokePreview(item: GeneratorUploadItem) {
  if (item.previewUrl.startsWith('blob:'))
    URL.revokeObjectURL(item.previewUrl)
}
function openFilePicker() {
  fileInputRef.value?.click()
}
function uploadFile(file: File, onProgress: (percent: number) => void) {
  return new Promise<{
    url: string
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    uploadXhr = xhr
    xhr.open('POST', '/api/uploads')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error('Upload failed'))
        return
      }
      try {
        const data = JSON.parse(xhr.responseText) as {
          url?: string
        }
        if (!data.url) {
          reject(new Error('Upload did not return a URL'))
          return
        }
        resolve({ url: data.url })
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
async function onFilesSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file)
    return
  const name = file.name.toLowerCase()
  const allowed = ACCEPT.split(',').some(type => file.type === type
    || (type === 'image/jpeg' && (name.endsWith('.jpg') || name.endsWith('.jpeg')))
    || (type === 'image/gif' && name.endsWith('.gif'))
    || (type === 'image/avif' && name.endsWith('.avif')))
  if (!allowed || file.size > (props.layerSplitter ? IMAGE_LAYER_SPLITTER_MAX_BYTES : IDEOGRAM_REMOVE_BACKGROUND_MAX_BYTES)) {
    toast.error(`Use JPEG, PNG, WEBP, GIF, or AVIF images up to ${props.layerSplitter ? 30 : 10}MB`)
    return
  }
  if (props.layerSplitter) {
    const preview = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = preview
      await image.decode()
      const area = image.naturalWidth * image.naturalHeight
      const ratio = image.naturalWidth / image.naturalHeight
      if (area < 512 * 512 || area > 6000 * 6000 || ratio < 1 / 16 || ratio > 16) {
        toast.error('Use an image with 262,144–36,000,000 pixels and an aspect ratio between 1:16 and 16:1')
        return
      }
    }
    catch {
      toast.error('Could not read this image')
      return
    }
    finally {
      URL.revokeObjectURL(preview)
    }
  }
  regions.value = []
  items.value.forEach(revokePreview)
  const id = `${Date.now()}-${file.name}`
  items.value = [{
    id,
    previewUrl: URL.createObjectURL(file),
    remoteUrl: null,
    progress: 1,
    status: 'uploading',
    kind: 'image',
  }]
  try {
    const uploaded = await uploadFile(file, (percent) => {
      const current = items.value.find(item => item.id === id)
      if (current)
        current.progress = percent
    })
    const current = items.value.find(item => item.id === id)
    if (!current)
      return
    current.remoteUrl = uploaded.url
    current.progress = 100
    current.status = 'ready'
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      items.value = items.value.filter(item => item.id !== id)
      return
    }
    toast.error(readApiError(error, 'Upload failed'))
    const current = items.value.find(item => item.id === id)
    if (current)
      current.status = 'error'
  }
}
function removeItem(id: string) {
  regions.value = []
  uploadXhr?.abort()
  const item = items.value.find(entry => entry.id === id)
  if (item)
    revokePreview(item)
  items.value = items.value.filter(entry => entry.id !== id)
}
async function handleRun() {
  if (!canRun.value || !readyUrl.value)
    return
  isSubmitting.value = true
  try {
    await startToolAgent(toolModel.value, {
      image_url: props.layerSplitter ? readyUrl.value : [readyUrl.value],
      ...(props.layerSplitter ? { regions: regions.value } : {}),
    })
  }
  catch (error) {
    toast.error(readApiError(error, failureMessage.value))
  }
  finally {
    isSubmitting.value = false
  }
}
onBeforeUnmount(() => {
  uploadXhr?.abort()
  items.value.forEach(revokePreview)
})
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <ProjectsProjectSelector :disabled="isSubmitting" />
    <section class="rounded-2xl border border-border bg-card p-4 shadow-none md:p-5">
      <div v-if="layerSplitter" class="grid gap-4">
        <button
          v-if="!readyUrl"
          type="button"
          class="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait"
          :disabled="isUploading"
          :aria-busy="isUploading"
          @click="openFilePicker"
        >
          <Spinner v-if="isUploading" class="size-6" />
          <Upload v-else class="size-7 text-muted-foreground" />
          <span class="text-sm font-medium" role="status">{{ isUploading ? `Uploading… ${items[0]?.progress || 0}%` : items[0]?.status === 'error' ? 'Upload failed — choose an image to try again' : 'Upload an image' }}</span>
          <span class="text-xs text-muted-foreground">JPG, PNG, WEBP, GIF or AVIF · Up to 30 MB</span>
        </button>
        <div v-if="readyUrl" class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="flex items-center gap-2 text-sm font-medium">
              <Scan class="size-4" /> Select what to separate
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Draw a box around each object you want to separate.
            </p>
          </div>
          <div v-if="items.length" class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="isUploading || isSubmitting" @click="openFilePicker">
              Replace image
            </Button>
            <Button variant="ghost" size="icon" aria-label="Remove image" :disabled="isSubmitting" @click="removeItem(items[0]!.id)">
              <X class="size-4" />
            </Button>
          </div>
        </div>
        <ToolsImageRegionSelector
          v-if="readyUrl"
          :key="items[0]?.id || 'empty'"
          v-model="regions"
          :src="items[0]?.previewUrl || ''"
          :disabled="isSubmitting"
          @pick="openFilePicker"
          @selecting="isSelecting = $event"
        />
      </div>
      <input ref="fileInputRef" type="file" :accept="ACCEPT" class="hidden" @change="onFilesSelected">
      <div v-if="!layerSplitter || readyUrl" class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between" :class="layerSplitter ? 'mt-4 border-t border-border pt-4 lg:justify-end' : ''">
        <AiGeneratorUploadStrip
          v-if="!layerSplitter"
          label="Image"
          :items="items"
          :accept="ACCEPT"
          :max-items="1"
          @pick="openFilePicker"
          @remove="removeItem"
        />
        <Button
          type="button"
          class="h-9 shrink-0 gap-2 rounded-lg px-4 shadow-none max-lg:w-full"
          :disabled="!canRun"
          :aria-busy="isUploading || isSubmitting"
          @click="handleRun"
        >
          <Spinner v-if="isUploading || isSubmitting" />
          {{ layerSplitter ? 'Separate selected layers' : 'Remove background' }}
        </Button>
      </div>
    </section>
  </div>
</template>
