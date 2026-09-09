import { execFile } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isSeedance2Model } from '~~/shared/utils/seedance2'

const execFileAsync = promisify(execFile)
const FFPROBE_TIMEOUT_MS = 20_000

function ffprobeBin() {
  return 'ffprobe'
}

function asDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Could not read this video duration',
    })
  }
  return seconds
}

function isMissingBinary(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function probeDuration(input: string) {
  try {
    const { stdout } = await execFileAsync(
      ffprobeBin(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        input,
      ],
      { timeout: FFPROBE_TIMEOUT_MS },
    )
    return asDuration(Number.parseFloat(String(stdout || '').trim()))
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error
    if (isMissingBinary(error)) {
      console.error('[video duration] system ffprobe not found')
      throw createError({
        statusCode: 503,
        statusMessage: 'Video duration probe is unavailable',
      })
    }
    throw error
  }
}

export async function getVideoDurationFromBuffer(buffer: Uint8Array, extension: string) {
  const path = join(tmpdir(), `polox-${crypto.randomUUID()}.${extension}`)
  await writeFile(path, buffer)
  try {
    return await probeDuration(path)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error
    console.error('[video duration]', error)
    throw createError({
      statusCode: 400,
      statusMessage: 'Could not read this video. Try another MP4 or MOV file.',
    })
  }
  finally {
    await unlink(path).catch(() => {})
  }
}

export async function getVideoDurationFromUrl(url: string) {
  try {
    return await probeDuration(url)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error
    console.error('[video duration]', url, error)
    throw createError({
      statusCode: 400,
      statusMessage: 'Could not read a reference video duration',
    })
  }
}

export async function measureReferenceVideoSeconds(urls: string[]) {
  if (!urls.length)
    return { durations: [] as number[], total: 0 }

  const durations = await Promise.all(urls.map(url => getVideoDurationFromUrl(String(url))))
  return {
    durations,
    total: durations.reduce((sum, seconds) => sum + seconds, 0),
  }
}

export function referenceVideoDurationLimits(model: string) {
  if (model.startsWith('minimax-h3/') || model.startsWith('wan/') || isSeedance2Model(model)) {
    return {
      minEach: model.startsWith('wan/') ? 1 : 2,
      maxEach: 15,
      maxTotal: 15,
    }
  }

  return {
    minEach: 2,
    maxEach: 30,
    maxTotal: 30,
  }
}
