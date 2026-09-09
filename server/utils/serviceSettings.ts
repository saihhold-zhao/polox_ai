import { randomUUID } from 'node:crypto'
import { connectDatabase } from './sqlite'

export interface ServiceSettings {
  openRouterKey: string
  openRouterModel: string
  falKey: string
  revision: string
  openRouterOk: boolean
  falOk: boolean
  checkedAt: string
}
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-vision-exp'
export function readServiceSettings(): ServiceSettings {
  const db = connectDatabase()
  db.exec('CREATE TABLE IF NOT EXISTS local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  const row = db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get()
  return row ? JSON.parse(String(row.body)) : { openRouterKey: '', openRouterModel: DEFAULT_MODEL, falKey: '', revision: '', openRouterOk: false, falOk: false, checkedAt: '' }
}
export function writeServiceSettings(settings: ServiceSettings) {
  readServiceSettings()
  connectDatabase().prepare('INSERT INTO local_service_settings(id, body) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(JSON.stringify(settings))
}
export function updateServiceSettings(input: { openRouterKey?: string, openRouterModel?: string, falKey?: string }) {
  const current = readServiceSettings()
  const settings: ServiceSettings = {
    openRouterKey: input.openRouterKey === undefined ? current.openRouterKey : input.openRouterKey.trim(),
    openRouterModel: input.openRouterModel?.trim() || current.openRouterModel || DEFAULT_MODEL,
    falKey: input.falKey === undefined ? current.falKey : input.falKey.trim(),
    revision: randomUUID(),
    openRouterOk: false,
    falOk: false,
    checkedAt: '',
  }
  writeServiceSettings(settings)
  return settings
}
export function publicServiceStatus(settings = readServiceSettings()) {
  const fresh = Boolean(settings.checkedAt)
  return {
    openRouterConfigured: Boolean(settings.openRouterKey),
    falConfigured: Boolean(settings.falKey),
    openRouterModel: settings.openRouterModel,
    openRouterOk: fresh && settings.openRouterOk,
    falOk: fresh && settings.falOk,
    connected: fresh && settings.openRouterOk && settings.falOk,
    checkedAt: settings.checkedAt,
  }
}
