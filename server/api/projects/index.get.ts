import type { GenerationProjectList } from '../../../shared/types/project'
import { Project } from '../../models/project'
import { ensureDefaultProject, projectStats, toPublicProjectWithStats } from '../../utils/projects'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (_event): Promise<GenerationProjectList> => {
  await connectDatabase()
  try {
    await ensureDefaultProject()
  }
  catch (error) {
    console.error('[projects] Failed to ensure default project', error)
  }
  const projects = await Project.find({}).sort({ isDefault: -1, createdAt: -1 })
  const stats = await projectStats()
  return {
    items: projects.map(project => toPublicProjectWithStats(project, stats)),
  }
})
