import { canvasPatchSchema } from '../../../../shared/types/canvas'
import { CanvasLayout } from '../../../models/canvasLayout'
import { canvasProject } from '../../../utils/canvasLayout'

export default defineEventHandler(async (event) => {
  const project = await canvasProject(event)
  const parsed = canvasPatchSchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Invalid canvas layout' })
  const { nodes, camera, nextSlot, version } = parsed.data
  const changes: Array<{ assetId: string, values: Record<string, number> }> = nodes.map(({ id, ...rect }) => ({ assetId: id, values: rect }))
  if (camera)
    changes.push({ assetId: '__viewport__', values: { ...camera, nextSlot: nextSlot || 0 } })
  if (!changes.length)
    return { ok: true }
  // Versioned atomic updates prevent an older in-flight/unload request from
  // overwriting a newer drag, including when HTTP requests finish out of order.
  const operations = changes.map(({ assetId, values }) => ({
    updateOne: {
      filter: { ...project, assetId },
      update: [{ $set: {
        ...project,
        assetId,
        ...Object.fromEntries(Object.entries({ ...values, version }).map(([key, value]) => [key, {
          $cond: [{ $gte: [version, { $ifNull: ['$version', 0] }] }, value, `$${key}`],
        }])),
      } }],
      upsert: true,
    },
  }))
  try {
    await CanvasLayout.bulkWrite(operations, { ordered: false })
  }
  catch (error) {
    // Concurrent first saves may race on the unique key; retry as updates.
    if (((error as { errcode?: number }).errcode || 0) % 256 !== 19)
      throw error
    await CanvasLayout.bulkWrite(operations.map(op => ({ updateOne: { ...op.updateOne, upsert: false } })), { ordered: false })
  }
  return { ok: true }
})
