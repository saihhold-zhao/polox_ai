<script setup lang="ts">
import type { AiTask } from '@/types/aiModel'
import { AI_GENERATOR_TASK_ICONS } from '@/constants/aiGeneratorNav'

withDefaults(defineProps<{
  align?: 'center' | 'start'
}>(), {
  align: 'center',
})

const { selectedCategory, selectedTask, selectTask, notifyComingSoon } = useAiGeneratorNav()
const { availableTasks, categoryTasks } = useAiGeneratorTask()

const activeTask = computed(() => {
  const current = selectedTask.value
  if (availableTasks.value.some(task => task.value === current))
    return current

  return availableTasks.value[0]?.value || 'Image to Image'
})

function onTaskChange(value: string | number) {
  const nextTask = String(value) as AiTask
  const task = categoryTasks.value.find(entry => entry.value === nextTask)
  if (task?.comingSoon) {
    notifyComingSoon(nextTask)
    return
  }

  selectTask(selectedCategory.value, nextTask)
}
</script>

<template>
  <div class="w-full min-w-0 overflow-x-auto overscroll-x-contain no-scrollbar">
    <div
      class="flex w-max min-w-full"
      :class="align === 'start' ? 'justify-start' : 'justify-center'"
    >
      <Tabs
        :model-value="activeTask"
        class="mx-auto w-fit max-w-full"
        @update:model-value="onTaskChange"
      >
        <TabsList class="w-fit max-w-full flex-nowrap border border-border/70 bg-card/55 p-1 backdrop-blur-md supports-backdrop-filter:bg-card/45">
          <TabsTrigger
            v-for="task in categoryTasks"
            :key="task.value"
            :value="task.value"
            :class="[
              'flex-none shrink-0',
              task.comingSoon
                ? 'text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:text-muted-foreground dark:data-[state=active]:bg-transparent'
                : 'text-muted-foreground hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground',
            ]"
          >
            <Icon :name="AI_GENERATOR_TASK_ICONS[task.value]" />
            {{ task.value }}
            <span
              v-if="task.comingSoon"
              class="text-[10px] font-medium text-muted-foreground"
            >
              Soon
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  </div>
</template>
