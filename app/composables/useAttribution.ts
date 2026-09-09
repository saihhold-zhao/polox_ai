import { ATTRIBUTION_COOKIE } from '../../shared/constants/attribution'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function cookieOptions() {
  return {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax' as const,
  }
}

function normalizeLandingPath(path: string) {
  if (!path || path === '/')
    return ''

  return path
}

function isExternalReferrer(referrer: string) {
  if (!referrer)
    return false

  try {
    const referrerOrigin = new URL(referrer).origin
    return referrerOrigin !== window.location.origin
  }
  catch {
    return false
  }
}

export function useAttribution() {
  const route = useRoute()
  const sourceCookie = useCookie(ATTRIBUTION_COOKIE.source, cookieOptions())
  const landingCookie = useCookie(ATTRIBUTION_COOKIE.landing, cookieOptions())
  const trackedCookie = useCookie(ATTRIBUTION_COOKIE.tracked, cookieOptions())

  function captureVisit() {
    if (trackedCookie.value)
      return

    landingCookie.value = normalizeLandingPath(route.path)
    sourceCookie.value = isExternalReferrer(document.referrer) ? document.referrer.slice(0, 1000) : ''
    trackedCookie.value = '1'
  }

  return {
    captureVisit,
  }
}
