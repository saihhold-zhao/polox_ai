import { UserSkill } from '../models/userSkill'
import { ensureUserSkillsReady } from './userSkills'

/** Cover update for a local skill (empty string clears). Caller validates the URL with parseSkillCoverInput. */
export async function setUserSkillCover(skillId: string, cover: string) {
  ensureUserSkillsReady()
  const row = await UserSkill.findOne({ skillId })
  if (!row)
    return null
  row.cover = cover || undefined
  row.updatedAt = new Date()
  await row.save()
  return row
}
