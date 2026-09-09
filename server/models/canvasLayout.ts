import { defineCollection } from '../utils/sqlite'
// Store each canvas object independently.
interface CanvasLayoutDocument {
  projectId: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  zoom: number
  nextSlot: number
  version: number
}
export const CanvasLayout = defineCollection<CanvasLayoutDocument>('canvas_layouts', () => ({}), [{ fields: ['projectId', 'assetId'] }])
