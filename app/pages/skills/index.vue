<script setup lang="ts">
import { useSkillCreatorLaunch } from '~/composables/useSkillCreatorLaunch'
import { FolderOpen, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'
import type { SkillCategory, SkillCategoryTab } from '~~/shared/utils/skillCategory'
import { countSkillsByCategory, filterSkillsByCategory, normalizeSkillCategory, SKILL_CATEGORIES, SKILL_CATEGORY_LABELS } from '~~/shared/utils/skillCategory'
import SkillCategoryTabs from '~/components/skills/SkillCategoryTabs.vue'

interface UserSkillRow {
  id: string
  name: string
  description: string
  keywords?: string
  enabled: boolean
  category?: SkillCategory
  version?: string
  source?: string
  updatedAt?: string | Date
}

const COMPOSER_DRAFT_KEY = 'polox-agent-composer-draft'
const EDIT_BRIEF_KEY = 'polox-edit-skill-brief'

const { public: publicConfig } = useRuntimeConfig()
const { createDraftAndOpenEditor, priming } = useSkillCreatorLaunch()
const { ensureSkillProject } = useProjects()

useSeoMeta({
  title: `My Skills · ${publicConfig.brandName}`,
  description: 'Manage custom user skills you created with Skill Creator',
})

const skills = ref<UserSkillRow[]>([])
const loaded = ref(false)
const loading = ref(false)
const loadError = ref('')
const busyId = ref('')
const editingId = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deletingSkill = ref<UserSkillRow | null>(null)
const activeCategory = ref<SkillCategoryTab>('all')
const categoryCounts = computed(() => countSkillsByCategory(skills.value))
const visibleSkills = computed(() => filterSkillsByCategory(skills.value, activeCategory.value))

async function loadSkills() {
  if (loading.value)
    return
  loading.value = true
  loadError.value = ''
  try {
    const data = await $fetch<{ userSkills?: UserSkillRow[] }>('/api/skills')
    skills.value = [...(data.userSkills || [])].map(row => ({ ...row, category: normalizeSkillCategory(row.category) })).sort((a, b) => {
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return bt - at
    })
    loaded.value = true
  }
  catch (error) {
    loadError.value = readErrorMessage(error, 'Could not load your skills')
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadSkills()
})

async function toggleEnabled(skill: UserSkillRow, enabled: boolean) {
  if (busyId.value)
    return
  busyId.value = skill.id
  const previous = skill.enabled
  skill.enabled = enabled
  try {
    await $fetch(`/api/skills/${encodeURIComponent(skill.id)}`, {
      method: 'PATCH',
      body: { enabled },
    })
  }
  catch (error) {
    skill.enabled = previous
    toast.error(readErrorMessage(error, 'Could not update skill'))
  }
  finally {
    busyId.value = ''
  }
}

function openDelete(skill: UserSkillRow) {
  deletingSkill.value = skill
  deleteOpen.value = true
}

async function confirmDelete() {
  if (deleting.value || !deletingSkill.value)
    return
  deleting.value = true
  const id = deletingSkill.value.id
  try {
    await $fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
    skills.value = skills.value.filter(item => item.id !== id)
    deleteOpen.value = false
    deletingSkill.value = null
    toast.success('Skill deleted')
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not delete skill'))
  }
  finally {
    deleting.value = false
  }
}

async function changeCategory(skill: UserSkillRow, value: unknown) {
  const next = normalizeSkillCategory(value)
  if (busyId.value || next === normalizeSkillCategory(skill.category))
    return
  busyId.value = skill.id
  const previous = skill.category
  skill.category = next
  try {
    const data = await $fetch<{ skill?: UserSkillRow }>(`/api/skills/${encodeURIComponent(skill.id)}`, {
      method: 'PATCH',
      body: { category: next },
    })
    skill.category = normalizeSkillCategory(data.skill?.category ?? next)
    toast.success(`Moved to ${SKILL_CATEGORY_LABELS[skill.category]}`)
  }
  catch (error) {
    skill.category = previous
    toast.error(readErrorMessage(error, 'Could not update category'))
  }
  finally {
    busyId.value = ''
  }
}

async function editSkill(skill: UserSkillRow) {
  if (editingId.value)
    return
  editingId.value = skill.id
  try {
    const exported = await $fetch<{
      skill?: { markdown?: string, name?: string, id?: string, status?: string }
      markdown?: string
    }>(`/api/skills/${encodeURIComponent(skill.id)}/export`)
    const markdown = exported.skill?.markdown || exported.markdown || ''
    if (!markdown.trim())
      throw new Error('Skill export did not include markdown')

    const skillId = exported.skill?.id || skill.id
    const skillName = exported.skill?.name || skill.name
    const brief = [
      'INTERNAL_EDIT_CONTEXT (do not paste full markdown back to the user):',
      'Edit this existing user skill in place.',
      `Current skill id: ${skillId}`,
      `Current skill name: ${skillName}`,
      `Status: ${exported.skill?.status || (skill.enabled ? 'published' : 'draft')}.`,
      `Current skill category: ${normalizeSkillCategory(skill.category)}`,
      '',
      'Current skill markdown:',
      '```markdown',
      markdown,
      '```',
      '',
      'Prefer keeping the same id unless the user asks to rename it. After clarifying changes, ask_user for display name / trigger if needed, then save with save_user_skill. Right before the final exit, re-judge Utility vs Fun from the skill purpose, then ask_user skill_category with your judgment first + recommended + one-line reason, and pass the option the user picked as category on the final save_user_skill + exit_skill_creator. WIP may use status:"draft"; final exit ask_user is save_and_exit or test_now. Do not dump the full SKILL.md into chat unless they ask.',
      '<<<END_INTERNAL_EDIT_CONTEXT>>>',
    ].join('\n')

    if (import.meta.client) {
      sessionStorage.setItem('polox-agent-composer-draft', '/skill-creator')
      sessionStorage.setItem('polox-edit-skill-brief', brief)
      sessionStorage.setItem('polox-skill-test-id', skillId)
      sessionStorage.setItem('polox-skill-test-name', skillName)
    }

    const project = await ensureSkillProject({
      skillId,
      name: skillName,
      description: `Workspace for /${skillId}`,
    })
    await navigateTo({
      path: `/projects/${project.id}`,
      query: { mode: 'agent', agentSkill: 'skill-creator', skillMode: 'edit' },
    })
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not open skill editor'))
  }
  finally {
    editingId.value = ''
  }
}


async function testSkill(skill: UserSkillRow) {
  if (!skill.enabled) {
    toast.error('Enable the skill before opening Test.')
    return
  }
  try {
    const project = await ensureSkillProject({
      skillId: skill.id,
      name: skill.name,
      description: `Workspace for /${skill.id}`,
    })
    if (import.meta.client) {
      sessionStorage.setItem('polox-skill-test-id', skill.id)
      sessionStorage.setItem('polox-skill-test-name', skill.name)
    }
    await navigateTo({
      path: `/projects/${project.id}`,
      query: { mode: 'agent', skillMode: 'test' },
    })
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not open skill test'))
  }
}

function goCreate() {
  void createDraftAndOpenEditor({
    autosend: false,
    placeholder: 'Describe the skill you want to create…',
  })
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1128px] flex-col gap-5 md:gap-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">
          My Skills
        </h1>
        <p class="text-sm text-muted-foreground">
          Custom L1 skills saved with Skill Creator. Enable them for the catalog, or edit in place.
        </p>
      </div>
      <Button
        type="button"
        class="shrink-0 rounded-xl shadow-none"
        @click="goCreate"
      >
        <Plus class="size-4" aria-hidden="true" />
        Create Skill
      </Button>
    </div>

    <div
      v-if="loadError"
      class="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <p>{{ loadError }}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="mt-3 rounded-lg shadow-none"
        :disabled="loading"
        @click="loadSkills"
      >
        Retry
      </Button>
    </div>

    <div
      v-else-if="!loaded || loading"
      class="rounded-2xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
    >
      Loading your skills…
    </div>

    <div
      v-else-if="!skills.length"
      class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center"
    >
      <FolderKanban class="size-10 text-muted-foreground/70" aria-hidden="true" />
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-medium text-foreground">
          No custom skills yet
        </h2>
        <p class="text-sm text-muted-foreground">
          Create an L1 skill that orchestrates existing tools — no custom code required.
        </p>
      </div>
      <Button
        type="button"
        class="mt-1 rounded-xl shadow-none"
        @click="goCreate"
      >
        <Plus class="size-4" aria-hidden="true" />
        Create Skill
      </Button>
    </div>

    <template v-else>
    <SkillCategoryTabs
      v-model="activeCategory"
      id-prefix="my-skills-category-tab"
      aria-label="Skill category"
      controls="my-skills-list"
      test-id="my-skills-category-tabs"
      :counts="categoryCounts"
      class="mb-3"
    />
    <p
      v-if="!visibleSkills.length"
      class="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-10 text-center text-sm text-muted-foreground"
      role="status"
    >
      No {{ activeCategory === 'fun' ? 'Fun' : 'Utility' }} skills yet.
    </p>
    <ul
      v-else
      id="my-skills-list"
      role="tabpanel"
      :aria-labelledby="`my-skills-category-tab-${activeCategory}`"
      class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <li
        v-for="skill in visibleSkills"
        :key="skill.id"
        class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-none"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-medium text-foreground">
              {{ skill.name }}
            </h2>
            <p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              /{{ skill.id }}
            </p>
          </div>
          <Badge
            class="shrink-0 border-transparent"
            :class="skill.enabled
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground hover:bg-muted'"
          >
            {{ skill.enabled ? 'Enabled' : 'Disabled' }}
          </Badge>
        </div>

        <p class="line-clamp-3 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {{ skill.description || 'No description' }}
        </p>

        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted-foreground">Category</span>
          <Select
            :model-value="skill.category || 'utility'"
            :disabled="busyId === skill.id"
            @update:model-value="(value) => changeCategory(skill, value)"
          >
            <SelectTrigger
              size="sm"
              class="h-8 w-[120px] rounded-lg shadow-none"
              :aria-label="`Category for ${skill.name}`"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in SKILL_CATEGORIES"
                :key="option"
                :value="option"
              >
                {{ SKILL_CATEGORY_LABELS[option] }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch
              :model-value="skill.enabled"
              :disabled="busyId === skill.id"
              :aria-label="`Enable ${skill.name}`"
              @update:model-value="(value) => toggleEnabled(skill, Boolean(value))"
            />
            <span>{{ skill.enabled ? 'On' : 'Off' }}</span>
          </label>

          <div class="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="rounded-lg shadow-none"
              :disabled="editingId === skill.id || busyId === skill.id || priming"
              @click="editSkill(skill)"
            >
              <Pencil class="size-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button
              v-if="skill.enabled"
              type="button"
              variant="ghost"
              size="sm"
              class="rounded-lg shadow-none"
              :disabled="busyId === skill.id"
              @click="testSkill(skill)"
            >
              <FolderOpen class="size-3.5" aria-hidden="true" />
              Test
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="rounded-lg text-destructive shadow-none hover:text-destructive"
              :disabled="busyId === skill.id"
              @click="openDelete(skill)"
            >
              <Trash2 class="size-3.5" aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      </li>
    </ul>
    </template>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete skill?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes
            <span class="font-medium text-foreground">{{ deletingSkill?.name }}</span>
            (<span class="font-mono">/{{ deletingSkill?.id }}</span>).
            You can recreate it later with Skill Creator.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            :disabled="deleting"
            @click.prevent="confirmDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
