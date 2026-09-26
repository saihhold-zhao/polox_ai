import type { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ffmpegBin } from '../utils/ffmpegBin'
import { saveMediaFile, storedMediaFile, storedMediaKey } from '../utils/localMedia'
import { getVideoDurationFromUrl } from '../utils/videoDuration'

const execFileAsync = promisify(execFile)

export const EXTRACT_VIDEO_FRAME_TOOL = 'extract_video_frame'

export type ExtractWhich = 'first' | 'last' | 'at_seconds'

export interface ExtractVideoFrameArgs {
  video: string
  which: ExtractWhich
  seconds?: number
}

export interface ExtractVideoFrameResult {
  ok: true
  which: ExtractWhich
  seconds?: number
  video_url: string
  image_url: string
  name: string
}

function isMissingBinary(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted)
    return true
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')
}

function uploadErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'statusMessage' in error) {
    const statusMessage = String((error as { statusMessage?: unknown }).statusMessage || '').trim()
    if (statusMessage)
      return statusMessage
  }
  if (error instanceof Error && error.message.trim())
    return error.message
  return 'Saving the frame locally failed'
}

/** Local media is copied from disk; remote URLs are downloaded (same as concat_videos). */
async function downloadVideo(url: string, dest: string, signal?: AbortSignal) {
  const key = storedMediaKey(url)
  if (key !== null) {
    await copyFile((await storedMediaFile(key)).path, dest)
    return
  }
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok)
    throw new Error(`Could not download video (${response.status})`)
  if (!response.body)
    throw new Error('Video download returned an empty body')
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(dest), { signal })
}

async function runFfmpeg(args: string[], timeout: number, signal?: AbortSignal) {
  try {
    await execFileAsync(ffmpegBin(), args, {
      timeout,
      signal,
      maxBuffer: 2 * 1024 * 1024,
    })
  }
  catch (error) {
    if (isAbortError(error, signal))
      throw new Error('Aborted')
    if (isMissingBinary(error))
      throw new Error('ffmpeg is not available on this host. Install ffmpeg or set NUXT_FFMPEG_PATH.')
    throw error
  }
}

/** ffmpeg may exit 0 without writing the output file (seen with -sseof on some clips). */
async function readFrameIfPresent(path: string) {
  try {
    await access(path)
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0)
      return null
    const bytes = await readFile(path)
    return bytes.length ? bytes : null
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}

async function extractJpeg(
  inputPath: string,
  outPath: string,
  seekArgs: string[],
  signal?: AbortSignal,
) {
  await rm(outPath, { force: true }).catch(() => {})
  await runFfmpeg(
    ['-y', '-hide_banner', '-loglevel', 'error', ...seekArgs, '-i', inputPath, '-frames:v', '1', '-q:v', '2', outPath],
    60_000,
    signal,
  )
  return readFrameIfPresent(outPath)
}

function frameName(which: ExtractWhich, seconds?: number) {
  if (which === 'first')
    return 'first_frame'
  if (which === 'last')
    return 'last_frame'
  const label = Number.isFinite(seconds) ? String(seconds) : 't'
  return `frame_at_${label}s`
}

/**
 * Extract one still JPEG from a video URL.
 * - first: frame at start (ss 0)
 * - last: -sseof -0.05 (near end)
 * - at_seconds: -ss <seconds> then one frame
 */
export async function extractVideoFrame(
  videoUrl: string,
  which: ExtractWhich,
  seconds?: number,
  signal?: AbortSignal,
): Promise<ExtractVideoFrameResult> {
  if (!videoUrl.trim())
    throw new Error('video is required')
  if (which === 'at_seconds') {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
      throw new Error('seconds must be a finite number >= 0 when which is at_seconds')
  }

  const dir = await mkdtemp(join(tmpdir(), 'polox-frame-'))
  const inputPath = join(dir, 'input.mp4')
  const outPath = join(dir, 'frame.jpg')
  try {
    await downloadVideo(videoUrl, inputPath, signal)

    let usedSeconds: number | undefined
    let bytes: Buffer | null = null

    if (which === 'first') {
      usedSeconds = 0
      bytes = await extractJpeg(inputPath, outPath, ['-ss', '0'], signal)
    }
    else if (which === 'last') {
      // Prefer -sseof; some clips exit 0 without writing a file — treat missing/empty as failure and seek by duration.
      try {
        bytes = await extractJpeg(inputPath, outPath, ['-sseof', '-0.05'], signal)
      }
      catch (error) {
        if (isAbortError(error, signal) || (error instanceof Error && error.message.includes('ffmpeg is not available')))
          throw error
        bytes = null
      }
      if (!bytes) {
        const duration = await getVideoDurationFromUrl(videoUrl).catch(() => 0)
        const at = duration > 0.1 ? Math.max(0, duration - 0.05) : 0
        usedSeconds = at
        bytes = await extractJpeg(inputPath, outPath, ['-ss', String(at)], signal)
      }
    }
    else {
      usedSeconds = seconds!
      bytes = await extractJpeg(inputPath, outPath, ['-ss', String(seconds)], signal)
    }

    if (!bytes?.length)
      throw new Error('ffmpeg did not produce a frame image')

    const key = `generator/agent-frames/${crypto.randomUUID()}.jpg`
    let imageUrl: string
    try {
      imageUrl = await saveMediaFile(key, new Uint8Array(bytes), 'image/jpeg')
    }
    catch (error) {
      throw new Error(uploadErrorMessage(error))
    }

    const name = frameName(which, usedSeconds ?? seconds)
    const result: ExtractVideoFrameResult = {
      ok: true,
      which,
      video_url: videoUrl,
      image_url: imageUrl,
      name,
    }
    if (which === 'at_seconds' || usedSeconds != null)
      result.seconds = which === 'at_seconds' ? seconds : usedSeconds
    return result
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function parseExtractVideoFrameArgs(raw: string): ExtractVideoFrameArgs {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw || '{}') as Record<string, unknown>
  }
  catch {
    throw new Error('extract_video_frame arguments were not valid JSON')
  }

  const video = String(parsed.video || '').trim()
  if (!video)
    throw new Error('video is required')

  const whichRaw = String(parsed.which || '').trim()
  if (whichRaw !== 'first' && whichRaw !== 'last' && whichRaw !== 'at_seconds')
    throw new Error('which must be "first", "last", or "at_seconds"')

  const which = whichRaw as ExtractWhich
  let seconds: number | undefined
  if (which === 'at_seconds') {
    const value = typeof parsed.seconds === 'number' ? parsed.seconds : Number(parsed.seconds)
    if (!Number.isFinite(value) || value < 0)
      throw new Error('seconds must be a finite number >= 0 when which is at_seconds')
    seconds = value
  }
  else if (parsed.seconds != null && parsed.seconds !== '') {
    const value = typeof parsed.seconds === 'number' ? parsed.seconds : Number(parsed.seconds)
    if (Number.isFinite(value) && value >= 0)
      seconds = value
  }

  return { video, which, seconds }
}

export const extractVideoFrameTool = {
  type: 'function' as const,
  function: {
    name: EXTRACT_VIDEO_FRAME_TOOL,
    description:
      'Extract one still frame from a video. Always set which to "first", "last", or "at_seconds" (pass seconds when at_seconds). Returns an image URL usable as first_frame or a reference still. video accepts an HTTP URL, a session video id, or "latest".',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        video: {
          type: 'string',
          description: 'Public HTTP URL, session video id, or "latest".',
        },
        which: {
          type: 'string',
          enum: ['first', 'last', 'at_seconds'],
          description: 'Which frame to extract. Required. Use at_seconds with seconds for a specific time.',
        },
        seconds: {
          type: 'number',
          description: 'Required when which is at_seconds. Finite number >= 0 (seconds from start).',
        },
      },
      required: ['video', 'which'],
    },
  },
}
