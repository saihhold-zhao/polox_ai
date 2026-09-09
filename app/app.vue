<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'

const { theme } = useAppSettings()
useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: '#09090b' },
  ],
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon-polox.ico' },
    { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/brand/polox-favicon.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
  ],
  htmlAttrs: {
    lang: 'en',
  },
  bodyAttrs: {
    class: computed(() => `color-${theme.value?.color || 'green'} theme-${theme.value?.type || 'mono'} theme-rounded-none`),
  },
})
const { public: publicConfig } = useRuntimeConfig()
const title = publicConfig.brandName
const description = publicConfig.heroDescription
useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterTitle: title,
  twitterDescription: description,
})
const textDirection = useTextDirection({ initialValue: 'ltr' })
const dir = computed(() => textDirection.value === 'rtl' ? 'rtl' : 'ltr')
</script>

<template>
  <Body class="overscroll-none antialiased bg-background text-foreground theme-rounded-none" :class="[`color-${theme?.color || 'green'}`, `theme-${theme?.type || 'mono'}`]">
    <ConfigProvider :dir="dir">
      <div id="app" vaul-drawer-wrapper class="relative">
        <NuxtLayout>
          <NuxtPage />
        </NuxtLayout>

        <!-- <AppSettings /> -->
        <ClientOnly>
          <MediaLightbox />
        </ClientOnly>
      </div>

      <Toaster
        position="top-right"
        theme="dark"
        rich-colors
        close-button
      />
    </ConfigProvider>
  </Body>
</template>
