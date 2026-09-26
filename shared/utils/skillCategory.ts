/**
 * Skill sub-category: functional ("utility") vs entertainment ("fun").
 * Legacy rows / markdown without a category are treated as `utility` — no DB migration needed.
 */
export const SKILL_CATEGORIES = ['utility', 'fun'] as const

export type SkillCategory = typeof SKILL_CATEGORIES[number]

/** UI filter tab value: all categories or a specific one. */
export type SkillCategoryTab = 'all' | SkillCategory

export const DEFAULT_SKILL_CATEGORY: SkillCategory = 'utility'

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  utility: 'Utility',
  fun: 'Fun',
}

export function isSkillCategory(value: unknown): value is SkillCategory {
  return typeof value === 'string' && (SKILL_CATEGORIES as readonly string[]).includes(value)
}

/** Lenient read-side normalization: anything unknown/missing becomes `utility`. */
export function normalizeSkillCategory(value: unknown): SkillCategory {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'fun' || raw === 'entertainment')
    return 'fun'
  return DEFAULT_SKILL_CATEGORY
}

/**
 * Strict write-side parse: `undefined` when not provided, `null` when invalid,
 * otherwise the category. Use to validate API input.
 */
export function parseSkillCategoryInput(value: unknown): SkillCategory | undefined | null {
  if (value === undefined || value === null || value === '')
    return undefined
  if (typeof value !== 'string')
    return null
  const raw = value.trim().toLowerCase()
  return isSkillCategory(raw) ? raw : null
}

/** Query filter parse (`?category=utility|fun|all`). Returns undefined for all/missing/invalid. */
export function parseSkillCategoryFilter(value: unknown): SkillCategory | undefined {
  const first = Array.isArray(value) ? value[0] : value
  const parsed = parseSkillCategoryInput(first)
  return parsed || undefined
}

/** Official builtin skill categories. All existing builtins are utility; unlisted builtins default to utility. */
export const BUILTIN_SKILL_CATEGORIES: Record<string, SkillCategory> = {
  'product-hunt-gallery': 'utility',
  'app-store-graphics': 'utility',
  'sketch-to-image': 'utility',
  'image-text-editor': 'utility',
  'image-annotation-edit': 'utility',
  'image-object-removal': 'utility',
  'image-layer-splitter': 'utility',
  'image-editing': 'utility',
  'long-form-video': 'utility',
  'talking-avatar': 'utility',
  'skill-creator': 'utility',
}

export function builtinSkillCategory(id: string): SkillCategory {
  return BUILTIN_SKILL_CATEGORIES[id] ?? DEFAULT_SKILL_CATEGORY
}

export function filterSkillsByCategory<T extends { category?: unknown }>(skills: readonly T[], category?: SkillCategoryTab): T[] {
  if (!category || category === 'all')
    return [...skills]
  return skills.filter(skill => normalizeSkillCategory(skill.category) === category)
}

/** Count skills per category tab (all / utility / fun). */
export function countSkillsByCategory(skills: readonly { category?: unknown }[]): Record<SkillCategoryTab, number> {
  const counts: Record<SkillCategoryTab, number> = { all: skills.length, utility: 0, fun: 0 }
  for (const skill of skills)
    counts[normalizeSkillCategory(skill.category)]++
  return counts
}
