const LEGACY_PREFIX = '/nuxt-shadcn-dashboard'

export default defineNuxtRouteMiddleware((to) => {
  if (to.path !== LEGACY_PREFIX && !to.path.startsWith(`${LEGACY_PREFIX}/`))
    return

  const nextPath = to.path.slice(LEGACY_PREFIX.length) || '/'

  return navigateTo({
    path: nextPath,
    query: to.query,
    hash: to.hash,
  }, { replace: true })
})
