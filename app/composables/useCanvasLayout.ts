import type { CanvasCamera, CanvasLayoutResponse, CanvasNode, CanvasRect } from '~~/shared/types/canvas'
import { CANVAS_BATCH_SIZE, canvasCameraSchema, canvasRectSchema } from '~~/shared/types/canvas'

export function useCanvasLayout(projectId: string) {
  const positions = shallowRef(new Map<string, CanvasRect>())
  const camera = reactive<CanvasCamera>({ x: 40, y: 50, zoom: 0.85 })
  const nextSlot = ref(0)
  const ready = ref(false)
  const loadError = ref(false)
  const saveState = ref<'saved' | 'saving' | 'error'>('saved')
  const dirty = new Map<string, CanvasNode>()
  const loaded = new Set<string>()
  let dirtyCamera: CanvasCamera | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<void> | undefined
  let loading: Promise<boolean> | undefined
  let disposed = false
  let clock = 0
  let legacy: { positions?: Array<[string, Partial<CanvasRect>]>, camera?: CanvasCamera, nextSlot?: number } | undefined
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/canvas`

  function schedule() {
    clearTimeout(timer)
    saveState.value = 'saving'
    timer = setTimeout(() => { void flush() }, 450)
  }
  function markNode(id: string) {
    const rect = positions.value.get(id)
    if (!rect || !ready.value)
      return
    dirty.set(id, { id, ...rect })
    schedule()
  }
  function markView() {
    if (!ready.value)
      return
    dirtyCamera = { ...camera }
    schedule()
  }
  async function savePending(keepalive: boolean) {
    while (dirty.size || dirtyCamera) {
      const nodes = [...dirty.values()].slice(0, CANVAS_BATCH_SIZE)
      const view = dirtyCamera
      clock = Math.max(clock + 1, Date.now() * 1000)
      try {
        await $fetch(endpoint, {
          method: 'PATCH',
          body: { nodes, camera: view, nextSlot: nextSlot.value, version: clock },
          keepalive,
          timeout: 15000,
          retry: 0,
        })
        for (const node of nodes) {
          if (dirty.get(node.id) === node)
            dirty.delete(node.id)
        }
        if (dirtyCamera === view)
          dirtyCamera = undefined
      }
      catch {
        saveState.value = 'error'
        return
      }
    }
    saveState.value = 'saved'
  }
  async function flush(keepalive = false) {
    clearTimeout(timer)
    if (!ready.value)
      return
    if (keepalive) {
      // A versioned keepalive save can overtake an older request safely.
      await savePending(true)
      return
    }
    if (saving) {
      await saving
      return
    }
    saveState.value = dirty.size || dirtyCamera ? 'saving' : 'saved'
    saving = savePending(false)
    try { await saving }
    finally { saving = undefined }
  }

  async function ensure(ids: string[]): Promise<boolean> {
    if (loading)
      await loading
    if (disposed)
      return false
    const missing = [...new Set(ids)].filter(id => !loaded.has(id) || !positions.value.has(id))
    if (ready.value && !missing.length)
      return true
    loading = (async () => {
      loadError.value = false
      try {
        if (!legacy && !ready.value) {
          try { legacy = JSON.parse(localStorage.getItem(`canvas-layout:${projectId}`) || '{}') }
          catch { legacy = {} }
        }
        const batches = Math.max(1, Math.ceil(missing.length / CANVAS_BATCH_SIZE))
        for (let batch = 0; batch < batches; batch++) {
          const selection = missing.slice(batch * CANVAS_BATCH_SIZE, (batch + 1) * CANVAS_BATCH_SIZE)
          const data = await $fetch<CanvasLayoutResponse>(`${endpoint}/read`, {
            method: 'POST',
            body: { ids: selection },
            timeout: 15000,
            retry: 0,
          })
          if (disposed)
            return false
          clock = Math.max(clock, data.version)
          if (!ready.value) {
            const savedCamera = canvasCameraSchema.safeParse(data.camera || legacy?.camera)
            if (savedCamera.success)
              Object.assign(camera, savedCamera.data)
            nextSlot.value = data.nextSlot || (Number.isSafeInteger(legacy?.nextSlot) ? Math.max(0, Math.min(1000000, legacy!.nextSlot!)) : 0)
            ready.value = true
          }
          const remote = new Map(data.nodes.map(node => [node.id, node]))
          const next = new Map(positions.value)
          for (const id of selection) {
            loaded.add(id)
            if (dirty.has(id))
              continue
            const old = Array.isArray(legacy?.positions) ? legacy.positions.find(entry => Array.isArray(entry) && entry[0] === id)?.[1] : undefined
            const stored = remote.get(id)
            const parsed = canvasRectSchema.safeParse(stored || (old && { width: 280, height: 310, ...old }))
            if (parsed.success) {
              next.set(id, parsed.data)
              if (!stored)
                dirty.set(id, { id, ...parsed.data })
            }
          }
          positions.value = next
          if (!data.camera || dirty.size)
            markView()
        }
        // Only retain identities for cached coordinates, so unloaded history can
        // be fetched again after its coordinates are evicted from memory.
        if (loaded.size > 1000) {
          const active = new Set(ids)
          for (const id of loaded) {
            if (loaded.size <= 1000)
              break
            if (!active.has(id) && !dirty.has(id))
              loaded.delete(id)
          }
        }
        return true
      }
      catch {
        loadError.value = true
        return false
      }
    })()
    try { return await loading }
    finally { loading = undefined }
  }
  function leaving() { void flush(true) }
  onMounted(() => window.addEventListener('pagehide', leaving))
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(timer)
    window.removeEventListener('pagehide', leaving)
    leaving()
  })
  return { positions, camera, nextSlot, ready, loadError, saveState, markNode, markView, ensure, flush }
}
