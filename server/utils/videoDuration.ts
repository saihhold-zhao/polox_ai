import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { storedMediaFile, storedMediaKey } from './localMedia'

const execFileAsync = promisify(execFile)
const FFPROBE_TIMEOUT_MS = 20_000

/** Resolve ffprobe: NUXT_FFPROBE_PATH / FFPROBE_PATH, else the system binary on PATH. */
export function ffprobeBin() {
  return String(process.env.NUXT_FFPROBE_PATH || process.env.FFPROBE_PATH || 'ffprobe').trim() || 'ffprobe'
}

function isMissingBinary(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/** Local media is probed straight from disk; remote URLs are handed to ffprobe as-is. */
async function probeInput(url: string) {
  const key = storedMediaKey(url)
  if (key === null)
    return url
  return (await storedMediaFile(key)).path
}

async function probeDuration(input: string) {
  try {
    const { stdout } = await execFileAsync(ffprobeBin(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
    ], { timeout: FFPROBE_TIMEOUT_MS })
    const seconds = Number.parseFloat(String(stdout || '').trim())
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new Error('Could not read this video duration')
    return seconds
  }
  catch (error) {
    if (isMissingBinary(error))
      throw new Error('ffprobe is not available on this host. Install ffmpeg (includes ffprobe) or set NUXT_FFPROBE_PATH.')
    throw error
  }
}

export async function getVideoDurationFromUrl(url: string) {
  return probeDuration(await probeInput(url))
}

export async function measureReferenceVideoSeconds(urls: string[] | undefined | null) {
  const list = Array.isArray(urls) ? urls : []
  if (!list.length)
    return { durations: [] as number[], total: 0 }
  const durations = await Promise.all(list.map(url => getVideoDurationFromUrl(String(url))))
  return {
    durations,
    total: durations.reduce((sum, seconds) => sum + seconds, 0),
  }
}
