<script setup lang="ts">
import type { ImageLayerHandle, ImageLayerRegion } from '~~/shared/utils/imageLayerSplitter'
import { useElementSize } from '@vueuse/core'
import { Hand, Maximize, MousePointer2, Scan, SquareDashed, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { imageLayerRegionFromPoints, transformImageLayerRegion } from '~~/shared/utils/imageLayerSplitter'

const props = defineProps<{ src: string, disabled?: boolean, fixedRegions?: boolean, hideLabels?: boolean, sidebarTitle?: string }>()
const emit = defineEmits<{ selecting: [value: boolean], pick: [], load: [], error: [] }>()
const regions = defineModel<ImageLayerRegion[]>({ default: () => [] })
const imageRef = ref<HTMLImageElement>()
const loaded = ref(false)
const viewportRef = ref<HTMLDivElement>()
const { width: viewportWidth, height: viewportHeight } = useElementSize(viewportRef)
const naturalSize = ref({ width: 1, height: 1 })
const zoom = ref(1)
const activeIndex = ref(-1)
type CanvasTool = 'draw' | 'select' | 'pan'
const activeTool = ref<CanvasTool>(props.fixedRegions ? 'select' : 'draw')
const isPanning = ref(false)
const canvasCursor = computed(() => props.disabled ? 'cursor-wait' : activeTool.value === 'draw' ? 'cursor-crosshair' : activeTool.value === 'pan' ? isPanning.value ? 'cursor-grabbing' : 'cursor-grab' : 'cursor-default')

function setTool(tool: CanvasTool) {
  cancel()
  if (props.fixedRegions && tool === 'draw')
    return
  activeTool.value = tool
}
const fittedScale = computed(() => Math.min(Math.max(1, viewportWidth.value - 32) / naturalSize.value.width, Math.max(1, viewportHeight.value - 32) / naturalSize.value.height, 1))
const imageWidth = computed(() => naturalSize.value.width * fittedScale.value * zoom.value)
const imageHeight = computed(() => naturalSize.value.height * fittedScale.value * zoom.value)

function onImageLoad() {
  naturalSize.value = { width: imageRef.value!.naturalWidth, height: imageRef.value!.naturalHeight }
  loaded.value = true
  emit('load')
}

onMounted(() => {
  if (imageRef.value?.complete && imageRef.value.naturalWidth)
    onImageLoad()
})

async function setZoom(value: number) {
  cancel()
  zoom.value = Math.min(4, Math.max(0.5, Math.round(value * 100) / 100))
  await nextTick()
  const viewport = viewportRef.value
  if (viewport)
    viewport.scrollTo((viewport.scrollWidth - viewport.clientWidth) / 2, (viewport.scrollHeight - viewport.clientHeight) / 2)
}

function selectObject(index: number) {
  setTool('select')
  activeIndex.value = index
  const box = regions.value[index]
  const viewport = viewportRef.value
  if (box && viewport) {
    const left = Math.max(16, (viewport.clientWidth - imageWidth.value) / 2)
    const top = Math.max(16, (viewport.clientHeight - imageHeight.value) / 2)
    viewport.scrollTo(left + (box[0] + box[2]) / 2000 * imageWidth.value - viewport.clientWidth / 2, top + (box[1] + box[3]) / 2000 * imageHeight.value - viewport.clientHeight / 2)
  }
}

function removeObject(index: number) {
  if (props.fixedRegions || props.disabled)
    return
  const remaining = regions.value.filter((_, i) => i !== index)
  activeIndex.value = Math.min(activeIndex.value > index ? activeIndex.value - 1 : activeIndex.value, remaining.length - 1)
  regions.value = remaining
}

const objectColors = [
  '#67e8f9',
  '#fdba74',
  '#c4b5fd',
  '#86efac',
  '#f9a8d4',
  '#fde047',
  '#93c5fd',
  '#fca5a5',
  '#5eead4',
  '#d8b4fe',
  '#bef264',
  '#fcd34d',
  '#a5b4fc',
  '#fda4af',
  '#a7f3d0',
  '#f0abfc',
]

function objectColor(index: number) {
  return objectColors[index % objectColors.length]!
}

const draft = ref<ImageLayerRegion | null>(null)
let start: { x: number, y: number } | null = null
let pointerId: number | null = null
let captureTarget: HTMLElement | null = null
let panStart: { x: number, y: number, left: number, top: number } | null = null
let editing: { index: number, box: ImageLayerRegion, origin: { x: number, y: number }, handle?: ImageLayerHandle } | null = null
const handles: { id: ImageLayerHandle, x: number, y: number, cursor: string, label: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize', label: 'top left' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize', label: 'top' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize', label: 'top right' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize', label: 'right' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize', label: 'bottom right' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize', label: 'bottom' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize', label: 'bottom left' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize', label: 'left' },
]

function beginResize(event: PointerEvent, handle: ImageLayerHandle) {
  const box = regions.value[activeIndex.value]
  if (props.disabled || !loaded.value || !box || !event.isPrimary || event.button !== 0 || pointerId !== null)
    return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  editing = { index: activeIndex.value, box: [...box], origin: point(event), handle }
  pointerId = event.pointerId
  captureTarget = target
  target.setPointerCapture(event.pointerId)
  emit('selecting', true)
}

function point(event: PointerEvent) {
  const rect = imageRef.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 1000 }
}

function begin(event: PointerEvent) {
  if (props.disabled || !loaded.value || !event.isPrimary || event.button !== 0 || pointerId !== null)
    return
  const target = event.currentTarget as HTMLElement
  event.preventDefault()
  target.focus({ preventScroll: true })
  if (activeTool.value === 'pan') {
    panStart = { x: event.clientX, y: event.clientY, left: target.scrollLeft, top: target.scrollTop }
    isPanning.value = true
  }
  else {
    const position = point(event)
    const inside = position.x >= 0 && position.x <= 1000 && position.y >= 0 && position.y <= 1000
    if (activeTool.value === 'select') {
      activeIndex.value = -1
      if (inside) {
        for (let index = regions.value.length - 1; index >= 0; index--) {
          const box = regions.value[index]!
          if (position.x >= box[0] && position.x <= box[2] && position.y >= box[1] && position.y <= box[3]) {
            activeIndex.value = index
            editing = { index, box: [...box], origin: position }
            break
          }
        }
      }
      if (!editing)
        return
      emit('selecting', true)
    }
    else {
      if (props.fixedRegions || !inside || regions.value.length >= 16)
        return
      start = position
      draft.value = imageLayerRegionFromPoints(start, start)
      emit('selecting', true)
    }
  }
  pointerId = event.pointerId
  captureTarget = target
  target.setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
  if (pointerId !== event.pointerId)
    return
  if (panStart && viewportRef.value) {
    viewportRef.value.scrollLeft = panStart.left - (event.clientX - panStart.x)
    viewportRef.value.scrollTop = panStart.top - (event.clientY - panStart.y)
  }
  else if (editing) {
    const position = point(event)
    const updated = transformImageLayerRegion(editing.box, position.x - editing.origin.x, position.y - editing.origin.y, editing.handle)
    regions.value = regions.value.map((box, index) => index === editing!.index ? updated : box)
  }
  else if (start) {
    draft.value = imageLayerRegionFromPoints(start, point(event))
  }
}

function cancel() {
  const target = captureTarget
  const capturedId = pointerId
  start = null
  pointerId = null
  captureTarget = null
  panStart = null
  editing = null
  isPanning.value = false
  draft.value = null
  emit('selecting', false)
  if (capturedId !== null && target?.hasPointerCapture(capturedId))
    target.releasePointerCapture(capturedId)
}

function finish(event: PointerEvent) {
  if (pointerId !== event.pointerId)
    return
  move(event)
  if (draft.value && draft.value[2] - draft.value[0] >= 5 && draft.value[3] - draft.value[1] >= 5) {
    activeIndex.value = regions.value.length
    regions.value = [...regions.value, draft.value]
  }
  cancel()
}

watch(() => props.disabled, (disabled) => {
  if (disabled)
    cancel()
})

onBeforeUnmount(cancel)
</script>

<template>
  <div class="grid min-w-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1fr)_240px]">
    <div class="min-w-0 bg-muted/20">
      <div class="flex h-11 items-center justify-between gap-2 border-b border-border px-3">
        <div class="flex shrink-0 items-center gap-1" role="group" aria-label="Canvas tools">
          <button v-for="tool in ([{ id: 'draw', label: 'Draw box', icon: SquareDashed }, { id: 'select', label: 'Select object', icon: MousePointer2 }, { id: 'pan', label: 'Pan canvas', icon: Hand }] as const).filter(tool => !fixedRegions || tool.id !== 'draw')" :key="tool.id" type="button" class="inline-flex size-7 items-center justify-center rounded-md border transition-colors disabled:opacity-30" :class="activeTool === tool.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'" :aria-label="tool.label" :aria-pressed="activeTool === tool.id" :title="tool.label" :disabled="!loaded || disabled" @click="setTool(tool.id)">
            <component :is="tool.icon" class="size-4" />
          </button>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30" aria-label="Zoom out" title="Zoom out" :disabled="!loaded || disabled || zoom <= 0.5" @click="setZoom(zoom - 0.25)">
            <ZoomOut class="size-4" />
          </button>
          <span class="w-10 text-center text-xs tabular-nums" aria-live="polite">{{ Math.round(zoom * 100) }}%</span>
          <button type="button" class="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30" aria-label="Zoom in" title="Zoom in" :disabled="!loaded || disabled || zoom >= 4" @click="setZoom(zoom + 0.25)">
            <ZoomIn class="size-4" />
          </button>
          <button type="button" class="ml-1 inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30" aria-label="Fit image" title="Fit image" :disabled="!loaded || disabled" @click="setZoom(1)">
            <Maximize class="size-4" />
          </button>
        </div>
      </div>
      <div
        ref="viewportRef"
        class="h-[340px] overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:h-[480px]"
        :class="src ? [canvasCursor, 'touch-none select-none'] : ''"
        :tabindex="src ? 0 : -1"
        aria-label="Scrollable image canvas"
        @pointerdown="begin"
        @pointermove="move"
        @pointerup="finish"
        @pointercancel="cancel"
        @lostpointercapture="cancel"
      >
        <button v-if="!src" type="button" class="flex size-full flex-col items-center justify-center gap-3 p-6 text-center hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" @click="emit('pick')">
          <span class="flex size-16 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/40"><Upload class="size-6 text-muted-foreground" /></span>
          <span class="text-sm font-medium">Upload an image</span>
          <span class="text-xs text-muted-foreground">JPG, PNG, WEBP, GIF or AVIF · Up to 30 MB</span>
        </button>
        <div v-else class="grid place-items-center" :style="{ width: `${Math.max(viewportWidth, imageWidth + 32)}px`, height: `${Math.max(viewportHeight, imageHeight + 32)}px` }">
          <div
            class="relative touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            :class="canvasCursor"
            :style="{ width: `${imageWidth}px`, height: `${imageHeight}px` }"
            role="group"
            aria-label="Image selection canvas"
          >
            <img ref="imageRef" :src="src" :alt="fixedRegions ? 'Image with editable text regions' : 'Image to separate into layers'" draggable="false" class="block size-full max-w-none" @load="onImageLoad" @error="loaded = false; emit('error')">
            <svg v-if="loaded" class="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <g v-for="(box, index) in [...regions, ...(draft ? [draft] : [])]" :key="index">
                <rect :x="box[0]" :y="box[1]" :width="box[2] - box[0]" :height="box[3] - box[1]" :fill="`${objectColor(index)}${index === activeIndex ? '26' : '0a'}`" stroke="#111827" stroke-width="1" vector-effect="non-scaling-stroke" />
                <rect :x="box[0]" :y="box[1]" :width="box[2] - box[0]" :height="box[3] - box[1]" fill="none" :stroke="objectColor(index)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />
              </g>
            </svg>
            <span v-for="(box, index) in (hideLabels ? [] : regions)" :key="`label-${index}`" class="pointer-events-none absolute flex size-5 items-center justify-center text-xs font-semibold text-zinc-950" :style="{ left: `${box[0] / 10}%`, top: `${box[1] / 10}%`, backgroundColor: objectColor(index) }" aria-hidden="true">{{ index + 1 }}</span>
            <template v-if="regions[activeIndex] && activeTool !== 'pan'">
              <button
                v-for="handle in handles"
                :key="handle.id"
                type="button"
                class="absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :style="{ left: `${(regions[activeIndex]![0] + (regions[activeIndex]![2] - regions[activeIndex]![0]) * handle.x) / 10}%`, top: `${(regions[activeIndex]![1] + (regions[activeIndex]![3] - regions[activeIndex]![1]) * handle.y) / 10}%`, cursor: handle.cursor }"
                :aria-label="`Resize object ${activeIndex + 1} ${handle.label}`"
                :disabled="disabled"
                @pointerdown.stop="beginResize($event, handle.id)"
                @pointermove.stop="move"
                @pointerup.stop="finish"
                @pointercancel.stop="cancel"
                @lostpointercapture.stop="cancel"
              >
                <span class="size-2.5 border border-zinc-950 bg-white" />
              </button>
            </template>
            <button
              v-if="regions[activeIndex] && !fixedRegions"
              type="button"
              class="absolute z-10 inline-flex size-6 -translate-x-full cursor-pointer items-center justify-center rounded-bl-md bg-zinc-950 text-white shadow-sm hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
              :style="{ left: `${regions[activeIndex]![2] / 10}%`, top: `${regions[activeIndex]![1] / 10}%` }"
              :aria-label="`Delete selected object ${activeIndex + 1}`"
              title="Delete object"
              :disabled="disabled"
              @pointerdown.stop
              @pointerup.stop
              @click.stop="removeObject(activeIndex)"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <slot name="sidebar" :active-index="activeIndex" :select-object="selectObject" :object-color="objectColor">
      <aside class="flex min-w-0 flex-col border-t border-border bg-card lg:border-t-0 lg:border-l" aria-label="Selected objects">
        <div class="flex h-11 items-center justify-between border-b border-border px-3">
          <h3 class="text-sm font-medium">
            {{ sidebarTitle || 'Objects' }} <span class="ml-1 text-xs text-muted-foreground" role="status">{{ regions.length }}{{ fixedRegions ? '' : '/16' }}</span>
          </h3>
        </div>
        <div v-if="!regions.length" class="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center text-muted-foreground">
          <Scan class="size-6" />
          <p class="text-xs leading-relaxed">
            Choose Draw box, then drag around an object.<br>Each selection appears here.
          </p>
        </div>
        <ol v-else class="max-h-[300px] flex-1 space-y-1 overflow-y-auto p-2 lg:max-h-[480px]">
          <li v-for="(_, index) in regions" :key="index" class="flex items-center gap-1 rounded-lg border" :class="index === activeIndex ? 'border-border bg-accent' : 'border-transparent'">
            <slot name="object" :index="index" :color="objectColor(index)" :select-object="selectObject">
              <button type="button" class="flex min-w-0 flex-1 items-center gap-3 p-2 text-left" :aria-pressed="index === activeIndex" :disabled="disabled" @click="selectObject(index)">
                <span class="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums text-zinc-950" :style="{ backgroundColor: objectColor(index) }" aria-hidden="true">{{ index + 1 }}</span>
                <span class="truncate text-sm">Object {{ index + 1 }}</span>
              </button>
            </slot>
            <button v-if="!fixedRegions" type="button" class="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" :aria-label="`Remove object ${index + 1}`" :disabled="disabled" @click="removeObject(index)">
              <Trash2 class="size-3.5" />
            </button>
          </li>
        </ol>
      </aside>
    </slot>
  </div>
</template>
