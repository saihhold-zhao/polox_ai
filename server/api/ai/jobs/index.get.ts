import { GenerationJob } from '../../../models/generationJob'
import { Project } from '../../../models/project'
import { visibleJobsFilter } from '../../../utils/generationJobs'
import { scheduleGenerationRefresh } from '../../../utils/generationPipeline'
import { toPublicJob } from '../../../utils/generationResults'
import { connectDatabase } from '../../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const limit = Math.min(50, Math.max(1, Math.floor(Number(query.limit) || 10)))
  const q = String(query.q || '')
  const projectId = String(query.projectId || '').trim()
  await connectDatabase()
  const scopedProject = projectId
    ? await Project.findOne({ _id: projectId }).select('isDefault')
    : null
  const otherProjectIds = scopedProject?.isDefault
    ? (await Project.find({ _id: { $ne: scopedProject._id } }).select('_id'))
        .map(project => String(project._id))
    : undefined
  const model = typeof query.model === 'string' ? query.model.trim() : ''
  const filter = { ...visibleJobsFilter(q, projectId, otherProjectIds), ...(model ? { model } : {}) }
  const [jobs, total] = await Promise.all([
    GenerationJob.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    GenerationJob.countDocuments(filter),
  ])
  const inflight = jobs
    .filter(job => job.state !== 'success' && job.state !== 'fail')
    .slice(0, 3)
  for (const job of inflight)
    void scheduleGenerationRefresh(job)
  return {
    items: jobs.map(job => toPublicJob(job)),
    total,
    page,
    limit,
  }
})
