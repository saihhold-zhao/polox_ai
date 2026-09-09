<script setup lang="ts">
import { IMAGE_EDITOR_PATH, studioToolBySlug, VIDEO_EDITOR_PATH } from '@/constants/usefulTools'

const route = useRoute()
const { public: publicConfig } = useRuntimeConfig()
const { selectedCategory } = useAiGeneratorCategory()
const { selectedTask } = useAiGeneratorTask()

const tool = computed(() => studioToolBySlug(String(route.params.slug || '')))
const isImageEditor = computed(() => tool.value?.slug === 'image-to-image')
const isVideoEditor = computed(() => tool.value?.slug === 'reference-to-video')
const isGeneratorEditor = computed(() => isImageEditor.value || isVideoEditor.value)

if (!tool.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Tool not found',
  })
}

watch(() => tool.value?.slug, (slug) => {
  if (slug === 'image-to-image') {
    selectedCategory.value = 'Image'
    selectedTask.value = 'Image to Image'
  }
  if (slug === 'reference-to-video') {
    selectedCategory.value = 'Video'
    selectedTask.value = 'Reference to Video'
  }
}, { immediate: true })

const pageUrl = computed(() => {
  const path = tool.value?.to || `/tools/${tool.value?.slug || ''}`
  return `https://polox.ai${path}`
})

const seoTitle = computed(() => {
  if (isImageEditor.value)
    return `AI Image Editor | Image to Image · ${publicConfig.brandName}`
  if (isVideoEditor.value)
    return `AI Video Editor | Reference to Video · ${publicConfig.brandName}`
  return `${tool.value?.title || 'Tool'} · ${publicConfig.brandName}`
})

const seoDescription = computed(() => tool.value?.description || '')

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: 'website',
  ogUrl: pageUrl,
  twitterTitle: seoTitle,
  twitterDescription: seoDescription,
  twitterCard: 'summary',
})

const jsonLd = computed(() => {
  if (!isGeneratorEditor.value || !tool.value)
    return null

  const appName = isVideoEditor.value ? 'AI Video Editor' : 'AI Image Editor'
  const offerPath = isVideoEditor.value ? VIDEO_EDITOR_PATH : IMAGE_EDITOR_PATH

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl.value}#webpage`,
        'url': pageUrl.value,
        'name': seoTitle.value,
        'description': seoDescription.value,
        'inLanguage': 'en',
        'isPartOf': {
          '@type': 'WebSite',
          'name': publicConfig.brandName,
          'url': 'https://polox.ai',
        },
      },
      {
        '@type': 'SoftwareApplication',
        'name': appName,
        'applicationCategory': isVideoEditor.value ? 'MultimediaApplication' : 'DesignApplication',
        'operatingSystem': 'Web',
        'url': pageUrl.value,
        'description': seoDescription.value,
        'offers': {
          '@type': 'Offer',
          'url': `https://polox.ai${offerPath}`,
          'availability': 'https://schema.org/InStock',
        },
      },
      {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          {
            '@type': 'ListItem',
            'position': 1,
            'name': 'Home',
            'item': 'https://polox.ai/',
          },
          {
            '@type': 'ListItem',
            'position': 2,
            'name': 'Useful tools',
            'item': 'https://polox.ai/',
          },
          {
            '@type': 'ListItem',
            'position': 3,
            'name': appName,
            'item': pageUrl.value,
          },
        ],
      },
    ],
  }
})

useHead({
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
  script: computed(() => {
    if (!jsonLd.value)
      return []
    return [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(jsonLd.value),
      },
    ]
  }),
})
</script>

<template>
  <div
    v-if="tool"
    class="mx-auto flex w-full max-w-[1128px] flex-col gap-5 md:gap-6"
  >
    <div class="flex flex-col gap-2">
      <p class="text-sm text-muted-foreground">
        {{ tool.group || 'Useful tools' }}
      </p>
      <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">
        {{ tool.title }}
      </h1>
      <p class="max-w-xl text-sm text-muted-foreground">
        {{ tool.description }}
      </p>
    </div>

    <ToolsRemoveBackgroundWorkspace v-if="tool.slug === 'remove-background'" />
    <ToolsImageLayerSplitterWorkspace v-else-if="tool.slug === 'image-layer-splitter'" />
    <AiGeneratorForm v-else-if="isGeneratorEditor" agent-handoff />

    <p
      v-if="isVideoEditor"
      class="max-w-2xl text-sm leading-relaxed text-muted-foreground"
    >
      The models above are reference-to-video AI models. Upload the video you want to edit as a
      reference video, then enter a prompt describing how you want to change it. You can also
      upload reference images and reference audio to replace objects, people, and sound in the video.
    </p>
  </div>
</template>
