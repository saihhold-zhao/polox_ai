import type { ServiceSettings } from './serviceSettings'
import { createFalClient } from '@fal-ai/client'
import { publicServiceStatus, readServiceSettings, writeServiceSettings } from './serviceSettings'

async function checkOpenRouter(settings: ServiceSettings) {
  if (!settings.openRouterKey)
    return { ok: false, message: 'OpenRouter API key is not configured.' }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Authorization': `Bearer ${settings.openRouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.openRouterModel, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 8, stream: false }),
    })
    const payload = await response.json()
    if (!response.ok || payload.error || !Array.isArray(payload.choices) || !payload.choices.length)
      return { ok: false, message: `OpenRouter test failed (${response.status}). Check your key, model name and available balance.` }
    return { ok: true, message: 'OpenRouter model responded successfully.' }
  }
  catch { return { ok: false, message: 'OpenRouter could not be reached. Check your connection and try again.' } }
}
async function checkFal(settings: ServiceSettings) {
  if (!settings.falKey)
    return { ok: false, message: 'fal API key is not configured.' }
  try {
    const client = createFalClient({ credentials: settings.falKey })
    // Authenticate against the model queue without creating a paid generation.
    const response = await fetch('https://queue.fal.run/openai/gpt-image-2/requests/00000000-0000-0000-0000-000000000000/status', {
      headers: { Authorization: `Key ${settings.falKey}` },
      signal: AbortSignal.timeout(15000),
    })
    if (response.status !== 404)
      return { ok: false, message: `fal authentication failed (${response.status}). Check your API key and account.` }
    // A successful authenticated CDN upload confirms the key, rather than trusting a 404 alone.
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const url = await client.storage.upload(new File([bytes], 'connection-test.png', { type: 'image/png' }))
    const file = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!file.ok)
      return { ok: false, message: 'fal upload succeeded but its CDN could not be reached.' }
    await file.arrayBuffer()
    return { ok: true, message: 'fal authentication and file upload succeeded.' }
  }
  catch { return { ok: false, message: 'fal test failed. Check your API key, account and connection.' } }
}
async function boundedFal(settings: ServiceSettings) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([checkFal(settings), new Promise<{ ok: boolean, message: string }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, message: 'fal connection test timed out. Please try again.' }), 45000)
    })])
  }
  finally { clearTimeout(timer) }
}
export async function testServiceConnections(settings: ServiceSettings) {
  const [openRouter, fal] = await Promise.all([checkOpenRouter(settings), boundedFal(settings)])
  if (readServiceSettings().revision !== settings.revision)
    return { ...publicServiceStatus(), openRouter, fal, superseded: true }
  const checked = { ...settings, openRouterOk: openRouter.ok, falOk: fal.ok, checkedAt: new Date().toISOString() }
  writeServiceSettings(checked)
  return { ...publicServiceStatus(checked), openRouter, fal, superseded: false }
}
