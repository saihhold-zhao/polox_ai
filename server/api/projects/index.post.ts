import { createProject, projectStats, toPublicProjectWithStats } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    name?: string
    description?: string
  }>(event)
  await connectDatabase()
  const project = await createProject({
    name: body?.name,
    description: body?.description,
  })
  const stats = await projectStats()
  return toPublicProjectWithStats(project, stats)
})
