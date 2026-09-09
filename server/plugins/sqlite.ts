import { startGenerationResumeLoop } from '../utils/generationPipeline'
import { migrateDefaultProjects } from '../utils/projects'
import { closeDatabase, connectDatabase } from '../utils/sqlite'

export default defineNitroPlugin(async (nitro) => {
  nitro.hooks.hook('close', closeDatabase)
  // Avoid Database/timers in prerender workers (keeps builds clean and exit-able).
  if (import.meta.prerender)
    return

  try {
    await connectDatabase()
  }
  catch (error) {
    console.error('[SQLite] Connection failed:', error)
    return
  }

  startGenerationResumeLoop()

  void migrateDefaultProjects().catch((error) => {
    console.error('[projects] Default project migration failed:', error)
  })
})
