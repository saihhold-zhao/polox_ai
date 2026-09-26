import { createError } from 'h3'
import { isBuiltinSkillId, loadBuiltinSkill } from '../../agent/skills'
import { BUILTIN_PUBLIC_AGENT_SKILLS } from '../../../shared/utils/agentSkills'
import { getUserSkillRecord, readUserSkillMarkdown, toPublicUserSkill } from '../../utils/userSkills'
import { ensureUserSkillsReady } from '../../utils/userSkills'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing skill id' })

  if (isBuiltinSkillId(id)) {
    const doc = loadBuiltinSkill(id)
    if (!doc)
      throw createError({ statusCode: 404, statusMessage: 'Builtin skill not found' })
    const catalog = BUILTIN_PUBLIC_AGENT_SKILLS.find(skill => skill.id === id)
    return {
      source: 'builtin',
      id: doc.id,
      name: doc.frontmatter.name,
      description: doc.frontmatter.description,
      version: doc.frontmatter.version,
      triggers: doc.frontmatter.triggers,
      requires: doc.frontmatter.requires,
      category: doc.frontmatter.category || catalog?.category || 'utility',
      markdown: doc.raw,
      catalog,
    }
  }

  ensureUserSkillsReady()
  const row = await getUserSkillRecord(id)
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
  return { source: 'user', ...toPublicUserSkill(row, true), markdown: readUserSkillMarkdown(id) }
})
