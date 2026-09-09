import { testServiceConnections } from '../../utils/serviceConnection'
import { updateServiceSettings } from '../../utils/serviceSettings'

export default defineEventHandler(async (event) => {
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin)
    throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || ['openRouterKey', 'openRouterModel', 'falKey'].some(key => body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 4096)))
    throw createError({ statusCode: 400, statusMessage: 'Invalid connection settings' })
  setHeader(event, 'Cache-Control', 'no-store')
  return testServiceConnections(updateServiceSettings(body))
})
