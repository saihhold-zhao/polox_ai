import { canvasReadSchema } from '../../../../../shared/types/canvas'
import { CanvasLayout } from '../../../../models/canvasLayout'
import { canvasProject } from '../../../../utils/canvasLayout'

export default defineEventHandler(async (event) => {
  const project = await canvasProject(event)
  const parsed = canvasReadSchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid canvas selection' })
  const rows = await CanvasLayout.find({ ...project, assetId: { $in: [...parsed.data.ids, '__viewport__'] } }).lean()
  const viewport = rows.find(row => row.assetId === '__viewport__')
  return {
    nodes: rows.filter(row => row.assetId !== '__viewport__').map(row => ({ id: row.assetId, x: row.x, y: row.y, width: row.width, height: row.height })),
    camera: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null,
    nextSlot: viewport?.nextSlot || 0,
    version: Math.max(0, ...rows.map(row => Number(row.version) || 0)),
  }
})
