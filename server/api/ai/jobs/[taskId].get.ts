import { GenerationJob } from '../../../models/generationJob'
import { scheduleGenerationRefresh } from '../../../utils/generationPipeline'
import { toPublicJob } from '../../../utils/generationResults'
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
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (!job) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Generation job not found',
    })
  }
  scheduleGenerationRefresh(job)
  return toPublicJob(job)
})
