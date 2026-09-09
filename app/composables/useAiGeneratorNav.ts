import type { AiCategory, AiTask } from '@/types/aiModel'
import { toast } from 'vue-sonner'
import { AI_GENERATOR_NAV } from '@/constants/aiGeneratorNav'
import { IMAGE_EDITOR_PATH, VIDEO_EDITOR_PATH } from '@/constants/usefulTools'

function lockedGeneratorSelection(path: string) {
  if (path === IMAGE_EDITOR_PATH)
    return { category: 'Image' as const, task: 'Image to Image' as const }
  if (path === VIDEO_EDITOR_PATH)
    return { category: 'Video' as const, task: 'Reference to Video' as const }
  return null
}

export function useAiGeneratorNav() {
  const route = useRoute()
  const { selectedCategory } = useAiGeneratorCategory()
  const { selectedTask } = useAiGeneratorTask()
  const { isAgentMode, exitAgentMode } = useAgentWorkspaceNav()

  function currentLock() {
    return lockedGeneratorSelection(route.path)
  }

  function isCategoryActive(category: string) {
    const lock = currentLock()
    if (lock)
      return category === lock.category
    return route.path === '/' && !isAgentMode.value && selectedCategory.value === category
  }

  function isTaskActive(category: AiCategory, task: AiTask) {
    const lock = currentLock()
    if (lock)
      return category === lock.category && task === lock.task
    return isCategoryActive(category) && selectedTask.value === task
  }

  function notifyComingSoon(name: string) {
    toast.info('Coming soon', {
      description: `${name} generation is not available yet.`,
      closeButton: true,
      duration: 5000,
    })
  }

  function selectCategory(value: string) {
    const group = AI_GENERATOR_NAV.find(item => item.heading === value)
    if (!group || group.comingSoon) {
      notifyComingSoon(value)
      return false
    }

    selectedCategory.value = group.heading as AiCategory
    return true
  }

  function selectTask(category: AiCategory, task: AiTask) {
    const comingSoon = AI_GENERATOR_NAV
      .find(group => group.heading === category)
      ?.items
      .some(item => item.task === task && item.comingSoon)

    if (comingSoon) {
      notifyComingSoon(task)
      return
    }

    selectedCategory.value = category
    selectedTask.value = task
    exitAgentMode()
    if (route.path === '/' || /^\/projects\/[^/]+$/.test(route.path))
      return
    const lock = currentLock()
    if (lock && category === lock.category && task === lock.task)
      return
    void navigateTo('/')
  }

  return {
    groups: AI_GENERATOR_NAV,
    selectedCategory,
    selectedTask,
    isCategoryActive,
    isTaskActive,
    selectCategory,
    selectTask,
    notifyComingSoon,
  }
}
