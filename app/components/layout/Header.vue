<script setup lang="ts">
import { studioToolBySlug } from '@/constants/usefulTools'

const route = useRoute()

function titleForSegment(item: string, href: string) {
  if (item === 'tools')
    return 'Useful tools'

  if (item === 'projects')
    return 'Projects'

  if (item === 'agent')
    return 'Studio Agent'

  if (item === 'seedream')
    return 'Seedream 5.0 Pro'

  if (item === 'flux-3')
    return 'FLUX 3'

  if (item === 'minimax-h3')
    return 'MiniMax H3'

  if (item === 'wan-3')
    return 'Wan 3.0'

  if (item === 'gpt-image-2')
    return 'GPT Image 2'

  if (href.startsWith('/projects/') && item !== 'projects')
    return 'Project'

  if (href.startsWith('/tools/')) {
    const slug = href.slice('/tools/'.length).split('/')[0] || ''
    return studioToolBySlug(slug)?.title
      || item.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  return item
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function setLinks() {
  if (route.path === '/') {
    return [{ title: 'Home', href: '/' }]
  }

  const segments = route.path.split('/').filter(item => item !== '')

  const breadcrumbs = segments.map((item, index) => {
    const href = item === 'tools'
      ? '/'
      : `/${segments.slice(0, index + 1).join('/')}`
    return {
      title: titleForSegment(item, `/${segments.slice(0, index + 1).join('/')}`),
      href,
    }
  })

  return [{ title: 'Home', href: '/' }, ...breadcrumbs]
}

const links = ref<{
  title: string
  href: string
}[]>(setLinks())

watch(() => route.path, (val) => {
  if (val) {
    links.value = setLinks()
  }
})
</script>

<template>
  <header class="sticky top-0 z-10 flex h-(--header-height) items-center gap-4 border-b border-border/70 bg-background/95 px-4 backdrop-blur md:peer-data-[variant=inset]:top-0 md:rounded-tl-xl md:rounded-tr-xl md:px-6">
    <div class="flex items-center gap-4">
      <SidebarTrigger />
      <div class="hidden items-center gap-4 md:flex">
        <Separator orientation="vertical" class="h-5 bg-border/70" />
        <BaseBreadcrumbCustom :links="links" />
      </div>
    </div>
    <div class="ml-auto flex items-center">
      <ServiceConnection />
      <slot />
    </div>
  </header>
</template>

<style scoped>

</style>
