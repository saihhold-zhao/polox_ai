import { PROJECT_DELETE_CONFIRMATION } from '../../../shared/types/project'
import { deleteProject, isProjectId } from '../../utils/projects'
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
    confirmation?: string
  }>(event)
  if (String(body?.confirmation || '').trim() !== PROJECT_DELETE_CONFIRMATION) {
    throw createError({
      statusCode: 400,
      statusMessage: `Type ${PROJECT_DELETE_CONFIRMATION} to confirm`,
    })
  }
  await connectDatabase()
  const destination = await deleteProject(id)
  return {
    ok: true,
    defaultProjectId: String(destination._id),
  }
})
