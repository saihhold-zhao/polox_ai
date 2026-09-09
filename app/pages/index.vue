<script setup lang="ts">
import type { FrontierModelCard } from '@/constants/aiModels'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import HomeFrontierModels from '@/components/home/FrontierModels.vue'
import HomeRecentProjects from '@/components/home/RecentProjects.vue'
import HomeUsefulTools from '@/components/home/UsefulTools.vue'

const { public: publicConfig } = useRuntimeConfig()
const route = useRoute()
const { selectHomeAgent } = useAgentWorkspaceNav()

const agentComposer = useTemplateRef('agentComposer')

async function selectAgentModel(modelId: string) {
  selectHomeAgent()
  await nextTick()
  await agentComposer.value?.mentionModel(modelId)
  document.getElementById('generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  selectHomeAgent()
  watch(() => route.query.agentTask, async (task) => {
    if (task !== 'image-to-image' && task !== 'reference-to-video')
      return
    const { agentTask: _agentTask, ...query } = route.query
    await navigateTo({ path: '/', query, hash: route.hash }, { replace: true })
    selectHomeAgent()
    await nextTick()
    document.getElementById('generator')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    await agentComposer.value?.mentionTask(task)
  }, { immediate: true })
  watch(() => route.query.agentModel || route.query.model, async (modelId) => {
    if (typeof modelId !== 'string' || !AGENT_MODELS.some(model => model.id === modelId))
      return
    const { agentModel: _agentModel, model: _model, ...query } = route.query
    await navigateTo({ path: '/', query, hash: route.hash }, { replace: true })
    await selectAgentModel(modelId)
  }, { immediate: true })
})

function selectFrontierModel(card: FrontierModelCard) {
  void selectAgentModel(card.modelId)
}

useSeoMeta({
  title: `${publicConfig.brandName} | ${publicConfig.heroDescription}`,
  description: publicConfig.heroDescription,
  ogTitle: `${publicConfig.brandName} | ${publicConfig.heroDescription}`,
  ogDescription: publicConfig.heroDescription,
})
</script>

<template>
  <div class="relative mx-auto flex w-full max-w-[1128px] flex-col gap-5 md:gap-6">
    <div class="relative isolate">
      <HomeHeroVideoBackground />

      <div class="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
        <h1 class="text-[2.55rem] font-semibold leading-[1.03] tracking-[-0.045em] text-balance text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)] md:text-[3.25rem]">
          <span class="block">{{ publicConfig.heroTitle }}</span>
          <span class="block">{{ publicConfig.heroTagline }}</span>
        </h1>
        <h2 class="max-w-[44rem] text-[0.95rem] font-normal leading-relaxed text-zinc-300 drop-shadow-[0_1px_12px_rgba(0,0,0,0.9)] md:text-lg">
          {{ publicConfig.heroDescription }}
        </h2>
      </div>
    </div>

    <div class="relative z-10 -mt-4 w-full pt-5 md:-mt-6 md:pt-6">
      <div id="generator" class="flex flex-col gap-5 overflow-hidden rounded-2xl border border-border/70 bg-card/35 p-4 shadow-none backdrop-blur-xl supports-backdrop-filter:bg-card/25 md:gap-6 md:p-5">
        <HomeAgentComposer ref="agentComposer" embedded compact new-agent-on-send class="w-full" />
      </div>
    </div>

    <HomeRecentProjects />

    <div class="flex flex-col gap-5 md:gap-6">
      <HomeFrontierModels @select="selectFrontierModel" />
      <HomeUsefulTools />
    </div>

    <a
      href="https://theresanaiforthat.com/ai/polox-ai/?ref=featured&v=8794914"
      target="_blank"
      rel="nofollow noopener noreferrer"
      class="mx-auto mt-1 inline-flex opacity-90 transition-opacity duration-150 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src="https://media.theresanaiforthat.com/featured-on-taaft.png?width=600"
        alt="Featured on There's An AI For That"
        width="180"
        height="54"
        class="h-auto w-[180px]"
      >
    </a>
  </div>
</template>
