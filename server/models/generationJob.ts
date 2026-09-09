import type { GenerationJobState } from '../../shared/types/generation'
import { defineCollection } from '../utils/sqlite'

export type ResultAssetStatus = 'pending' | 'uploaded' | 'failed'
export interface IResultAsset {
  sourceUrl: string
  localUrl: string
  localKey: string
  contentType: string
  status: ResultAssetStatus
  error: string
}
export interface IGenerationJob {
  projectId: string
  provider: 'fal'
  model: string
  category: string
  task: string
  input: Record<string, unknown>
  requestBody: Record<string, unknown>
  originalRequest: Record<string, unknown>
  taskId: string
  providerTaskId: string
  state: GenerationJobState
  sourceUrls: string[]
  resultUrls: string[]
  resultAssets: IResultAsset[]
  resultJson: string
  failCode: string
  failMsg: string
  webhookPayload?: Record<string, unknown>
  costTime?: number
  completedAt?: Date
  completeTime?: number

  archiveAttempts: number
  lastArchiveAt?: Date
  lastSyncAt?: Date
  hiddenFromUser: boolean
  deleted: boolean
  deletedAt?: Date
  createdAt: Date
  updatedAt: Date
}
export const GenerationJob = defineCollection<IGenerationJob>('generation_jobs', () => ({
  projectId: '',
  provider: 'fal',
  category: '',
  task: '',
  providerTaskId: '',
  state: 'waiting',
  sourceUrls: [],
  resultUrls: [],
  resultAssets: [],
  resultJson: '',
  failCode: '',
  failMsg: '',

  archiveAttempts: 0,
  hiddenFromUser: false,
  deleted: false,
}), [{ fields: ['providerTaskId'], where: 'json_extract(body, \'$.providerTaskId\') > \'\'' }, { fields: ['taskId'] }], (job) => {
  if (job.state === 'success' && !job.completedAt)
    job.completedAt = new Date()
})
