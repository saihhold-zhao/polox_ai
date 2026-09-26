<script setup lang="ts">
import { Mic, Square } from 'lucide-vue-next'

/** Last-resort fallback only when the agent omitted `script`; callers (e.g. talking-avatar) must pass a language-appropriate script. */
const DEFAULT_SCRIPT = 'Hello, this is my voice sample. I am recording so the video can match how I speak. Please listen carefully to my tone and pace.'
const MAX_SECONDS = 25

const props = withDefaults(defineProps<{
  prompt?: string
  script?: string
  disabled?: boolean
  uploadAudio?: (file: File) => Promise<{ url: string, name: string }>
}>(), {
  prompt: '',
  script: '',
  disabled: false,
})

const emit = defineEmits<{
  ready: [payload: { url: string, name: string }]
  /** User confirms the uploaded sample — parent submits to the agent. */
  finish: [payload: { url: string, name: string }]
  clear: []
  uploading: [value: boolean]
}>()

const readingScript = computed(() => {
  const fromProp = String(props.script || '').trim()
  if (fromProp)
    return fromProp
  const prompt = String(props.prompt || '')
  const quoted = prompt.match(/[“”"]([^“”"]{20,})[“”"]/)
  if (quoted?.[1]?.trim())
    return quoted[1].trim()
  const block = prompt.match(/```([\s\S]*?)```/)
  if (block?.[1]?.trim())
    return block[1].trim()
  return DEFAULT_SCRIPT
})

const recording = ref(false)
const elapsed = ref(0)
const error = ref('')
const previewUrl = ref('')
const voiceUrl = ref('')
const voiceName = ref('')
const uploading = ref(false)

let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let chunks: BlobPart[] = []
let tickTimer: ReturnType<typeof setInterval> | null = null
let autoStopTimer: ReturnType<typeof setTimeout> | null = null

const canRecord = computed(() => !props.disabled && !uploading.value && typeof window !== 'undefined')

function clearTimers() {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  if (autoStopTimer) {
    clearTimeout(autoStopTimer)
    autoStopTimer = null
  }
}

function stopTracks() {
  mediaStream?.getTracks().forEach(track => track.stop())
  mediaStream = null
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function')
    return ''
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

function extensionForMime(mime: string) {
  const base = mime.toLowerCase().split(';')[0]!.trim()
  if (base.includes('mp4'))
    return 'm4a'
  if (base.includes('ogg'))
    return 'ogg'
  if (base.includes('wav'))
    return 'wav'
  return 'webm'
}

function formatTime(total: number) {
  const seconds = Math.max(0, Math.floor(total))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

async function startRecording() {
  if (!canRecord.value || recording.value)
    return
  error.value = ''
  voiceUrl.value = ''
  voiceName.value = ''
  emit('clear')
  revokePreview()
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    error.value = 'Microphone recording is not supported in this browser.'
    return
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  }
  catch {
    error.value = 'Microphone permission was denied. Allow mic access, or upload an audio file instead.'
    stopTracks()
    return
  }
  const mime = pickMime()
  try {
    mediaRecorder = mime
      ? new MediaRecorder(mediaStream, { mimeType: mime })
      : new MediaRecorder(mediaStream)
  }
  catch {
    error.value = 'Could not start the recorder in this browser.'
    stopTracks()
    return
  }
  chunks = []
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size)
      chunks.push(event.data)
  }
  mediaRecorder.onerror = () => {
    error.value = 'Recording failed. Try again.'
    void stopRecording(false)
  }
  mediaRecorder.onstop = () => {
    void finalizeRecording(mediaRecorder?.mimeType || mime || 'audio/webm')
  }
  mediaRecorder.start(250)
  recording.value = true
  elapsed.value = 0
  clearTimers()
  tickTimer = setInterval(() => {
    elapsed.value += 1
  }, 1000)
  autoStopTimer = setTimeout(() => {
    void stopRecording(true)
  }, MAX_SECONDS * 1000)
}

async function stopRecording(keep = true) {
  clearTimers()
  const recorder = mediaRecorder
  if (!recorder || recorder.state === 'inactive') {
    recording.value = false
    stopTracks()
    if (!keep) {
      chunks = []
      revokePreview()
    }
    return
  }
  recording.value = false
  if (!keep) {
    recorder.ondataavailable = null
    recorder.onstop = () => {
      chunks = []
      stopTracks()
    }
  }
  recorder.stop()
}

async function finalizeRecording(mimeType: string) {
  stopTracks()
  const baseMime = (mimeType || 'audio/webm').toLowerCase().split(';')[0]!.trim() || 'audio/webm'
  const blob = new Blob(chunks, { type: baseMime })
  chunks = []
  mediaRecorder = null
  if (!blob.size) {
    error.value = 'No audio was captured. Try recording again.'
    return
  }
  previewUrl.value = URL.createObjectURL(blob)
  if (!props.uploadAudio) {
    error.value = 'Audio upload is unavailable right now.'
    return
  }
  uploading.value = true
  emit('uploading', true)
  try {
    const file = new File([blob], `voice-sample.${extensionForMime(baseMime)}`, { type: baseMime })
    const uploaded = await props.uploadAudio(file)
    voiceUrl.value = uploaded.url
    voiceName.value = uploaded.name || file.name
    emit('ready', { url: voiceUrl.value, name: voiceName.value })
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Upload failed. Try recording again.'
    voiceUrl.value = ''
    voiceName.value = ''
    emit('clear')
  }
  finally {
    uploading.value = false
    emit('uploading', false)
  }
}

function finishRecording() {
  if (props.disabled || uploading.value || recording.value)
    return
  const url = voiceUrl.value.trim()
  if (!url) {
    error.value = 'Record a sample before finishing.'
    return
  }
  emit('finish', { url, name: voiceName.value })
}

async function reRecord() {
  if (props.disabled || uploading.value)
    return
  await stopRecording(false)
  revokePreview()
  voiceUrl.value = ''
  voiceName.value = ''
  error.value = ''
  emit('clear')
  await startRecording()
}

onBeforeUnmount(() => {
  clearTimers()
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    }
    catch {
      // ignore
    }
  }
  stopTracks()
  revokePreview()
})
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/25 p-3" aria-label="Voice recorder">
    <div class="flex flex-col gap-1.5">
      <p class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Read this aloud
      </p>
      <blockquote class="whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-background/70 px-3 py-2 text-sm leading-6 text-foreground">
        “{{ readingScript }}”
      </blockquote>
      <p class="text-xs text-muted-foreground">
        Record about 8–15 seconds (max {{ MAX_SECONDS }}s). Speak clearly at a natural pace.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        v-if="!recording && !previewUrl"
        type="button"
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="!canRecord"
        @click="startRecording"
      >
        <Mic class="size-4" />
        Record
      </Button>
      <Button
        v-else-if="recording"
        type="button"
        size="sm"
        variant="destructive"
        class="rounded-lg shadow-none"
        :disabled="disabled"
        @click="stopRecording(true)"
      >
        <Square class="size-3.5 fill-current" />
        Stop
      </Button>
      <template v-else>
        <Button
          type="button"
          size="sm"
          class="rounded-lg shadow-none"
          :disabled="disabled || uploading || !voiceUrl"
          @click="finishRecording"
        >
          Finish
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="rounded-lg shadow-none"
          :disabled="disabled || uploading"
          @click="reRecord"
        >
          <Mic class="size-4" />
          Re-record
        </Button>
      </template>

      <div v-if="recording" class="flex items-center gap-2 text-sm text-destructive" role="status">
        <span class="relative flex size-2.5">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
          <span class="relative inline-flex size-2.5 rounded-full bg-destructive" />
        </span>
        Recording {{ formatTime(elapsed) }} / {{ formatTime(MAX_SECONDS) }}
      </div>
      <p v-else-if="uploading" class="text-sm text-muted-foreground" role="status">
        Uploading recording…
      </p>
      <p v-else-if="voiceUrl" class="text-sm text-muted-foreground" role="status">
        Recording ready
      </p>
    </div>

    <audio
      v-if="previewUrl"
      :src="previewUrl"
      controls
      class="w-full"
      preload="metadata"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">
      {{ error }}
    </p>
  </section>
</template>
