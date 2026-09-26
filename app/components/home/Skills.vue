<script setup lang="ts">
import type { SkillCategoryTab } from '~~/shared/utils/skillCategory'
import { ArrowRight, FolderKanban, Image as ImageIcon, WandSparkles } from 'lucide-vue-next'
import { mergeAgentSkillCatalog, PUBLIC_AGENT_SKILLS, type CatalogAgentSkill } from '~~/shared/utils/agentSkills'
import { countSkillsByCategory, filterSkillsByCategory, normalizeSkillCategory } from '~~/shared/utils/skillCategory'
import SkillCategoryTabs from '~/components/skills/SkillCategoryTabs.vue'

const emit = defineEmits<{ select: [skillId: string] }>()

const { data } = await useFetch<{
  catalog?: CatalogAgentSkill[]
  userSkills?: Array<{ id: string, name: string, description: string, keywords?: string, cover?: string, category?: string, enabled: boolean }>
}>('/api/skills', { default: () => ({ catalog: [], userSkills: [] }) })

// One unified list (builtin + your enabled skills), split only by the utility / fun category tabs.
const activeCategory = ref<SkillCategoryTab>('all')

const allSkills = computed(() => {
  const merged = data.value?.catalog?.length
    ? data.value.catalog
    : mergeAgentSkillCatalog((data.value?.userSkills || []).map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        keywords: skill.keywords,
        cover: skill.cover,
        icon: 'lucide:sparkles',
        source: 'user' as const,
        category: normalizeSkillCategory(skill.category),
        enabled: skill.enabled,
      })))
  return merged
    .filter(skill => skill.id !== 'skill-creator')
    .map(skill => ({ ...skill, category: normalizeSkillCategory(skill.category) }))
    .sort((a, b) => {
      const pinned = ['product-hunt-gallery', 'app-store-graphics']
      return Number(pinned.includes(a.id)) - Number(pinned.includes(b.id))
    })
})

const categoryCounts = computed(() => countSkillsByCategory(allSkills.value))
const skills = computed(() => filterSkillsByCategory(allSkills.value, activeCategory.value))

function coverFor(skill: CatalogAgentSkill) {
  return skill.cover || PUBLIC_AGENT_SKILLS.find(item => item.id === skill.id)?.cover || ''
}

function coverAltFor(skill: CatalogAgentSkill) {
  return skill.coverAlt || skill.name
}

// Same flow as Skills → Create Skill: open a Skill Creator project in Edit mode.
const { createDraftAndOpenEditor } = useSkillCreatorLaunch()
const creatingSkill = ref(false)
async function goCreateSkill() {
  if (creatingSkill.value)
    return
  creatingSkill.value = true
  try {
    await createDraftAndOpenEditor({ placeholder: 'Describe the skill you want to create…' })
  }
  finally {
    creatingSkill.value = false
  }
}
</script>

<template>
  <section
    id="skills"
    aria-labelledby="home-skills-heading"
    class="flex flex-col gap-4"
  >
    <div class="flex flex-col gap-1.5">
      <!-- Title + actions share one row at every width; actions compact to icons below sm. -->
      <div class="flex flex-nowrap items-center justify-between gap-3">
        <h2 id="home-skills-heading" class="min-w-0 truncate text-2xl font-semibold tracking-tight md:text-3xl">
          Skills
        </h2>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Create Skill"
            title="Create Skill"
            :disabled="creatingSkill"
            class="inline-flex size-9 items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-auto sm:px-3"
            @click="goCreateSkill"
          >
            <WandSparkles class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">Create Skill</span>
          </button>
          <NuxtLink
            to="/skills"
            aria-label="My Skills"
            title="My Skills"
            class="inline-flex size-9 items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:px-3"
          >
            <FolderKanban class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">My Skills</span>
          </NuxtLink>
        </div>
      </div>
      <p class="text-sm text-muted-foreground">
        Bring your ideas to life with AI-powered creative workflows.
      </p>
    </div>

    <div class="-mx-1 max-w-full overflow-x-auto overscroll-x-contain px-1 no-scrollbar">
      <SkillCategoryTabs
        v-model="activeCategory"
        id-prefix="home-skills-category-tab"
        aria-label="Skill category"
        controls="home-skills-panel"
        test-id="home-skills-category-tabs"
        :counts="categoryCounts"
      />
    </div>

    <p
      v-if="activeCategory !== 'all' && !skills.length"
      class="text-sm text-muted-foreground"
      role="status"
    >
      No {{ activeCategory === 'fun' ? 'Fun' : 'Utility' }} skills here yet.
    </p>

    <div
      id="home-skills-panel"
      role="tabpanel"
      :aria-labelledby="`home-skills-category-tab-${activeCategory}`"
      class="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <NuxtLink
        v-for="skill in skills"
        :key="skill.id"
        :to="{ path: '/', query: { agentSkill: skill.id }, hash: '#generator' }"
        :aria-label="`Use ${skill.name} skill`"
        class="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-none transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click.prevent="emit('select', skill.id)"
      >
        <div class="relative aspect-[4/3] overflow-hidden bg-muted">
          <img
            v-if="coverFor(skill)"
            :src="coverFor(skill)"
            :alt="coverAltFor(skill)"
            width="720"
            height="540"
            loading="lazy"
            decoding="async"
            class="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          >
          <div
            v-else
            class="flex size-full items-center justify-center bg-muted"
            aria-hidden="true"
          >
            <ImageIcon class="size-10 text-muted-foreground/70" />
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-1 px-3 pb-3 pt-2 md:px-3.5 md:pb-3.5 md:pt-2.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex flex-col gap-0.5">
              <h3 class="text-base font-medium text-foreground">
                {{ skill.name }}
              </h3>
              <p class="font-mono text-xs text-muted-foreground">
                /{{ skill.id }}
              </p>
            </div>
            <ArrowRight class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
          </div>
          <p class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {{ skill.description }}
          </p>
        </div>
      </NuxtLink>
    </div>
  </section>
</template>
