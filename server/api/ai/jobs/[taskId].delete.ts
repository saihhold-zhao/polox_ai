import { GENERATION_ACTIVE_STATES, isGenerationActive } from '../../../../shared/types/generation'
import { GenerationJob } from '../../../models/generationJob'
import { dispatchQueuedJobs } from '../../../utils/generationQueue'
import { connectDatabase } from '../../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const taskId = String(getRouterParam(event, 'taskId') || '').trim()
  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'taskId is required',
    })
  }
  await connectDatabase()
  const job = await GenerationJob.findOneAndUpdate({
    taskId,
    deleted: { $ne: true },
    state: { $nin: [...GENERATION_ACTIVE_STATES] },
  }, {
    $set: {
      deleted: true,
      deletedAt: new Date(),
    },
  }, { new: true })
  if (!job) {
    const existing = await GenerationJob.findOne({
      taskId,
      deleted: { $ne: true },
    }).select('state').lean()
    if (existing && isGenerationActive(existing.state)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete a generation that is still in progress',
      })
    }
    throw createError({
      statusCode: 404,
      statusMessage: 'Generation job not found',
    })
  }
  await dispatchQueuedJobs()
  return { ok: true }
})
