import type { AiCategory, AiTask } from '@/types/aiModel'
import { AI_TASKS } from '@/constants/aiModels'

export const AI_GENERATOR_CATEGORY_TABS = [
  { value: 'Image' as const, label: 'Image', comingSoon: false, icon: 'i-lucide-image' },
  { value: 'Video' as const, label: 'Video', comingSoon: false, icon: 'i-lucide-clapperboard' },
  { value: 'Music' as const, label: 'Music', comingSoon: true, icon: 'i-lucide-music' },
]

export const AI_GENERATOR_TASK_ICONS: Record<AiTask, string> = {
  'Text to Image': 'i-lucide-type',
  'Image to Image': 'i-lucide-images',
  'Text to Video': 'i-lucide-type',
  'Image to Video': 'i-lucide-clapperboard',
  'Reference to Video': 'i-lucide-library',
  'Remove Background': 'i-lucide-eraser',
  'Split Image Layers': 'i-lucide-layers',
  'Edit Image Text': 'i-lucide-text-cursor-input',
}

export const AI_GENERATOR_NAV = AI_GENERATOR_CATEGORY_TABS.map((category) => {
  const tasks = AI_TASKS.filter(task => task.category === category.value)

  const items = tasks.length
    ? tasks.map(task => ({
        title: task.value,
        category: task.category as AiCategory,
        task: task.value,
        icon: AI_GENERATOR_TASK_ICONS[task.value],
        comingSoon: Boolean(task.comingSoon),
      }))
    : [{
        title: 'Coming soon',
        category: undefined,
        task: undefined,
        icon: category.icon,
        comingSoon: true,
      }]

  return {
    heading: category.value,
    label: category.label,
    comingSoon: category.comingSoon,
    icon: category.icon,
    items,
  }
})
