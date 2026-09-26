import { createError } from 'h3'
import { ensureUserSkillsReady, importSkillPackage, toPublicUserSkill } from '../../utils/userSkills'

export default defineEventHandler(async (event) => {
  ensureUserSkillsReady()
  const body = await readBody<{
    markdown?: string
    category?: string
    skill?: { markdown?: string, category?: string }
    enabled?: boolean
  }>(event)
  const result = await importSkillPackage(body || {}, { enabled: body?.enabled ?? false })
  if (!result.ok)
    throw createError({ statusCode: 400, statusMessage: 'Import validation failed', data: { issues: result.issues } })
  return {
    ok: true,
    created: result.created,
    skill: toPublicUserSkill(result.skill, true),
    notice: result.skill.enabled ? undefined : 'Imported skills are disabled until you enable them.',
  }
})
