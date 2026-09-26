import { createError } from 'h3'
import { isBuiltinSkillId } from '../../agent/skills'
import { parseSkillCategoryInput } from '../../../shared/utils/skillCategory'
import { parseSkillCoverInput } from '../../../shared/utils/skillCover'
import { ensureUserSkillsReady, persistUserSkill, setUserSkillCategory, setUserSkillEnabled, toPublicUserSkill } from '../../utils/userSkills'
import { setUserSkillCover } from '../../utils/userSkillCover'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing skill id' })
  if (isBuiltinSkillId(id))
    throw createError({ statusCode: 403, statusMessage: 'Builtin skills cannot be modified' })

  ensureUserSkillsReady()
  const body = await readBody<{
    enabled?: boolean
    markdown?: string
    keywords?: string
    cover?: string | null
    category?: 'utility' | 'fun'
  }>(event)

  const category = parseSkillCategoryInput(body?.category)
  if (category === null)
    throw createError({ statusCode: 400, statusMessage: 'category must be "utility" or "fun"' })

  const hasCover = body?.cover !== undefined
  const coverInput = hasCover ? parseSkillCoverInput(body.cover) : null
  if (coverInput && !coverInput.ok)
    throw createError({ statusCode: 400, statusMessage: coverInput.error })
  const cover = coverInput?.ok ? coverInput.cover : undefined

  // Cover-only update (Skill Test canvas "Use as skill cover"). Allowed for drafts too;
  // does not need SKILL.md markdown or the Skill Creator session.
  if (hasCover && !body.markdown && !category && typeof body.enabled !== 'boolean') {
    const row = await setUserSkillCover(id, cover || '')
    if (!row)
      throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
    return { ok: true, skill: toPublicUserSkill(row) }
  }

  // Category-only update. Allowed for drafts too.
  if (category && !body?.markdown && typeof body?.enabled !== 'boolean') {
    const row = await setUserSkillCategory(id, category)
    if (!row)
      throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
    return { ok: true, skill: toPublicUserSkill(row) }
  }

  if (typeof body?.enabled === 'boolean' && !body.markdown) {
    const row = await setUserSkillEnabled(id, body.enabled)
    if (!row)
      throw createError({ statusCode: 404, statusMessage: 'User skill not found' })
    return { ok: true, skill: toPublicUserSkill(row) }
  }

  if (!body?.markdown?.trim())
    throw createError({ statusCode: 400, statusMessage: 'markdown, category, cover, or enabled is required' })

  const result = await persistUserSkill({
    markdown: body.markdown,
    enabled: body.enabled,
    keywords: body.keywords,
    cover,
    category,
    source: 'user',
  })
  if (!result.ok)
    throw createError({ statusCode: 400, statusMessage: 'Skill validation failed', data: { issues: result.issues } })
  if (result.skill.skillId !== id)
    throw createError({ statusCode: 400, statusMessage: 'Skill id in markdown must match URL id' })
  return { ok: true, skill: toPublicUserSkill(result.skill, true) }
})
