/** Serialize refreshes, retaining one follow-up when data changes during a request. */
export function createQueuedRefresh(refresh: () => Promise<void>) {
  let running: Promise<void> | null = null
  let dirty = false
  return () => {
    dirty = true
    if (!running) {
      running = Promise.resolve().then(async () => {
        while (dirty) {
          dirty = false
          try {
            await refresh()
          }
          catch {
            // A balance read must not interrupt generation; the next event retries.
          }
        }
      }).finally(() => { running = null })
    }
    return running
  }
}
