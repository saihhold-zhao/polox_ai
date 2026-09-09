import { toPublicJob } from '../../../utils/generationResults'
import { moveJobToProject } from '../../../utils/projects'
import { connectDatabase } from '../../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const taskId = String(getRouterParam(event, 'taskId') || '').trim()
  const body = await readBody<{
    projectId?: string
  }>(event)
  await connectDatabase()
  const job = await moveJobToProject(taskId, body?.projectId || '')
  return toPublicJob(job)
})
