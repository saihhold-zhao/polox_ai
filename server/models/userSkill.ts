import type { SkillCategory } from '../../shared/utils/skillCategory'
import { defineCollection } from '../utils/sqlite'

export type UserSkillCategory = SkillCategory

export type UserSkillSource = 'user' | 'imported'
export type UserSkillVisibility = 'private' | 'public'
export type UserSkillStatus = 'draft' | 'published'

export interface IUserSkill {
  skillId: string
  name: string
  description: string
  keywords: string
  cover?: string
  /** draft = WIP; cannot Test until published. */
  status: UserSkillStatus
  enabled: boolean
  visibility: UserSkillVisibility
  /** utility | fun. Missing/null (legacy rows) is treated as utility. */
  category?: UserSkillCategory | null
  version: string
  contentHash: string
  source: UserSkillSource
  triggers: string[]
  requires: string[]
  maxGenerationsPerRun: number
  allowSpend: boolean
  /** Bound skill workspace project id (1:1). */
  projectId?: string
  createdAt: Date
  updatedAt: Date
}

export const UserSkill = defineCollection<IUserSkill>('user_skills', () => ({
  description: '',
  keywords: '',
  status: 'published' as UserSkillStatus,
  enabled: false,
  visibility: 'private' as UserSkillVisibility,
  version: '1.0.0',
  contentHash: '',
  source: 'user' as UserSkillSource,
  triggers: [],
  requires: [],
  maxGenerationsPerRun: 3,
  allowSpend: true,
  projectId: '',
}), [{ fields: ['skillId'] }])
