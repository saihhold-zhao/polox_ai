import { isProjectId, projectStats, toPublicProjectWithStats, updateProject } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!isProjectId(id)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found',
    })
  }
  const body = await readBody<{
    name?: string
    description?: string
  }>(event)
  await connectDatabase()
  const project = await updateProject(id, {
    name: body?.name,
    description: body?.description,
  })
  const stats = await projectStats()
  return toPublicProjectWithStats(project, stats)
})
