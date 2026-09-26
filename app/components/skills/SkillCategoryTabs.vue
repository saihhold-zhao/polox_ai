<script setup lang="ts">
import type { SkillCategoryTab } from '~~/shared/utils/skillCategory'
import { SKILL_CATEGORY_LABELS } from '~~/shared/utils/skillCategory'

const props = withDefaults(defineProps<{
  modelValue: SkillCategoryTab
  /** Optional count badges per tab (hidden when undefined). */
  counts?: Partial<Record<SkillCategoryTab, number>>
  idPrefix?: string
  ariaLabel?: string
  /** id of the element these tabs control (tabpanel). */
  controls?: string
  testId?: string
}>(), {
  counts: undefined,
  idPrefix: 'skills-category-tab',
  ariaLabel: 'Skill category',
  controls: undefined,
  testId: undefined,
})

const emit = defineEmits<{ 'update:modelValue': [value: SkillCategoryTab] }>()

const TABS: Array<{ value: SkillCategoryTab, label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'utility', label: SKILL_CATEGORY_LABELS.utility },
  { value: 'fun', label: SKILL_CATEGORY_LABELS.fun },
]

function select(value: SkillCategoryTab) {
  if (value !== props.modelValue)
    emit('update:modelValue', value)
}

function onKeydown(event: KeyboardEvent, index: number) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key))
    return
  event.preventDefault()
  const last = TABS.length - 1
  let next = index
  if (event.key === 'ArrowLeft')
    next = index === 0 ? last : index - 1
  else if (event.key === 'ArrowRight')
    next = index === last ? 0 : index + 1
  else if (event.key === 'Home')
    next = 0
  else if (event.key === 'End')
    next = last
  select(TABS[next]!.value)
  const target = (event.currentTarget as HTMLElement | null)?.parentElement?.children[next] as HTMLElement | undefined
  target?.focus()
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="ariaLabel"
    :data-testid="testId"
    class="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-[3px]"
  >
    <button
      v-for="(tab, index) in TABS"
      :id="`${idPrefix}-${tab.value}`"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      :aria-controls="controls"
      :tabindex="modelValue === tab.value ? 0 : -1"
      :data-state="modelValue === tab.value ? 'active' : 'inactive'"
      class="inline-flex items-center justify-center rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:hover:text-primary-foreground"
      @click="select(tab.value)"
      @keydown="onKeydown($event, index)"
    >
      {{ tab.label }}
      <span
        v-if="counts && typeof counts[tab.value] === 'number'"
        class="ml-1.5 text-xs tabular-nums opacity-70"
      >{{ counts[tab.value] }}</span>
    </button>
  </div>
</template>
