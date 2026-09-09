
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
export function isHiddenFromUserJob(job: {
  hiddenFromUser?: boolean
  failCode?: string
}) {
  return Boolean(job.hiddenFromUser)
}
export function jobProviderId(job: {
  providerTaskId?: string
  taskId: string
}) {
  return String(job.providerTaskId || job.taskId || '').trim()
}
export function isLocalTaskId(taskId: string) {
  const id = String(taskId || '')
  return id.startsWith('job_') || id.startsWith('agent_')
}
export function isProviderStarted(job: {
  state?: string
  providerTaskId?: string
  taskId: string
}) {
  if (String(job.providerTaskId || '').trim())
    return true
  if (job.state === 'queued')
    return false
  return Boolean(job.taskId) && !isLocalTaskId(job.taskId)
}
export function visibleJobsFilter(q = '', projectId = '', catchAllExceptProjectIds?: string[]) {
  const filter: Record<string, unknown> = {
    deleted: { $ne: true },
    hiddenFromUser: { $ne: true },
  }
  const clauses: Record<string, unknown>[] = []
  const scopedProjectId = projectId.trim()
  if (scopedProjectId) {
    if (catchAllExceptProjectIds) {
      if (catchAllExceptProjectIds.length)
        filter.projectId = { $nin: catchAllExceptProjectIds }
    }
    else {
      filter.projectId = scopedProjectId
    }
  }
  const query = q.trim()
  if (query) {
    const rx = new RegExp(escapeRegex(query), 'i')
    clauses.push({
      $or: [
        { 'input.prompt': rx },
        { model: rx },
        { task: rx },
        { category: rx },
        { failMsg: rx },
      ],
    })
  }
  if (clauses.length)
    filter.$and = clauses
  return filter
}
export function isJobDeleted(job: {
  deleted?: boolean
  deletedAt?: Date | null
}) {
  return Boolean(job.deleted || job.deletedAt)
}
