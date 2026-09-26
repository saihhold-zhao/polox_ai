import { createError } from 'h3'
import { ensureUserSkillsReady, persistUserSkill, toPublicUserSkill } from '../../utils/userSkills'
import { validateUserSkillMarkdown } from '../../utils/skillValidation'
import { parseSkillCategoryInput } from '../../../shared/utils/skillCategory'

export default defineEventHandler(async (event) => {
  ensureUserSkillsReady()
  const body = await readBody<{
    markdown?: string
    enabled?: boolean
    status?: 'draft' | 'published'
    keywords?: string
    cover?: string
    visibility?: 'private' | 'public'
    category?: 'utility' | 'fun'
    projectId?: string
    validateOnly?: boolean
  }>(event)

  if (!body?.markdown?.trim())
    throw createError({ statusCode: 400, statusMessage: 'markdown is required' })

  const category = parseSkillCategoryInput(body.category)
  if (category === null)
    throw createError({ statusCode: 400, statusMessage: 'category must be "utility" or "fun"' })

  if (body.validateOnly) {
    const validation = validateUserSkillMarkdown(body.markdown)
    return { ok: validation.ok, issues: validation.issues, document: validation.document?.frontmatter }
  }

  const result = await persistUserSkill({
    markdown: body.markdown,
    enabled: body.enabled,
    status: body.status,
    keywords: body.keywords,
    cover: body.cover,
    visibility: body.visibility,
    category,
    projectId: body.projectId,
    source: 'user',
  })
  if (!result.ok)
    throw createError({ statusCode: 400, statusMessage: 'Skill validation failed', data: { issues: result.issues } })

  return {
    ok: true,
    created: result.created,
    skill: toPublicUserSkill(result.skill, true),
  }
})
