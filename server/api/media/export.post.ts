import { AgentChat } from '../../models/agentChat'
import { GenerationJob } from '../../models/generationJob'
import { buildMediaExport, mediaExportSchema } from '../../utils/mediaExport'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const parsed = mediaExportSchema.safeParse(await readBody(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, statusMessage: 'Select between 1 and 100 available media files' })
  const urls = parsed.data.items.map(item => item.url)
  await connectDatabase()
  const [jobs, chats] = await Promise.all([
    GenerationJob.find({ state: 'success', resultUrls: { $in: urls } }).select('resultUrls').lean(),
    AgentChat.find({ 'images.url': { $in: urls } }).select('images.url images.status').lean(),
  ])
  const allowed = new Set([...jobs.flatMap(job => job.resultUrls), ...chats.flatMap(chat => chat.images.filter(image => image.status === 'success').map(image => image.url))])
  if (urls.some(url => !allowed.has(url)))
    throw createError({ statusCode: 403, statusMessage: 'Some selected media is unavailable in this project' })
  try {
    const file = await buildMediaExport(parsed.data)
    setHeader(event, 'Content-Type', file.mime)
    setHeader(event, 'Content-Disposition', `attachment; filename="export.${parsed.data.format === 'zip' ? 'zip' : 'bin'}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
    setHeader(event, 'Cache-Control', 'private, no-store')
    return file.bytes
  }
  catch (error) {
    throw createError({ statusCode: 422, statusMessage: error instanceof Error ? error.message : 'Export failed' })
  }
})
