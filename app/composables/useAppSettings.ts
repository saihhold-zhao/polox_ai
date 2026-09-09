import type { AppSettings } from '~/types/appSettings'

import { createDefu } from 'defu'

const customDefu = createDefu((obj, key, value) => {
  if (Array.isArray(value) && value.every((x: any) => typeof x === 'string')) {
    obj[key] = value
    return true
  }
})

const defaultAppSettings: AppSettings = {
  sidebar: {
    collapsible: 'offcanvas',
    side: 'left',
    variant: 'sidebar',
  },
  theme: {
    color: 'green',
    type: 'mono',
  },
}

interface StoredAppSettings {
  version: 1
  overrides: AppSettings
}

function isStoredAppSettings(value: unknown): value is StoredAppSettings {
  if (!value || typeof value !== 'object')
    return false

  const storedValue = value as Partial<StoredAppSettings>
  return storedValue.version === 1
    && !!storedValue.overrides
    && typeof storedValue.overrides === 'object'
}

export function useAppSettings() {
  const { appSettings } = useAppConfig()

  const processedConfig = customDefu(appSettings, defaultAppSettings)

  const cookieAppSettings = useCookie<StoredAppSettings | null>('app_settings', {
    default: () => null,
  })

  // Previous versions stored the fully resolved settings in the cookie. That
  // made stale defaults (for example blue/default) override app.config.ts.
  // Reset the legacy shape once, then persist only explicit user overrides.
  if (!isStoredAppSettings(cookieAppSettings.value)) {
    cookieAppSettings.value = {
      version: 1,
      overrides: {},
    }
  }

  const resolvedSettings = computed(() => customDefu(
    cookieAppSettings.value?.overrides ?? {},
    processedConfig,
  ))

  const updateAppSettings = (settings: AppSettings) => {
    cookieAppSettings.value = {
      version: 1,
      overrides: customDefu(
        settings,
        cookieAppSettings.value?.overrides ?? {},
      ),
    }
  }

  return {
    updateAppSettings,
    sidebar: computed(() => resolvedSettings.value.sidebar),
    theme: computed(() => resolvedSettings.value.theme),
  }
}
