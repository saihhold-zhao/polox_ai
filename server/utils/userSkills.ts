import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { isBuiltinSkillId, parseSkillMarkdown, userSkillsDir, type SkillDocument } from '../agent/skills'
import { normalizeSkillCategory, type SkillCategory } from '../../shared/utils/skillCategory'
import { UserSkill, type IUserSkill, type UserSkillCategory, type UserSkillSource } from '../models/userSkill'
import { connectDatabase } from './sqlite'
import { validateUserSkillMarkdown } from './skillValidation'

function skillDir(skillId: string, cwd = process.cwd()) {
  return resolve(userSkillsDir(cwd), skillId)
}

function skillFile(skillId: string, cwd = process.cwd()) {
  return resolve(skillDir(skillId, cwd), 'SKILL.md')
}

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

export function ensureUserSkillsReady() {
  connectDatabase()
  mkdirSync(userSkillsDir(), { recursive: true })
}

/** Local query filter for a category. Legacy rows without `category` count as utility. */
export function skillCategoryQuery(category?: SkillCategory): { category?: SkillCategory | { $nin: SkillCategory[] } } {
  if (!category)
    return {}
  if (category === 'utility')
    return { category: { $nin: ['fun'] } }
  return { category }
}

export async function listUserSkillRecords(category?: SkillCategory) {
  ensureUserSkillsReady()
  return UserSkill.find({ ...skillCategoryQuery(category) }).sort({ updatedAt: -1 })
}

export async function listEnabledUserCatalog() {
  const rows = await listUserSkillRecords()
  return rows
    .filter(row => row.enabled)
    .map(row => ({
      id: row.skillId,
      name: row.name,
      description: row.description,
      triggers: row.triggers,
      category: normalizeSkillCategory(row.category),
      visibility: 'catalog' as const,
    }))
}

export async function getUserSkillRecord(skillId: string) {
  ensureUserSkillsReady()
  return UserSkill.findOne({ skillId })
}

export function readUserSkillMarkdown(skillId: string) {
  try {
    return readFileSync(skillFile(skillId), 'utf8')
  }
  catch {
    return null
  }
}

export interface PersistUserSkillInput {
  markdown: string
  source?: UserSkillSource
  enabled?: boolean
  status?: 'draft' | 'published'
  visibility?: 'private' | 'public'
  projectId?: string
  cover?: string
  keywords?: string
  /** utility | fun. Omit to keep existing (or frontmatter / default utility for new skills). */
  category?: UserSkillCategory
}

export async function persistUserSkill(input: PersistUserSkillInput) {
  ensureUserSkillsReady()
  const validation = validateUserSkillMarkdown(input.markdown)
  if (!validation.ok || !validation.document)
    return { ok: false as const, issues: validation.issues }

  const document = validation.document
  const skillId = document.frontmatter.id
  if (isBuiltinSkillId(skillId))
    return { ok: false as const, issues: [{ path: 'id', message: `Cannot overwrite builtin skill "${skillId}".` }] }

  const existing = await UserSkill.findOne({ skillId })
  const enabled = input.enabled ?? existing?.enabled ?? (input.source === 'imported' ? false : true)
  const status = input.status ?? existing?.status ?? (enabled ? 'published' : 'draft')
  const visibility = input.visibility ?? existing?.visibility ?? 'private'
  const projectId = input.projectId ?? existing?.projectId ?? ''
  // Explicit input wins; then the stored row; then SKILL.md frontmatter; default utility.
  const category: UserSkillCategory = normalizeSkillCategory(
    input.category ?? existing?.category ?? document.frontmatter.category,
  )
  const contentHash = hash(input.markdown.trim())
  mkdirSync(skillDir(skillId), { recursive: true })
  writeFileSync(skillFile(skillId), `${input.markdown.trim()}\n`, 'utf8')

  const payload: Partial<IUserSkill> = {
    skillId,
    name: document.frontmatter.name,
    description: document.frontmatter.description,
    keywords: input.keywords ?? existing?.keywords ?? '',
    cover: input.cover ?? existing?.cover,
    enabled,
    status,
    visibility,
    category,
    projectId,
    version: document.frontmatter.version,
    contentHash,
    source: input.source ?? existing?.source ?? 'user',
    triggers: document.frontmatter.triggers,
    requires: document.frontmatter.requires,
    maxGenerationsPerRun: document.frontmatter.safety.maxGenerationsPerRun,
    allowSpend: document.frontmatter.safety.allowSpend,
    updatedAt: new Date(),
  }

  if (existing) {
    Object.assign(existing, payload)
    await existing.save()
    return { ok: true as const, skill: existing, created: false }
  }

  const created = await UserSkill.create({
    ...payload,
    createdAt: new Date(),
  } as IUserSkill)
  return { ok: true as const, skill: created, created: true }
}

export async function setUserSkillEnabled(skillId: string, enabled: boolean) {
  ensureUserSkillsReady()
  const row = await UserSkill.findOne({ skillId })
  if (!row)
    return null
  row.enabled = enabled
  row.updatedAt = new Date()
  await row.save()
  return row
}

export async function setUserSkillCategory(skillId: string, category: UserSkillCategory) {
  ensureUserSkillsReady()
  const row = await UserSkill.findOne({ skillId })
  if (!row)
    return null
  row.category = normalizeSkillCategory(category)
  row.updatedAt = new Date()
  await row.save()
  return row
}

export async function deleteUserSkill(skillId: string) {
  ensureUserSkillsReady()
  const row = await UserSkill.findOne({ skillId })
  if (!row)
    return false
  await row.deleteOne()
  rmSync(skillDir(skillId), { recursive: true, force: true })
  return true
}

export function toPublicUserSkill(row: IUserSkill & { _id?: string }, includeBody = false) {
  const markdown = includeBody ? readUserSkillMarkdown(row.skillId) : undefined
  return {
    id: row.skillId,
    name: row.name,
    description: row.description,
    keywords: row.keywords,
    cover: row.cover,
    enabled: row.enabled,
    status: row.status || (row.enabled ? 'published' : 'draft'),
    visibility: row.visibility || 'private',
    category: normalizeSkillCategory(row.category),
    projectId: row.projectId || '',
    version: row.version,
    contentHash: row.contentHash,
    source: row.source,
    triggers: row.triggers,
    requires: row.requires,
    maxGenerationsPerRun: row.maxGenerationsPerRun,
    allowSpend: row.allowSpend,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    markdown,
  }
}

export async function serializeSkillExport(skillId: string) {
  const markdown = readUserSkillMarkdown(skillId)
  if (!markdown)
    return null
  const document = parseSkillMarkdown(markdown, skillId, 'imported')
  const row = await getUserSkillRecord(skillId)
  return {
    format: 'polox-skill/v1',
    skill: {
      id: document.frontmatter.id,
      name: document.frontmatter.name,
      description: document.frontmatter.description,
      version: document.frontmatter.version,
      category: normalizeSkillCategory(row?.category ?? document.frontmatter.category),
      markdown,
    },
  }
}

export async function importSkillPackage(payload: { markdown?: string, category?: unknown, skill?: { markdown?: string, category?: unknown } }, options?: { enabled?: boolean }) {
  const markdown = payload.markdown || payload.skill?.markdown
  if (!markdown)
    return { ok: false as const, issues: [{ path: 'markdown', message: 'Import payload must include markdown.' }] }
  return persistUserSkill({
    markdown,
    source: 'imported',
    ...(payload.category ?? payload.skill?.category
      ? { category: normalizeSkillCategory(payload.category ?? payload.skill?.category) }
      : {}),
    enabled: options?.enabled ?? false,
  })
}


export async function getUserSkillByProjectId(projectId: string) {
  ensureUserSkillsReady()
  const id = String(projectId || '').trim()
  if (!id)
    return null
  return UserSkill.findOne({ projectId: id })
}

export async function publishAndEnableUserSkill(skillId: string, category?: UserSkillCategory) {
  ensureUserSkillsReady()
  const row = await UserSkill.findOne({ skillId })
  if (!row)
    return null
  row.status = 'published'
  row.enabled = true
  if (category)
    row.category = normalizeSkillCategory(category)
  row.updatedAt = new Date()
  await row.save()
  return row
}

export async function isSkillIdTaken(skillId: string, exceptSkillId?: string) {
  ensureUserSkillsReady()
  const id = String(skillId || '').trim().toLowerCase()
  if (!id)
    return false
  const row = await UserSkill.findOne({ skillId: id })
  if (!row)
    return false
  if (exceptSkillId && row.skillId === exceptSkillId)
    return false
  return true
}

export async function isSkillNameTaken(name: string, exceptSkillId?: string) {
  ensureUserSkillsReady()
  const key = String(name || '').trim().toLowerCase()
  if (!key)
    return false
  const rows = await listUserSkillRecords()
  return rows.some(row => row.name.trim().toLowerCase() === key && (!exceptSkillId || row.skillId !== exceptSkillId))
}

export type { SkillDocument }
