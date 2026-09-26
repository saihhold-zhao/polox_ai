import { BUILTIN_PUBLIC_AGENT_SKILLS } from '../../../shared/utils/agentSkills'
import { builtinSkillCategory, filterSkillsByCategory, parseSkillCategoryFilter } from '../../../shared/utils/skillCategory'
import { listBuiltinSkillDocuments } from '../../agent/skills'
import { ensureUserSkillsReady, listUserSkillRecords, toPublicUserSkill } from '../../utils/userSkills'

export default defineEventHandler(async (event) => {
  ensureUserSkillsReady()
  const userRows = await listUserSkillRecords()
  const userSkills = userRows.map(row => toPublicUserSkill(row))
  const builtinMeta = listBuiltinSkillDocuments().map(doc => ({
    id: doc.id,
    name: doc.frontmatter.name,
    description: doc.frontmatter.description,
    visibility: doc.frontmatter.visibility,
    triggers: doc.frontmatter.triggers,
    category: doc.frontmatter.category || builtinSkillCategory(doc.id),
    source: 'builtin' as const,
  }))
  // Optional ?category=utility|fun narrows userSkills + catalog (builtinCatalog/builtinMeta stay complete).
  const category = parseSkillCategoryFilter(getQuery(event).category)

  return {
    builtinCatalog: BUILTIN_PUBLIC_AGENT_SKILLS,
    builtinMeta,
    userSkills: filterSkillsByCategory(userSkills, category),
    catalog: filterSkillsByCategory([
      ...BUILTIN_PUBLIC_AGENT_SKILLS.map(skill => ({ ...skill, source: 'builtin' as const, enabled: true })),
      ...userSkills.filter(skill => skill.enabled).map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        keywords: skill.keywords || '',
        icon: 'lucide:sparkles',
        cover: skill.cover,
        source: 'user' as const,
        category: skill.category,
        enabled: true,
        createdAt: skill.createdAt,
      })),
    ], category),
    registeredAt: new Date().toISOString(),
  }
})
