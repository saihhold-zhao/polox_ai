export function useServiceConnection() {
  const dialogOpen = useState<boolean>('service-connection-dialog', () => false)
  async function ensureConnected() {
    try {
      const status = await $fetch<{ connected: boolean }>('/api/settings/services', { timeout: 5000 })
      if (status.connected)
        return true
    }
    catch {
      // Fail closed when the local connection status cannot be read.
    }
    dialogOpen.value = true
    return false
  }
  return { dialogOpen, ensureConnected }
}
