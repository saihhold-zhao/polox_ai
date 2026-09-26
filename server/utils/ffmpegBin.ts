import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Resolve the ffmpeg binary: NUXT_FFMPEG_PATH / FFMPEG_PATH → optional
 * @ffmpeg-installer/ffmpeg (if the user installed it) → `ffmpeg` on PATH.
 */
export function ffmpegBin() {
  const fromEnv = String(process.env.NUXT_FFMPEG_PATH || process.env.FFMPEG_PATH || '').trim()
  if (fromEnv)
    return fromEnv
  try {
    const installer = require('@ffmpeg-installer/ffmpeg') as { path?: string }
    const path = String(installer?.path || '').trim()
    if (path)
      return path
  }
  catch {
    // Optional; OSS uses the system ffmpeg by default.
  }
  return 'ffmpeg'
}
