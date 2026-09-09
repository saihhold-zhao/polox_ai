const LEGACY_PREFIX = '/nuxt-shadcn-dashboard'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)

  if (url.pathname !== LEGACY_PREFIX && !url.pathname.startsWith(`${LEGACY_PREFIX}/`))
    return

  const nextPath = url.pathname.slice(LEGACY_PREFIX.length) || '/'

  return sendRedirect(event, `${nextPath}${url.search}`, 301)
})
