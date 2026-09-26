import { createError } from 'h3'
import { isBuiltinSkillId, loadBuiltinSkill } from '../../../agent/skills'
import { ensureUserSkillsReady, serializeSkillExport } from '../../../utils/userSkills'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing skill id' })

  if (isBuiltinSkillId(id)) {
    const doc = loadBuiltinSkill(id)
    if (!doc)
      throw createError({ statusCode: 404, statusMessage: 'Builtin skill not found' })
    return {
      format: 'polox-skill/v1',
      skill: {
        id: doc.id,
        name: doc.frontmatter.name,
        description: doc.frontmatter.description,
        version: doc.frontmatter.version,
        markdown: doc.raw,
      },
    }
  }

  ensureUserSkillsReady()
  const payload = await serializeSkillExport(id)
  if (!payload)
    throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
  return payload
})
