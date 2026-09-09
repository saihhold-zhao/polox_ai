<script setup lang="ts">
import type { AgentHistoryImage, AgentHistoryPage } from '~~/shared/types/agentHistory'
import type { AgentImage, ConfirmationPayload } from '~/composables/useAgentLab'
import { messageMedia } from '~/utils/agentMessageMedia'
import { presentAgentResults } from '~/utils/agentResultPresentation'

const props = defineProps<{
  endpoint: string
  beforeId?: string
  scrollContainer?: HTMLElement | null
  embedded?: boolean
  excludeIds?: string[]
}>()
const page = shallowRef<AgentHistoryPage | null>(null)
const loading = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)
let controller: AbortController | undefined
let epoch = 0
let positioning = false
let previousTop = 0
const visitedCursors = new Set<string>()
let retryDirection: 'initial' | 'older' = 'initial'

const savedMessages = computed(() => (page.value?.messages || []).filter(message => !props.excludeIds?.some(id => id.replace(/^ui:/, '') === message.id.replace(/^ui:/, ''))).map((message) => {
  const card = message.confirmation
  const params = card?.params as ConfirmationPayload['params'] | undefined
  const confirmation = card && typeof card.id === 'string' && params && typeof params.prompt === 'string'
    ? card as unknown as ConfirmationPayload
    : null
  const state = message.confirmationState
  return {
    ...message,
    confirmation,
    cardState: (state === 'confirmed' || state === 'cancelled' || state === 'blocked' ? state : 'pending') as 'pending' | 'confirmed' | 'cancelled' | 'blocked',
    resolvedParams: message.resolvedParams as ConfirmationPayload['params'] | undefined,
  }
}))

const historyMessages = computed(() => {
  const saved = new Map(savedMessages.value.map(message => [message.id, message]))
  return presentAgentResults(savedMessages.value.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    kind: message.kind === 'error' ? 'error' as const : undefined,
    imageIds: message.imageIds,
    confirmation: message.confirmation || undefined,
    confirmationState: message.confirmation || message.confirmationState ? message.cardState : undefined,
    resolvedParams: message.resolvedParams,
  })), thumbsFor).map(message => ({ ...saved.get(message.id), ...message, cardState: message.confirmationState }))
})

function thumbsFor(message: { content: string, imageIds?: string[], media?: AgentImage[] }) {
  if (message.media)
    return message.media
  return messageMedia<AgentHistoryImage>(message, page.value?.images || []).map(image => ({
    ...image,
    kind: ['still', 'cutout', 'video', 'upload'].includes(image.kind) ? image.kind : 'still',
  } as AgentImage))
}

async function load(direction: 'initial' | 'older' = 'older') {
  if (!page.value)
    direction = 'initial'
  if (loading.value)
    return
  const cursor = page.value?.olderCursor
  if (direction !== 'initial' && !cursor)
    return
  retryDirection = direction
  const token = ++epoch
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const next = await $fetch<AgentHistoryPage>(props.endpoint, {
      signal: controller.signal,
      query: direction === 'older' ? { before: cursor } : { beforeId: props.beforeId },
    })
    if (token !== epoch)
      return
    if (cursor)
      visitedCursors.add(cursor)
    if (!next.messages.length || (next.olderCursor && visitedCursors.has(next.olderCursor)))
      next.olderCursor = null
    const node = props.scrollContainer || scroller.value
    const height = node?.scrollHeight || 0
    const top = node?.scrollTop || 0
    const current = page.value
    page.value = current
      ? {
          ...next,
          messages: [...next.messages.filter(message => !current.messages.some(item => item.id === message.id)), ...current.messages],
          images: [...new Map([...next.images, ...current.images].map(image => [image.id, image])).values()],
          newerCursor: current.newerCursor,
        }
      : next
    positioning = true
    await nextTick()
    if (token !== epoch)
      return
    if (node) {
      node.scrollTop = direction === 'initial' && !props.embedded ? node.scrollHeight : top + node.scrollHeight - height
      previousTop = node.scrollTop
    }
    requestAnimationFrame(() => { positioning = false })
  }
  catch (cause) {
    if (token === epoch && !controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : 'Could not load history'
  }
  finally {
    if (token === epoch)
      loading.value = false
  }
}

function onScroll() {
  const node = scroller.value
  if (props.embedded || !node || loading.value || positioning)
    return
  const upwards = node.scrollTop < previousTop
  previousTop = node.scrollTop
  if (upwards && node.scrollTop <= 24)
    void load('older')
}

function onWheel(event: WheelEvent) {
  if (!props.embedded && event.deltaY < 0 && scroller.value && scroller.value.scrollTop <= 0 && !positioning)
    void load('older')
}

let touchY = 0
function onTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY || 0
}
function onTouchMove(event: TouchEvent) {
  const nextY = event.touches[0]?.clientY || 0
  if (!props.embedded && nextY > touchY && scroller.value && scroller.value.scrollTop <= 24 && !positioning)
    void load('older')
  touchY = nextY
}

watch(() => props.endpoint, () => {
  epoch++
  controller?.abort()
  page.value = null
  visitedCursors.clear()
  loading.value = false
  if (import.meta.client && !props.embedded)
    void load()
}, { immediate: true })
onBeforeUnmount(() => {
  epoch++
  controller?.abort()
})
defineExpose({ load })
</script>

<template>
  <section :class="embedded ? 'shrink-0' : 'flex min-h-0 flex-1 flex-col'" aria-label="Saved chat history" :aria-busy="loading">
    <div v-if="error" class="px-4 py-2 text-sm text-destructive" role="alert">
      {{ error }}
      <button type="button" class="ml-2 underline" :disabled="loading" @click="load(retryDirection)">
        Retry
      </button>
    </div>
    <div ref="scroller" :class="embedded ? '' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-anchor:none]'" @scroll="onScroll" @wheel="onWheel" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove">
      <div class="flex flex-col gap-2" :class="embedded ? 'pb-2' : ''">
        <AgentLabMessage
          v-for="message in historyMessages"
          :key="message.id"
          :message="message"
          :images="thumbsFor(message)"
          lazy
        >
          <template v-if="message.confirmation || message.confirmationState || message.confirmationReason || message.choiceState || message.choiceAnswers?.length" #default>
            <AgentLabConfirmCard
              v-if="message.confirmation"
              :confirmation="message.confirmation"
              :state="message.cardState"
              :resolved-params="message.resolvedParams"
              read-only
            />
            <p v-else-if="message.confirmationState || message.confirmationReason" class="mt-2 text-xs text-muted-foreground">
              {{ message.confirmationState }} {{ message.confirmationReason }}
            </p>
            <p v-if="message.choiceState" class="mt-2 text-xs text-muted-foreground">
              {{ message.choiceState }}
            </p>
            <p v-for="(answer, index) in message.choiceAnswers || []" :key="index" class="mt-1 text-sm">
              {{ answer.label || answer.text || answer.optionId || (answer.skipped ? 'Skipped' : '') }}
            </p>
          </template>
        </AgentLabMessage>
      </div>
    </div>
  </section>
</template>
