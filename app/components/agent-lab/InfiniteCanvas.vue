<script setup lang="ts">
import type { CanvasRect } from '~~/shared/types/canvas'
import type { GenerationJobPublic, GenerationJobState } from '~~/shared/types/generation'
import type { AgentImage } from '~/composables/useAgentLab'
import type { CanvasCorner, CanvasGuide, CanvasPoint } from '~/utils/infiniteCanvas'
import { isGenerationActive } from '~~/shared/types/generation'
import { assetName, matchingAgentAsset } from '~~/shared/utils/assetName'
import { isImageLayerSplitterModel } from '~~/shared/utils/imageLayerSplitter'
import { isMediaVideoUrl } from '~~/shared/utils/seedance25'
import { byCanvasOrder, CARD_CHROME_HEIGHT, CARD_HEIGHT, CARD_WIDTH, CELL_X, CELL_Y, clampZoom, findFreeRect, fitMediaRect, intersectsSelection, inViewport, isDefaultCanvasGrid, latestCanvasAsset, MAX_PLAYING_VIDEOS, MAX_VISIBLE, resizeFromCorner, snapCanvasRect, zoomAt } from '~/utils/infiniteCanvas'

const props = defineProps<{
  jobs: GenerationJobPublic[]
  images: AgentImage[]
  projectId: string
  showAttach?: boolean
  showMove?: boolean
  deletingTaskId?: string | null
  loading?: boolean
  emptyMessage?: string
}>()
const emit = defineEmits<{
  deleteMany: [ids: string[]]
  moveMany: [ids: string[]]
  delete: [id: string]
  move: [id: string]
  attach: [payload: { urls: string[], prompt: string }]
}>()
interface Asset {
  createdAt?: string
  completedAt?: string
  id: string
  taskId?: string
  url: string
  prompt: string
  name: string
  video: boolean
  cutout: boolean
  state: GenerationJobState
  error: string
  job?: GenerationJobPublic
}
const sourceAssets = computed(() => {
  const result: Asset[] = []
  const urls = new Set<string>()
  const taskIds = new Set<string>()
  for (const job of props.jobs) {
    taskIds.add(job.taskId)
    for (const [index, url] of (job.resultUrls.length ? job.resultUrls : ['']).entries()) {
      if (url)
        urls.add(url)
      const layerResult = isImageLayerSplitterModel(job.model)
      const prompt = layerResult ? '' : job.prompt
      const layerName = job.layers?.[index]?.name || (index === 0 ? 'Background' : `Layer ${index}`)
      result.push({ id: `${job.taskId}:${index}`, taskId: job.taskId, createdAt: job.createdAt, completedAt: job.completedAt, job, url, name: layerResult ? layerName : assetName({ id: `${job.taskId}:${index}`, prompt: job.prompt, name: String(job.input.asset_name || matchingAgentAsset(props.images, job.taskId, url)?.name || ''), kind: job.category === 'Video' ? 'video' : 'still', videoMode: String(job.input.videoMode || '') }), prompt, video: job.category === 'Video' || isMediaVideoUrl(url), cutout: /remove.?background|cutout/i.test(job.task), state: job.state, error: job.failMsg })
    }
  }
  for (const item of props.images) {
    const persistedId = `agent_${item.id}`.slice(0, 120)
    if ((item.url && urls.has(item.url)) || taskIds.has(persistedId) || taskIds.has(item.providerTaskId || item.id))
      continue
    result.push({ id: `${persistedId}:0`, url: item.url, name: assetName(item), prompt: item.prompt, video: item.kind === 'video', cutout: item.kind === 'cutout', state: item.status, error: item.error })
  }
  return result
})
const assets = computed(() => byCanvasOrder(sourceAssets.value))
const latestAsset = computed(() => latestCanvasAsset(sourceAssets.value))
const surface = ref<HTMLElement>()
const { width, height } = useElementSize(surface)
const { positions, camera, nextSlot, ready, loadError, markNode, markView, ensure, flush } = useCanvasLayout(props.projectId)
const selected = ref('')
const selection = ref(new Set<string>())
const selectedAssets = computed(() => assets.value.filter(asset => selection.value.has(asset.id)))
const batchIds = computed(() => [...new Set(selectedAssets.value.flatMap(asset => asset.taskId ? [asset.taskId] : []))])
const canBatchDelete = computed(() => selectedAssets.value.every(asset => asset.taskId && ['success', 'fail'].includes(asset.state)))
const exporting = ref(false)
const exportError = ref('')
const canExportSelection = computed(() => selectedAssets.value.length > 0 && selectedAssets.value.length <= 100 && selectedAssets.value.every(asset => asset.url && asset.state === 'success'))
async function exportAssets(items: Asset[], format: 'file' | 'zip') {
  if (exporting.value)
    return
  exporting.value = true
  exportError.value = ''
  try {
    const response = await $fetch.raw<Blob>('/api/media/export', {
      method: 'POST',
      body: { items: items.map(asset => ({ url: asset.url, name: asset.name })), format, name: 'canvas-export' },
      responseType: 'blob',
    })
    if (!response._data)
      throw new Error('Export returned no file')
    const disposition = response.headers.get('content-disposition') || ''
    const filename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    const url = URL.createObjectURL(response._data)
    const link = document.createElement('a')
    link.href = url
    link.download = filename ? decodeURIComponent(filename) : format === 'zip' ? 'canvas-export.zip' : items[0]?.name || 'Asset'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  catch (error) {
    const data = (error as { data?: Blob | { statusMessage?: string } }).data
    if (data instanceof Blob) {
      const detail = await data.text().then(text => JSON.parse(text)).catch(() => null)
      exportError.value = detail?.statusMessage || 'Export failed. Please try again.'
    }
    else {
      exportError.value = data?.statusMessage || (error instanceof Error ? error.message : 'Export failed. Please try again.')
    }
  }
  finally {
    exporting.value = false
  }
}

const marquee = ref<{ x: number, y: number, endX: number, endY: number, pointer: number, base: Set<string> }>()
const marqueeStyle = computed(() => marquee.value
  ? {
      left: `${Math.min(marquee.value.x, marquee.value.endX)}px`,
      top: `${Math.min(marquee.value.y, marquee.value.endY)}px`,
      width: `${Math.abs(marquee.value.x - marquee.value.endX)}px`,
      height: `${Math.abs(marquee.value.y - marquee.value.endY)}px`,
    }
  : {})
watch(selected, (id) => {
  if (id)
    selection.value = new Set([id])
})
watch(assets, (values) => { selection.value = new Set([...selection.value].filter(id => values.some(asset => asset.id === id))) })
const hand = ref(false)
const space = ref(false)
const interacting = ref(false)
const alignmentGuides = ref<CanvasGuide[]>([])
const visibility = useDocumentVisibility()
const { open } = useMediaLightbox()
const urlPositions = new Map<string, CanvasRect>()
let frame = 0
let pendingMove: { x: number, y: number } | undefined
let drag: { pointer: number, x: number, y: number, origin: CanvasPoint, id?: string } | undefined
let observerReady = false
let resize: { id: string, pointer: number, corner: CanvasCorner, x: number, y: number, origin: CanvasRect } | undefined
const corners: CanvasCorner[] = ['nw', 'ne', 'sw', 'se']
const cornerLabels = { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' }
let wheelTimer: ReturnType<typeof setTimeout> | undefined
const pointers = new Map<number, CanvasPoint>()
let pinch: { distance: number, center: CanvasPoint, camera: typeof camera } | undefined

function persist() { markView() }

async function loadLayout() {
  const ids = assets.value.map(asset => asset.id)
  if (await ensure(ids)) {
    const currentIds = assets.value.map(asset => asset.id)
    if (ids.length === currentIds.length && ids.every((id, index) => id === currentIds[index]))
      reconcile()
  }
}

function reconcile() {
  if (!ready.value)
    return
  const added: string[] = []
  const next = new Map(positions.value)
  const occupied = assets.value.flatMap((asset) => {
    const rect = next.get(asset.id)
    return rect ? [rect] : []
  })
  // Repair the old name-sorted grid only when every card is already loaded and
  // creation dates establish the order. Never include newly arriving cards in
  // this repair, or infer chronology from random IDs on legacy assets.
  if (occupied.length === assets.value.length && isDefaultCanvasGrid(occupied)
    && assets.value.every(asset => Number.isFinite(Date.parse(asset.createdAt || '')))) {
    for (const [index, asset] of assets.value.entries()) {
      const rect = next.get(asset.id)!
      const x = index % 5 * CELL_X
      const y = Math.floor(index / 5) * CELL_Y
      if (rect.x !== x || rect.y !== y) {
        next.set(asset.id, { ...rect, x, y })
        added.push(asset.id)
      }
    }
  }
  // Each newly arriving group starts below existing content. Never reflow saved
  // cards when source ordering, names, or generation states change.
  const startY = occupied.reduce((bottom, rect) => Math.max(bottom, Math.ceil((rect.y + rect.height + 70) / CELL_Y) * CELL_Y), Math.ceil(nextSlot.value / 5) * CELL_Y)
  let inserted = 0
  for (const asset of assets.value) {
    if (!next.has(asset.id)) {
      const existing = asset.url ? urlPositions.get(asset.url) : undefined
      const rect = findFreeRect(existing || { x: (inserted % 5) * CELL_X, y: startY + Math.floor(inserted / 5) * CELL_Y, width: CARD_WIDTH, height: CARD_HEIGHT }, occupied)
      next.set(asset.id, rect)
      occupied.push(rect)
      added.push(asset.id)
      if (!existing) {
        inserted++
        nextSlot.value = Math.max(nextSlot.value, startY / CELL_Y * 5 + inserted)
      }
    }
  }
  // Bound retained layouts across history windows, without dropping any server results.
  if (next.size > 1000) {
    const active = new Set(assets.value.map(item => item.id))
    for (const id of next.keys()) {
      if (next.size <= 1000)
        break
      if (!active.has(id))
        next.delete(id)
    }
  }
  positions.value = next
  for (const id of added)
    markNode(id)
  if (added.length)
    markView()
  urlPositions.clear()
  for (const asset of assets.value) {
    if (asset.url)
      urlPositions.set(asset.url, next.get(asset.id)!)
  }
}
watch(() => JSON.stringify(assets.value.map(item => [item.id, item.name])), async () => {
  if (observerReady)
    await loadLayout()
})
function fitAsset(id: string, size: { width: number, height: number }) {
  const rect = positions.value.get(id)
  if (!rect)
    return
  let fitted = fitMediaRect(rect, size.width, size.height)
  if (Math.abs(fitted.height - rect.height) < 0.01)
    return
  if (fitted.height > rect.height) {
    const occupied = assets.value.flatMap((asset) => {
      const other = asset.id !== id ? positions.value.get(asset.id) : undefined
      return other ? [other] : []
    })
    fitted = findFreeRect(fitted, occupied)
  }
  positions.value = new Map(positions.value).set(id, fitted)
  const asset = assets.value.find(item => item.id === id)
  if (asset?.url)
    urlPositions.set(asset.url, fitted)
  markNode(id)
}

function toolbarPosition(point: CanvasRect) {
  const center = (point.x + point.width / 2) * camera.zoom + camera.x
  const top = point.y * camera.zoom + camera.y
  const bottom = (point.y + point.height) * camera.zoom + camera.y
  const toolbarWidth = Math.min(360, Math.max(0, width.value - 24))
  return {
    width: `${toolbarWidth}px`,
    left: `${Math.max(toolbarWidth / 2 + 12, Math.min(width.value - toolbarWidth / 2 - 12, center))}px`,
    top: `${Math.max(48, Math.min(height.value - 144, top >= 132 ? top - 88 : bottom + 16))}px`,
  }
}

function focusAsset(id: string) {
  const point = positions.value.get(id)
  if (!point)
    return
  selected.value = id
  Object.assign(camera, { x: width.value / 2 - (point.x + point.width / 2) * 0.85, y: height.value / 2 - (point.y + point.height / 2) * 0.85, zoom: 0.85 })
  persist()
}
async function focusMedia(url: string) {
  const asset = assets.value.find(item => item.url === url)
  if (!asset)
    return false
  if (!positions.value.has(asset.id))
    await loadLayout()
  if (!positions.value.has(asset.id))
    return false
  focusAsset(asset.id)
  return true
}
defineExpose({ focusMedia })
onMounted(async () => {
  observerReady = true
  await loadLayout()
})
const visible = computed(() => {
  const result = []
  for (const asset of assets.value) {
    const point = positions.value.get(asset.id)
    if (point && inViewport(point, camera, width.value, height.value)) {
      result.push({ ...asset, point })
      if (result.length >= MAX_VISIBLE)
        break
    }
  }
  return result
})
const labelSize = computed(() => `${14 / Math.min(camera.zoom, 1)}px`)
const selectionWidth = computed(() => `${2 / Math.min(camera.zoom, 1)}px`)
const playingVideos = computed(() => {
  if (interacting.value || visibility.value === 'hidden' || camera.zoom < 0.35)
    return new Set<string>()
  const center = { x: (width.value / 2 - camera.x) / camera.zoom, y: (height.value / 2 - camera.y) / camera.zoom }
  return new Set(visible.value.filter(item => item.video && item.url && item.state === 'success')
    .sort((a, b) => (a.id === selected.value ? -1 : b.id === selected.value ? 1 : Math.hypot(a.point.x - center.x, a.point.y - center.y) - Math.hypot(b.point.x - center.x, b.point.y - center.y)))
    .slice(0, MAX_PLAYING_VIDEOS)
    .map(item => item.id))
})
function zoom(value: number, point = { x: width.value / 2, y: height.value / 2 }) {
  Object.assign(camera, zoomAt(camera, point, value))
  persist()
}
function fit() {
  if (!assets.value.length) {
    Object.assign(camera, { x: 40, y: 50, zoom: 0.85 })
    return
  }
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const item of assets.value) {
    const point = positions.value.get(item.id)
    if (!point)
      continue
    left = Math.min(left, point.x); top = Math.min(top, point.y)
    right = Math.max(right, point.x + point.width); bottom = Math.max(bottom, point.y + point.height)
  }
  if (!Number.isFinite(left))
    return
  const scale = clampZoom(Math.min((width.value - 80) / (right - left), (height.value - 100) / (bottom - top), 1))
  Object.assign(camera, { x: (width.value - (right - left) * scale) / 2 - left * scale, y: (height.value - (bottom - top) * scale) / 2 - top * scale, zoom: scale })
  persist()
}
function arrange() {
  let x = 0
  let y = 0
  let rowHeight = 0
  const next = new Map(positions.value)
  for (const [index, item] of assets.value.entries()) {
    const rect = positions.value.get(item.id)
    if (!rect)
      continue
    if (index > 0 && index % 5 === 0) {
      x = 0
      y += rowHeight + 40
      rowHeight = 0
    }
    next.set(item.id, { ...rect, x, y })
    x += rect.width + 40
    rowHeight = Math.max(rowHeight, rect.height)
  }
  positions.value = next
  for (const item of assets.value)
    markNode(item.id)
  nextSlot.value = assets.value.length
  fit()
}
function down(event: PointerEvent, id?: string) {
  if (!ready.value || loadError.value)
    return
  if (event.button !== 0 && event.button !== 1)
    return
  const target = event.target as HTMLElement
  if (target.closest('button, a'))
    return
  event.preventDefault()
  alignmentGuides.value = []
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    marquee.value = undefined
    const [a, b] = [...pointers.values()] as [CanvasPoint, CanvasPoint]
    const rect = surface.value!.getBoundingClientRect()
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), center: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, camera: { ...camera } }
    surface.value?.setPointerCapture(event.pointerId)
    drag = undefined
    return
  }
  surface.value?.focus()
  surface.value?.setPointerCapture(event.pointerId)
  if (!hand.value && !space.value && event.button === 0) {
    if (!id) {
      const rect = surface.value!.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      marquee.value = { x, y, endX: x, endY: y, pointer: event.pointerId, base: event.shiftKey ? new Set(selection.value) : new Set() }
      selection.value = new Set(marquee.value.base)
      selected.value = ''
      return
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      const next = new Set(selection.value)
      if (next.has(id))
        next.delete(id)
      else next.add(id)
      selected.value = ''
      selection.value = next
      return
    }
    selection.value = new Set([id])
  }
  const nodeId = !hand.value && !space.value && event.button === 0 ? id : undefined
  selected.value = nodeId || ''
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: nodeId ? { ...positions.value.get(nodeId)! } : { x: camera.x, y: camera.y }, id: nodeId }
}
function startResize(event: PointerEvent, id: string, corner: CanvasCorner) {
  if (event.button !== 0 || !ready.value || loadError.value)
    return
  event.preventDefault()
  selected.value = id
  alignmentGuides.value = []
  drag = undefined
  pinch = undefined
  pointers.clear()
  surface.value?.setPointerCapture(event.pointerId)
  resize = { id, pointer: event.pointerId, corner, x: event.clientX, y: event.clientY, origin: { ...positions.value.get(id)! } }
}
function resizeKey(event: KeyboardEvent, id: string, corner: CanvasCorner) {
  const shifts: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }
  const shift = shifts[event.key]
  if (!shift)
    return
  event.preventDefault()
  event.stopPropagation()
  positions.value = new Map(positions.value).set(id, resizeFromCorner(positions.value.get(id)!, corner, ...shift))
  markNode(id)
}
function applyMove() {
  frame = 0
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [CanvasPoint, CanvasPoint]
    const rect = surface.value!.getBoundingClientRect()
    const next = zoomAt(pinch.camera, pinch.center, pinch.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)
    next.x += (a.x + b.x) / 2 - rect.left - pinch.center.x
    next.y += (a.y + b.y) / 2 - rect.top - pinch.center.y
    Object.assign(camera, next)
    interacting.value = true
    return
  }
  if (resize && pendingMove) {
    const rect = resizeFromCorner(resize.origin, resize.corner, (pendingMove.x - resize.x) / camera.zoom, (pendingMove.y - resize.y) / camera.zoom)
    positions.value = new Map(positions.value).set(resize.id, rect)
    interacting.value = true
    return
  }
  if (!drag || !pendingMove)
    return
  const dx = pendingMove.x - drag.x
  const dy = pendingMove.y - drag.y
  if (Math.abs(dx) + Math.abs(dy) < 3 && !interacting.value)
    return
  interacting.value = true
  if (drag.id) {
    const proposed = { ...positions.value.get(drag.id)!, x: drag.origin.x + dx / camera.zoom, y: drag.origin.y + dy / camera.zoom }
    const targets = visible.value.filter(asset => asset.id !== drag!.id).map(asset => asset.point)
    const snapped = snapCanvasRect(proposed, targets, camera.zoom)
    const point = snapped.rect
    alignmentGuides.value = snapped.guides
    const updated = new Map(positions.value)
    // Recently moved coordinates win when the layout storage budget is reached.
    updated.delete(drag.id)
    updated.set(drag.id, point)
    positions.value = updated
    const asset = assets.value.find(item => item.id === drag!.id)
    if (asset?.url)
      urlPositions.set(asset.url, point)
  }
  else {
    camera.x = drag.origin.x + dx
    camera.y = drag.origin.y + dy
  }
}
function move(event: PointerEvent) {
  if (marquee.value?.pointer === event.pointerId) {
    const rect = surface.value!.getBoundingClientRect()
    marquee.value.endX = event.clientX - rect.left
    marquee.value.endY = event.clientY - rect.top
    const box = marquee.value
    const next = new Set(box.base)
    for (const asset of assets.value) {
      const point = positions.value.get(asset.id)
      if (!point)
        continue
      if (intersectsSelection(point, camera, box))
        next.add(asset.id)
    }
    selection.value = next
    return
  }
  if (pointers.has(event.pointerId))
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pinch) {
    if (!frame)
      frame = requestAnimationFrame(applyMove)
    return
  }
  if ((!drag || drag.pointer !== event.pointerId) && (!resize || resize.pointer !== event.pointerId))
    return
  pendingMove = { x: event.clientX, y: event.clientY }
  if (!frame)
    frame = requestAnimationFrame(applyMove)
}
function end() {
  if (frame)
    cancelAnimationFrame(frame)
  applyMove()
  const changedId = resize?.id || drag?.id
  if (changedId && interacting.value)
    markNode(changedId)
  const pointer = marquee.value?.pointer ?? resize?.pointer ?? drag?.pointer
  marquee.value = undefined
  resize = undefined
  pinch = undefined
  pointers.clear()
  if (pointer !== undefined && surface.value?.hasPointerCapture(pointer))
    surface.value.releasePointerCapture(pointer)
  drag = undefined
  pendingMove = undefined
  alignmentGuides.value = []
  interacting.value = false
  if (observerReady)
    persist()
}
function wheel(event: WheelEvent) {
  interacting.value = true
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => { interacting.value = false }, 160)
  if (event.ctrlKey || event.metaKey) {
    const rect = surface.value!.getBoundingClientRect()
    zoom(camera.zoom * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  else {
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height.value : 1
    camera.x -= event.deltaX * factor
    camera.y -= event.deltaY * factor
    persist()
  }
}
function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('button, input, a'))
    return
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Equal', 'Minus', 'Digit0'].includes(event.code))
    event.preventDefault()
  if (event.code === 'Space')
    space.value = true
  if (event.code === 'Equal')
    zoom(camera.zoom * 1.2)
  if (event.code === 'Minus')
    zoom(camera.zoom / 1.2)
  if (event.code === 'Digit0')
    fit()
  if (event.code === 'Escape') {
    selected.value = ''
    selection.value = new Set()
    end()
  }
  const shifts: Record<string, CanvasPoint> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } }
  const shift = shifts[event.code]
  if (shift) {
    camera.x += shift.x
    camera.y += shift.y
    persist()
  }
}
const detailAsset = shallowRef<Asset | null>(null)
const detailJob = computed<GenerationJobPublic | null>(() => {
  const asset = detailAsset.value
  if (!asset)
    return null
  const job = props.jobs.find(item => item.taskId === asset.taskId) || asset.job
  if (job)
    return { ...job, input: { prompt: job.prompt, ...job.input } }
  const source = props.images.find(item => `${`agent_${item.id}`.slice(0, 120)}:0` === asset.id)
  return {
    taskId: asset.id,
    projectId: props.projectId,
    model: '',
    category: asset.video ? 'Video' : 'Image',
    task: source?.kind || '',
    prompt: source?.prompt || asset.prompt,
    input: { prompt: source?.prompt || asset.prompt, aspect_ratio: source?.aspectRatio, resolution: source?.resolution, duration: source?.duration },
    state: source?.status || 'generating',
    resultUrls: asset.url ? [asset.url] : [],
    failMsg: source?.error || asset.error,
    failCode: '',
    createdAt: '',
    updatedAt: '',
    completedAt: '',

  }
})
function view(asset: Asset) {
  if (asset.url && asset.state === 'success')
    open({ url: asset.url, kind: asset.video ? 'video' : 'image', alt: asset.prompt || asset.name, cutout: asset.cutout })
}
onBeforeUnmount(() => {
  clearTimeout(wheelTimer)
  cancelAnimationFrame(frame)
  end()
  void flush(true)
})
</script>

<template>
  <div class="canvas-shell relative isolate z-0 h-full min-h-0 flex-1 overflow-hidden bg-muted/25">
    <div
      ref="surface" tabindex="0" role="region" aria-label="Infinite canvas. Drag empty space to select, Shift-click to add selections. Hold Space to pan, drag cards to move. Control or Command scroll to zoom. Press 0 to fit."
      class="canvas-surface absolute inset-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :class="hand || space || interacting ? 'cursor-grabbing' : 'cursor-grab'"
      :style="{ backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }"
      @pointerdown="down($event)" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end"
      @wheel.prevent="wheel" @keydown="keydown" @keyup="space = false" @blur="space = false"
    >
      <div class="absolute origin-top-left" :style="{ 'transform': `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, '--canvas-selection-width': selectionWidth }">
        <article
          v-for="asset in visible" :key="asset.id"
          class="absolute rounded-xl border"
          :class="[
            asset.url && asset.state === 'success' && !asset.video ? 'bg-transparent' : 'bg-card shadow-sm',
            asset.state === 'fail' ? 'border-destructive' : selection.has(asset.id) ? 'border-ring' : isGenerationActive(asset.state) ? 'border-primary/70' : 'border-border',
            selection.has(asset.id) && 'canvas-selected',
          ]"
          :style="{ 'transform': `translate(${asset.point.x}px, ${asset.point.y}px)`, 'width': `${asset.point.width}px`, 'height': `${asset.point.height}px`, 'contain': 'layout style', '--canvas-label-size': labelSize, 'zIndex': selected === asset.id ? 10 : 0 }"
          @pointerdown.stop="down($event, asset.id)" @dblclick="view(asset)"
        >
          <p
            class="pointer-events-none absolute bottom-full left-0 w-full truncate font-medium leading-snug text-foreground"
            :style="{ fontSize: labelSize, paddingBottom: `${6 / camera.zoom}px` }"
            :title="asset.name"
          >
            {{ asset.name }}
          </p>
          <div class="flex items-center justify-center overflow-hidden rounded-xl" :style="{ height: `${asset.point.height - CARD_CHROME_HEIGHT}px` }" :class="asset.url && asset.state === 'success' && !asset.video ? 'bg-transparent' : 'bg-muted/40'">
            <AgentLabInfiniteCanvasMedia
              v-if="asset.url && asset.state === 'success'"
              :key="asset.url"
              :url="asset.url"
              :alt="(asset.prompt || asset.name).slice(0, 300)"
              :video="asset.video"
              :playing="playingVideos.has(asset.id)"
              @dimensions="fitAsset(asset.id, $event)"
            />
            <div v-else class="flex w-full min-w-0 flex-col items-center gap-3 px-3 text-center text-muted-foreground" :style="{ fontSize: labelSize }">
              <Icon :name="asset.video ? 'i-lucide-play' : asset.state === 'fail' ? 'i-lucide-triangle-alert' : 'i-lucide-image'" class="shrink-0" :style="{ width: `${20 / Math.min(camera.zoom, 1)}px`, height: `${20 / Math.min(camera.zoom, 1)}px` }" />
              <p class="w-full truncate" :title="asset.name">
                {{ asset.name }}
              </p>
              <p v-if="asset.state !== 'success'" class="line-clamp-3">
                {{ asset.state === 'fail' ? asset.error || 'Generation failed' : 'Generating…' }}
              </p>
            </div>
          </div>
          <AgentLabCardBorder v-if="isGenerationActive(asset.state)" tone="generating" class="z-10" />
          <template v-if="selection.size === 1 && selection.has(asset.id)">
            <button
              v-for="corner in corners" :key="corner"
              class="canvas-resize" :class="`canvas-resize-${corner}`"
              :aria-label="`Resize ${cornerLabels[corner]}`" :title="`Resize ${cornerLabels[corner]}`"
              :style="{ width: `${14 / camera.zoom}px`, height: `${14 / camera.zoom}px`, borderWidth: `${1.5 / camera.zoom}px` }"
              @pointerdown.stop="startResize($event, asset.id, corner)" @dblclick.stop
              @keydown="resizeKey($event, asset.id, corner)"
            />
          </template>
        </article>
      </div>
      <svg v-if="alignmentGuides.length" class="pointer-events-none absolute inset-0 z-20 size-full overflow-visible text-sky-400" aria-hidden="true">
        <line
          v-for="(guide, index) in alignmentGuides" :key="index"
          :x1="(guide.axis === 'x' ? guide.position : guide.start) * camera.zoom + camera.x"
          :y1="(guide.axis === 'y' ? guide.position : guide.start) * camera.zoom + camera.y"
          :x2="(guide.axis === 'x' ? guide.position : guide.end) * camera.zoom + camera.x"
          :y2="(guide.axis === 'y' ? guide.position : guide.end) * camera.zoom + camera.y"
          stroke="currentColor" stroke-width="1" stroke-dasharray="4 3"
        />
      </svg>
    </div>
    <div
      v-for="asset in visible.filter(item => selection.size === 1 && selection.has(item.id))" :key="`toolbar-${asset.id}`"
      role="toolbar" aria-label="Selected media actions"
      :style="toolbarPosition(asset.point)"
      class="absolute z-30 flex -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
      @pointerdown.stop @dblclick.stop
    >
      <p class="line-clamp-2 max-w-80 text-xs" :title="asset.name">
        {{ asset.name.replace(/^(Image|Video) · /, '') }}
      </p>
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span>{{ asset.video ? 'VIDEO' : 'IMAGE' }}</span>
        <div class="flex gap-1">
          <button class="canvas-action" aria-label="View details" title="View details" @click="detailAsset = asset">
            <Icon name="i-lucide-info" />
          </button>
          <button v-if="asset.url && asset.state === 'success'" class="canvas-action" aria-label="Open result" @click="view(asset)">
            <Icon name="i-lucide-maximize-2" />
          </button>
          <button v-if="asset.url && asset.state === 'success'" class="canvas-action" aria-label="Export original file" :title="exporting ? 'Exporting…' : 'Export original file'" :disabled="exporting" @click="exportAssets([asset], 'file')">
            <Icon :name="exporting ? 'i-lucide-loader-circle' : 'i-lucide-download'" :class="{ 'animate-spin': exporting }" />
          </button>
          <button v-if="showAttach && asset.url && !asset.video && asset.state === 'success'" class="canvas-action" aria-label="Use as reference" @click="emit('attach', { urls: [asset.url], prompt: asset.prompt })">
            <Icon name="i-lucide-paperclip" />
          </button>
          <button v-if="showMove && asset.taskId" class="canvas-action" aria-label="Move to project" @click="emit('move', asset.taskId)">
            <Icon name="i-lucide-folder" />
          </button>
          <button v-if="asset.taskId && ['success', 'fail'].includes(asset.state)" class="canvas-action" aria-label="Delete result" :disabled="deletingTaskId === asset.taskId" @click="emit('delete', asset.taskId)">
            <Icon name="i-lucide-trash-2" />
          </button>
        </div>
      </div>
    </div>
    <div v-if="marquee" class="pointer-events-none absolute z-20 border border-blue-500 bg-blue-500/10" :style="marqueeStyle" />
    <div v-if="selection.size > 1" role="toolbar" aria-label="Selected media bulk actions" class="absolute top-3 right-3 z-30 flex items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg" @pointerdown.stop>
      <span class="text-xs text-muted-foreground">{{ selection.size }} selected</span>
      <button class="canvas-action" aria-label="Export selected as ZIP" :title="exporting ? 'Exporting…' : 'Export selected as ZIP (up to 100 files)'" :disabled="exporting || !canExportSelection" @click="exportAssets(selectedAssets, 'zip')">
        <Icon :name="exporting ? 'i-lucide-loader-circle' : 'i-lucide-download'" :class="{ 'animate-spin': exporting }" />
      </button>
      <button class="canvas-action" aria-label="Move selected to project" :disabled="!showMove || batchIds.length === 0 || selectedAssets.some(asset => !asset.taskId)" @click="emit('moveMany', batchIds)">
        <Icon name="i-lucide-folder" />
      </button>
      <button class="canvas-action" aria-label="Delete selected results" :disabled="!canBatchDelete" @click="emit('deleteMany', batchIds)">
        <Icon name="i-lucide-trash-2" />
      </button>
    </div>
    <div v-if="exporting || exportError" class="absolute top-16 right-3 z-30 flex max-w-sm items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg" :role="exportError ? 'alert' : 'status'" @pointerdown.stop>
      <span>{{ exportError || 'Preparing download…' }}</span>
      <button v-if="exportError" class="canvas-action shrink-0" aria-label="Dismiss export error" @click="exportError = ''">
        <Icon name="i-lucide-x" />
      </button>
    </div>
    <div v-if="!ready || loadError" class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm" role="status">
      <span>{{ loadError ? 'Could not load canvas layout.' : 'Loading canvas layout…' }}</span>
      <button v-if="loadError" class="rounded border px-4 py-2" @click="loadLayout">
        Retry
      </button>
    </div>
    <AiGeneratorJobDetailDialog v-if="detailAsset" :open="Boolean(detailAsset)" :job="detailJob" @update:open="!$event && (detailAsset = null)" />
    <div v-if="!assets.length" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Icon name="i-lucide-scan" class="size-10" />
      <p class="text-sm">
        {{ loading ? 'Loading your canvas…' : emptyMessage || 'Your ideas start here' }}
      </p>
      <p class="text-xs">
        {{ loading || emptyMessage ? '' : 'Agent results appear on this canvas automatically.' }}
      </p>
    </div>
    <div class="pointer-events-none absolute inset-0 z-10">
      <div class="pointer-events-auto absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{{ assets.length }} assets</span>
        <button v-if="latestAsset" class="ml-2 text-foreground hover:underline" @click="focusAsset(latestAsset.id)">
          Find latest
        </button>
      </div>
      <div class="pointer-events-auto absolute right-3 bottom-3 left-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1">
          <button class="canvas-tool" :class="!hand ? 'bg-accent' : ''" aria-label="Select and move objects" :aria-pressed="!hand" @click="hand = false">
            <Icon name="i-lucide-mouse-pointer-2" />
          </button>
          <button class="canvas-tool" :class="hand ? 'bg-accent' : ''" aria-label="Pan canvas" :aria-pressed="hand" @click="hand = true">
            <Icon name="i-lucide-hand" />
          </button>
          <button class="canvas-tool" aria-label="Arrange objects by creation order" title="Arrange: oldest first, newest last" @click="arrange">
            <Icon name="i-lucide-layout-grid" />
          </button>
        </div>
        <div class="flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1">
          <button class="canvas-tool" aria-label="Zoom out" @click="zoom(camera.zoom / 1.2)">
            <Icon name="i-lucide-minus" />
          </button>
          <button class="min-w-12 text-xs tabular-nums" aria-label="Reset zoom to 100 percent" @click="zoom(1)">
            {{ Math.round(camera.zoom * 100) }}%
          </button>
          <button class="canvas-tool" aria-label="Zoom in" @click="zoom(camera.zoom * 1.2)">
            <Icon name="i-lucide-plus" />
          </button>
          <button class="canvas-tool" aria-label="Fit all objects" title="Fit all · 0" @click="fit">
            <Icon name="i-lucide-scan" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-shell { position: relative; isolation: isolate; overflow: hidden; }
.canvas-resize { position: absolute; z-index: 5; padding: 0; border-style: solid; border-color: var(--ring); background: var(--background); touch-action: none; }
.canvas-resize-nw { left: 0; top: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
.canvas-resize-ne { right: 0; top: 0; transform: translate(50%, -50%); cursor: nesw-resize; }
.canvas-resize-sw { left: 0; bottom: 0; transform: translate(-50%, 50%); cursor: nesw-resize; }
.canvas-resize-se { right: 0; bottom: 0; transform: translate(50%, 50%); cursor: nwse-resize; }
.canvas-selected { outline: var(--canvas-selection-width) solid var(--ring); }
.canvas-resize:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.canvas-surface { touch-action: none; user-select: none; background-image: radial-gradient(circle, var(--border) 1px, transparent 1px); }
.canvas-tool { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; }
.canvas-action:disabled { opacity: 0.35; cursor: not-allowed; }
.canvas-action { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; }
.canvas-tool:hover, .canvas-action:hover { background: var(--accent); color: var(--foreground); }
.canvas-tool:focus-visible, .canvas-action:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
