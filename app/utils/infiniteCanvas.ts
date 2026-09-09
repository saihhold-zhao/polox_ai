import type { CanvasCamera, CanvasRect } from '../../shared/types/canvas'

export const CARD_CHROME_HEIGHT = 2
export const CARD_WIDTH = 280
export const CARD_HEIGHT = 280
export const CELL_X = 320
export const CELL_Y = 350
export const MAX_VISIBLE = 80
export const MAX_PLAYING_VIDEOS = 6
export const MIN_ZOOM = 0.12
export const MAX_ZOOM = 3

export interface CanvasPoint { x: number, y: number }
export type CanvasCorner = 'nw' | 'ne' | 'sw' | 'se'

export interface CanvasGuide {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
}

// Compare world coordinates with a screen-pixel tolerance at every zoom level.
export function snapCanvasRect(rect: CanvasRect, targets: CanvasRect[], zoom: number) {
  const snapped = { ...rect }
  const guides: CanvasGuide[] = []
  const tolerance = 6 / clampZoom(zoom)
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height'
    const cross = axis === 'x' ? 'y' : 'x'
    const crossSize = axis === 'x' ? 'height' : 'width'
    let best: { delta: number, position: number } | undefined
    for (const target of targets) {
      for (const targetFactor of [0, 0.5, 1]) {
        const position = target[axis] + target[size] * targetFactor
        for (const factor of [0, 0.5, 1]) {
          const delta = position - (rect[axis] + rect[size] * factor)
          if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = { delta, position }
        }
      }
    }
    if (!best)
      continue
    snapped[axis] += best.delta
    const aligned = targets.filter(target => [0, 0.5, 1].some(factor => Math.abs(target[axis] + target[size] * factor - best.position) < 1e-6))
    guides.push({
      axis,
      position: best.position,
      start: Math.min(rect[cross], ...aligned.map(target => target[cross])),
      end: Math.max(rect[cross] + rect[crossSize], ...aligned.map(target => target[cross] + target[crossSize])),
    })
  }
  // Both axes may have moved; include the final rectangle in the guide span.
  for (const guide of guides) {
    const cross = guide.axis === 'x' ? 'y' : 'x'
    const size = guide.axis === 'x' ? 'height' : 'width'
    guide.start = Math.min(guide.start, snapped[cross])
    guide.end = Math.max(guide.end, snapped[cross] + snapped[size])
  }
  return { rect: snapped, guides }
}

export function fitMediaRect(rect: CanvasRect, width: number, height: number): CanvasRect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return rect
  return { ...rect, height: (rect.width - 2) * height / width + CARD_CHROME_HEIGHT }
}

export function resizeFromCorner(rect: CanvasRect, corner: CanvasCorner, dx: number, dy: number): CanvasRect {
  const west = corner.includes('w')
  const north = corner.includes('n')
  const mediaHeight = rect.height - CARD_CHROME_HEIGHT
  const mediaWidth = rect.width - 2
  const change = ((west ? -dx : dx) * mediaWidth + (north ? -dy : dy) * mediaHeight) / (mediaWidth ** 2 + mediaHeight ** 2)
  const width = Math.min(1600, Math.max(200, mediaWidth * (1 + change) + 2))
  const height = (width - 2) * mediaHeight / mediaWidth + CARD_CHROME_HEIGHT
  return { x: west ? rect.x + rect.width - width : rect.x, y: north ? rect.y + rect.height - height : rect.y, width, height }
}

export function clampZoom(value: number) {
  return Number.isFinite(value) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) : 1
}

export function zoomAt(camera: CanvasCamera, point: CanvasPoint, value: number): CanvasCamera {
  const zoom = clampZoom(value)
  return {
    x: point.x - (point.x - camera.x) * zoom / camera.zoom,
    y: point.y - (point.y - camera.y) * zoom / camera.zoom,
    zoom,
  }
}

export function inViewport(point: CanvasPoint & Partial<CanvasRect>, camera: CanvasCamera, width: number, height: number) {
  const margin = 80
  return (point.x + (point.width ?? CARD_WIDTH)) * camera.zoom + camera.x >= -margin
    && point.x * camera.zoom + camera.x <= width + margin
    && (point.y + (point.height ?? CARD_HEIGHT)) * camera.zoom + camera.y >= -margin
    && point.y * camera.zoom + camera.y <= height + margin
}

export function intersectsSelection(point: CanvasRect, camera: CanvasCamera, box: { x: number, y: number, endX: number, endY: number }) {
  const x = point.x * camera.zoom + camera.x
  const y = point.y * camera.zoom + camera.y
  return x <= Math.max(box.x, box.endX) && x + point.width * camera.zoom >= Math.min(box.x, box.endX)
    && y <= Math.max(box.y, box.endY) && y + point.height * camera.zoom >= Math.min(box.y, box.endY)
}

// Missing legacy timestamps retain their input order after dated assets.
export function byCreationTime<T extends { createdAt?: string }>(items: T[]): T[] {
  const time = (value?: string) => {
    const parsed = Date.parse(value || '')
    return Number.isFinite(parsed) ? parsed : Infinity
  }
  return [...items].sort((a, b) => time(a.createdAt) - time(b.createdAt))
}

export function latestCanvasAsset<T extends { id: string, state: string, url: string, createdAt?: string, completedAt?: string }>(items: T[]): T | undefined {
  const completed = items.filter(item => item.state === 'success' && item.url)
  const candidates = completed.length ? completed : items
  const time = (item: T) => {
    const completedAt = Date.parse(item.completedAt || '')
    const createdAt = Date.parse(item.createdAt || '')
    return Number.isFinite(completedAt) ? completedAt : Number.isFinite(createdAt) ? createdAt : 0
  }
  // Undated legacy assets retain source order (newest first), never story order.
  return candidates.reduce<T | undefined>((latest, item) => !latest || time(item) > time(latest) ? item : latest, undefined)
}

// Place older generations first. Legacy sources arrive newest first and have
// no timestamps; keep them before dated jobs and reverse their source order.
export function byCanvasOrder<T extends { id: string, name: string, createdAt?: string }>(items: T[]): T[] {
  const time = (value?: string) => {
    const parsed = Date.parse(value || '')
    return Number.isFinite(parsed) ? parsed : -Infinity
  }
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const left = time(a.item.createdAt)
    const right = time(b.item.createdAt)
    return left - right || (left === -Infinity ? b.index - a.index : a.index - b.index)
  }).map(({ item }) => item)
}

// Only repair untouched, contiguous default grids. Custom layouts are preserved.
export function isDefaultCanvasGrid(rects: CanvasRect[]): boolean {
  const slots = new Set<number>()
  for (const rect of rects) {
    const column = rect.x / CELL_X
    const row = rect.y / CELL_Y
    if (rect.width !== CARD_WIDTH || rect.height > CELL_Y - 40
      || !Number.isInteger(column) || column < 0 || column >= 5
      || !Number.isInteger(row) || row < 0) {
      return false
    }
    slots.add(row * 5 + column)
  }
  return slots.size === rects.length && [...slots].every(slot => slot < rects.length)
}

export function findFreeRect(preferred: CanvasRect, occupied: CanvasRect[], gap = 40): CanvasRect {
  const result = { ...preferred }
  // Jump past each obstruction rather than scanning potentially huge empty grids.
  while (true) {
    const blockers = occupied.filter(rect => result.x < rect.x + rect.width + gap
      && result.x + result.width + gap > rect.x
      && result.y < rect.y + rect.height + gap
      && result.y + result.height + gap > rect.y)
    if (!blockers.length)
      return result
    result.y = Math.max(...blockers.map(rect => rect.y + rect.height + gap))
  }
}
