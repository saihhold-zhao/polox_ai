import type { H3Event } from 'h3'
import { Project } from '../models/project'
import { isProjectId } from './projects'
import { connectDatabase } from './sqlite'

export async function canvasProject(event: H3Event) {
  const projectId = String(getRouterParam(event, 'id') || '')
  if (!isProjectId(projectId))
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  await connectDatabase()
  if (!await Project.exists({ _id: projectId }))
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return { projectId }
}
