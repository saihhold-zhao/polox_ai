import { z } from 'zod'

export const CANVAS_BATCH_SIZE = 100
export const canvasAssetIdSchema = z.string().min(1).max(200).regex(/^[a-z0-9_.:-]+$/i).refine(value => value !== '__viewport__')
const coordinate = z.number().finite().min(-1e7).max(1e7)
export const canvasRectSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: z.number().finite().min(200).max(1600),
  height: z.number().finite().min(2).max(100000),
})
export const canvasCameraSchema = z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.12).max(3) })
export const canvasNodeSchema = canvasRectSchema.extend({ id: canvasAssetIdSchema })
export const canvasReadSchema = z.object({ ids: z.array(canvasAssetIdSchema).max(CANVAS_BATCH_SIZE) })
export const canvasPatchSchema = z.object({
  nodes: z.array(canvasNodeSchema).max(CANVAS_BATCH_SIZE),
  camera: canvasCameraSchema.optional(),
  nextSlot: z.number().int().min(0).max(1000000).optional(),
  version: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
})
export type CanvasRect = z.infer<typeof canvasRectSchema>
export type CanvasNode = z.infer<typeof canvasNodeSchema>
export type CanvasCamera = z.infer<typeof canvasCameraSchema>
export type CanvasPatch = z.infer<typeof canvasPatchSchema>
export interface CanvasLayoutResponse {
  nodes: CanvasNode[]
  camera: CanvasCamera | null
  nextSlot: number
  version: number
}
