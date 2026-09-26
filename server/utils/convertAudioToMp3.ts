import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ffmpegBin } from './ffmpegBin'
import { readStoredMedia, saveMediaFile } from './localMedia'

const execFileAsync = promisify(execFile)

const ALREADY_MP3 = new Set(['audio/mpeg', 'audio/mp3'])

/** Browser MediaRecorder often produces these; video reference audio wants mp3/wav/m4a/aac/ogg. */
const NEEDS_CONVERT = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
])

function isMissingBinary(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted)
    return true
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')
}

function extensionForInputMime(mime: string) {
  const base = mime.toLowerCase().split(';')[0]!.trim()
  if (base.includes('webm'))
    return 'webm'
  if (base.includes('ogg'))
    return 'ogg'
  if (base.includes('mp4') || base.includes('m4a'))
    return 'm4a'
  if (base.includes('aac'))
    return 'aac'
  if (base.includes('wav'))
    return 'wav'
  if (base.includes('mpeg') || base.includes('mp3'))
    return 'mp3'
  return 'bin'
}

export function audioMimeNeedsMp3Convert(mime: string) {
  const base = String(mime || '').toLowerCase().split(';')[0]!.trim()
  if (!base)
    return false
  if (ALREADY_MP3.has(base))
    return false
  return NEEDS_CONVERT.has(base) || base.startsWith('audio/')
}

/**
 * Transcode in-memory audio to MP3 via ffmpeg (libmp3lame).
 * No-op when input is already audio/mpeg.
 */
export async function convertAudioBytesToMp3(
  bytes: Uint8Array,
  mime: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array, mime: 'audio/mpeg', converted: boolean }> {
  const base = String(mime || '').toLowerCase().split(';')[0]!.trim() || 'application/octet-stream'
  if (ALREADY_MP3.has(base))
    return { bytes, mime: 'audio/mpeg', converted: false }
  if (!bytes.byteLength)
    throw new Error('Audio upload was empty')

  const dir = await mkdtemp(join(tmpdir(), 'polox-audio-mp3-'))
  const inputPath = join(dir, `in.${extensionForInputMime(base)}`)
  const outputPath = join(dir, 'out.mp3')
  try {
    await writeFile(inputPath, bytes)
    try {
      await execFileAsync(ffmpegBin(), [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-ar',
        '44100',
        '-ac',
        '1',
        '-b:a',
        '128k',
        outputPath,
      ], {
        timeout: 60_000,
        signal,
        maxBuffer: 2 * 1024 * 1024,
      })
    }
    catch (error) {
      if (isAbortError(error, signal))
        throw new Error('Aborted')
      if (isMissingBinary(error))
        throw new Error('ffmpeg is not available on this host. Install ffmpeg or set NUXT_FFMPEG_PATH.')
      const stderr = error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr || '').trim()
        : ''
      throw new Error(stderr || (error instanceof Error ? error.message : 'Could not convert audio to MP3'))
    }
    const out = await readFile(outputPath)
    if (!out.byteLength)
      throw new Error('ffmpeg produced an empty MP3')
    return { bytes: out, mime: 'audio/mpeg', converted: true }
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** True when a stored URL still looks like browser-recorded WebM/OGG (needs convert). */
export function audioUrlNeedsMp3Convert(url: string) {
  return /\.(?:webm|ogg|m4a|aac|mp4)(?:\?|$)/i.test(String(url || ''))
}

/**
 * If url is already .mp3, return it. Otherwise read the locally stored file, transcode to
 * MP3 and save it next to the other agent uploads. Remote URLs are never fetched here;
 * they are returned unchanged. Safety net for voice_record results that were stored as
 * webm before upload-time conversion.
 */
export async function ensureReferenceAudioMp3Url(input: {
  url: string
  sessionId: string
  name?: string
  signal?: AbortSignal
}): Promise<{ url: string, converted: boolean, name?: string }> {
  const source = String(input.url || '').trim()
  if (!source)
    throw new Error('Audio URL is required')
  const unchanged = { url: source, converted: false, ...(input.name ? { name: input.name } : {}) }
  if (/\.mp3(?:\?|$)/i.test(source))
    return unchanged
  if (!audioUrlNeedsMp3Convert(source) && !/\.wav(?:\?|$)/i.test(source))
    return unchanged
  const local = await readStoredMedia(source, 50 * 1024 * 1024, input.signal)
  if (!local)
    return unchanged
  const converted = await convertAudioBytesToMp3(local.bytes, local.mime, input.signal)
  const key = `agent-lab/${encodeURIComponent(input.sessionId)}/${crypto.randomUUID()}.mp3`
  const url = await saveMediaFile(key, converted.bytes, converted.mime)
  const baseName = String(input.name || 'voice-sample').replace(/\.[^.]+$/, '')
  return { url, converted: true, name: `${baseName || 'voice-sample'}.mp3` }
}
