import { defineCollection } from '../utils/sqlite'

export interface IProject {
  name: string
  description: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}
export const Project = defineCollection<IProject>('projects', () => ({
  description: '',
  isDefault: false,
}), [{ fields: ['isDefault'], where: 'json_extract(body, \'$.isDefault\') = 1' }])
