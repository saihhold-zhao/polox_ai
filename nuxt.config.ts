import tailwindcss from '@tailwindcss/vite'
import { USEFUL_TOOLS } from './app/constants/usefulTools'

const siteUrl = 'https://polox.ai'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  devServer: { port: 3001 },

  runtimeConfig: {
    public: {
      brandName: 'PoloX AI',
      discordUrl: 'https://discord.gg/FwN6s664Dh',
      companyName: 'Vision Forge Co., Ltd',
      heroTitle: 'Open-source. Agent-native.',
      heroTagline: 'creative platform.',
      heroDescription: 'Create images, videos, music, and more with leading generative AI models through the Polox Studio Agent. Just describe your vision and bring it to life through conversation.',
      apiUrl: '',
    },
  },

  css: ['~/assets/css/tailwind.css'],
  features: {
    // Include global Tailwind CSS in SSR HTML, not just Vue component styles.
    // Clarity captures inline styles; external CSS requests can be challenged
    // by Cloudflare, leaving recordings without layout, sizing, or colors.
    inlineStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      hmr: { port: 24679 },
      // Allow the cloudflared quick-tunnel host to reach the dev server
      // (e.g. https://xxx.trycloudflare.com). Wildcard keeps working when the
      // tunnel URL changes on each restart.
      allowedHosts: ['localhost', '.trycloudflare.com'],
    },
  },

  components: [
    {
      path: '~/components',
      extensions: ['.vue'],
    },
  ],

  modules: [
    'shadcn-nuxt',
    '@vueuse/nuxt',
    '@nuxt/eslint',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@nuxtjs/color-mode',
    '@nuxt/fonts',
    '@nuxtjs/sitemap',
  ],

  site: {
    url: siteUrl,
    name: 'PoloX AI',
  },

  sitemap: {
    // Emit /sitemap.xml during `nuxt build` and drop runtime sitemap handlers.
    zeroRuntime: true,
    excludeAppSources: ['nuxt:route-rules'],
    exclude: [
      '/projects',
      '/projects/**',
      '/404',
      '/500',
      '/503',
      '/agent-lab',
      '/image-editor',
      '/ai-image-editor',
      '/video-editor',
      '/ai-video-editor',
      '/settings',
      '/settings/**',
      '/nuxt-shadcn-dashboard',
      '/nuxt-shadcn-dashboard/**',
      '/components',
      '/components/**',
    ],
    urls: [
      ...USEFUL_TOOLS.map(tool => tool.to || `/tools/${tool.slug}`),
    ],
  },

  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * @default "~/components/ui"
     */
    componentDir: '~/components/ui',
  },

  colorMode: {
    classSuffix: '',
    preference: 'dark',
    fallback: 'dark',
    storageKey: 'polox-color-mode',
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  fonts: {
    defaults: {
      weights: [300, 400, 500, 600, 700, 800],
    },
    providers: {
      google: false,
      googleicons: false,
    },
  },

  app: {
    baseURL: '/',
    head: {
      title: 'PoloX AI',
      meta: [
        {
          name: 'description',
          content: 'Create images, videos, music, and more with leading generative AI models through the Polox Studio Agent. Just describe your vision and bring it to life through conversation.',
        },
      ],
    },
  },

  routeRules: {
    '/nuxt-shadcn-dashboard': { redirect: '/' },
    '/nuxt-shadcn-dashboard/**': { redirect: '/**' },
    '/components': { redirect: '/components/accordion' },
    '/my/generations': { redirect: '/projects' },
    '/models/seedream-5-pro': { redirect: '/seedream' },
    '/models/wan-3': { redirect: '/wan-3' },
    '/wan3': { redirect: '/wan-3' },
    '/models/gpt-image-2': { redirect: '/gpt-image-2' },
    '/chatgpt-images-2': { redirect: '/gpt-image-2' },
    '/image-editor': { redirect: '/tools/image-to-image' },
    '/ai-image-editor': { redirect: '/tools/image-to-image' },
    '/video-editor': { redirect: '/tools/reference-to-video' },
    '/ai-video-editor': { redirect: '/tools/reference-to-video' },
  },

  imports: {
    dirs: ['./lib'],
  },

  compatibilityDate: '2026-03-13',

  nitro: {
    imports: {
      // Agent runtime is imported explicitly; avoid clashing with shared/* type names.
      exclude: [
        /server\/agent\//,
      ],
    },
    prerender: {
      routes: ['/sitemap.xml'],
      ignore: [
        '/examples/forms',
        '/components/pagination',
        '/docs',
      ],
    },
  },
})
