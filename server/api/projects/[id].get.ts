import { isProjectId, projectStats, resolveProject, toPublicProjectWithStats } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!isProjectId(id)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found',
    })
  }
  await connectDatabase()
  const project = await resolveProject(id)
  const stats = await projectStats()
  return toPublicProjectWithStats(project, stats)
})
