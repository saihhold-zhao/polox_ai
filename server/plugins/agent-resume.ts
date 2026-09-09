import { startSessionResumeLoop } from '../agent/resume'

export default defineNitroPlugin(() => {
  // Prerender/build workers must not open the resume interval or the build never exits.
  if (import.meta.prerender)
    return
  // Resume in-flight agent generations after process boot.
  startSessionResumeLoop()
})
