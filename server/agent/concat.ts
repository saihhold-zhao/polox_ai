import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { saveMediaFile } from '../utils/localMedia'

const execFileAsync = promisify(execFile)
const MAX_CLIP_BYTES = 120 * 1024 * 1024
const MAX_TOTAL_BYTES = 500 * 1024 * 1024
function isMissingBinary(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
function ffmpegMissingMessage() {
  return 'ffmpeg is not available on this host. Install ffmpeg to concatenate clips.'
}
function isAbortError(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted)
    return true
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')
}
async function unlinkQuiet(path: string) {
  await rm(path, { force: true }).catch(() => { })
}
async function cleanupPaths(paths: string[]) {
  await Promise.all(paths.map(path => unlinkQuiet(path)))
}
function storageErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'statusMessage' in error) {
    const statusMessage = String((error as {
      statusMessage?: unknown
    }).statusMessage || '').trim()
    if (statusMessage)
      return statusMessage
  }
  if (error instanceof Error && error.message.trim())
    return error.message
  return 'Saving the video locally failed'
}
async function runFfmpeg(args: string[], timeout: number, signal?: AbortSignal) {
  try {
    await execFileAsync('ffmpeg', args, {
      timeout,
      signal,
      maxBuffer: 2 * 1024 * 1024,
    })
  }
  catch (error) {
    if (isAbortError(error, signal))
      throw new Error('Aborted')
    if (isMissingBinary(error))
      throw new Error(ffmpegMissingMessage())
    throw error
  }
}
async function probeVideoSize(path: string, signal?: AbortSignal) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      path,
    ], { timeout: 15000, signal, maxBuffer: 256 * 1024 })
    const [widthRaw, heightRaw] = stdout.trim().split(/[x,]/)
    const width = Math.floor(Number(widthRaw))
    const height = Math.floor(Number(heightRaw))
    if (!width || !height)
      return { width: 1280, height: 720 }
    return {
      width: width - (width % 2),
      height: height - (height % 2),
    }
  }
  catch (error) {
    if (isAbortError(error, signal))
      throw new Error('Aborted')
    if (isMissingBinary(error))
      throw new Error(ffmpegMissingMessage())
    return { width: 1280, height: 720 }
  }
}
async function probeHasAudio(path: string, signal?: AbortSignal) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      path,
    ], { timeout: 15000, signal, maxBuffer: 256 * 1024 })
    return Boolean(stdout.trim())
  }
  catch (error) {
    if (isAbortError(error, signal))
      throw new Error('Aborted')
    if (isMissingBinary(error))
      throw new Error(ffmpegMissingMessage())
    return false
  }
}
async function downloadClip(url: string, dest: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok)
    throw new Error(`Could not download clip (${response.status})`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_CLIP_BYTES)
    throw new Error('A source clip is larger than 120MB')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_CLIP_BYTES)
    throw new Error('A source clip is larger than 120MB')
  await writeFile(dest, bytes)
  return bytes.byteLength
}
function concatListLine(path: string) {
  return `file '${path.replace(/'/g, '\'\\\'\'')}'`
}
async function writeConcatList(listPath: string, parts: string[]) {
  await writeFile(listPath, `${parts.map(concatListLine).join('\n')}\n`, 'utf8')
}
async function concatDemux(listPath: string, outPath: string, copy: boolean, signal?: AbortSignal) {
  const ffmpegArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath]
  if (copy) {
    await runFfmpeg([...ffmpegArgs, '-c', 'copy', outPath], 120000, signal)
    return
  }
  await runFfmpeg([
    ...ffmpegArgs,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outPath,
  ], 300000, signal)
}
async function normalizeClip(input: string, output: string, width: number, height: number, signal?: AbortSignal) {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p`
  const videoArgs = [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
  ]
  const hasAudio = await probeHasAudio(input, signal)
  if (hasAudio) {
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vf', vf, ...videoArgs, output], 180000, signal)
    return
  }
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf',
    vf,
    '-shortest',
    ...videoArgs,
    output,
  ], 180000, signal)
}
async function saveConcatResult(bytes: Buffer) {
  const key = `generator/agent-concat/${crypto.randomUUID()}.mp4`
  try {
    return await saveMediaFile(key, new Uint8Array(bytes), 'video/mp4')
  }
  catch (error) {
    throw new Error(storageErrorMessage(error))
  }
}
export async function concatVideoUrls(urls: string[], signal?: AbortSignal) {
  if (urls.length < 2)
    throw new Error('Need at least two clips to concatenate')
  const dir = await mkdtemp(join(tmpdir(), 'polox-concat-'))
  const scratch: string[] = []
  try {
    const parts: string[] = []
    let totalBytes = 0
    for (const [index, url] of urls.entries()) {
      const dest = join(dir, `clip-${String(index).padStart(3, '0')}.mp4`)
      totalBytes += await downloadClip(url, dest, signal)
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error('Source clips together are larger than 500MB')
      parts.push(dest)
      scratch.push(dest)
    }
    const listPath = join(dir, 'list.txt')
    const outPath = join(dir, 'out.mp4')
    scratch.push(listPath, outPath)
    await writeConcatList(listPath, parts)
    try {
      await concatDemux(listPath, outPath, true, signal)
    }
    catch (copyError) {
      if (copyError instanceof Error && (copyError.message === ffmpegMissingMessage() || copyError.message === 'Aborted'))
        throw copyError
      const size = await probeVideoSize(parts[0] || '', signal)
      const normalized: string[] = []
      for (const [index, part] of parts.entries()) {
        const dest = join(dir, `norm-${String(index).padStart(3, '0')}.mp4`)
        await normalizeClip(part, dest, size.width, size.height, signal)
        normalized.push(dest)
        scratch.push(dest)
        // Drop the original download once its normalized copy exists.
        await unlinkQuiet(part)
      }
      const normList = join(dir, 'norm-list.txt')
      scratch.push(normList)
      await writeConcatList(normList, normalized)
      try {
        await concatDemux(normList, outPath, true, signal)
      }
      catch (normCopyError) {
        if (normCopyError instanceof Error && (normCopyError.message === ffmpegMissingMessage() || normCopyError.message === 'Aborted'))
          throw normCopyError
        try {
          await concatDemux(normList, outPath, false, signal)
        }
        catch (encodeError) {
          if (encodeError instanceof Error && (encodeError.message === ffmpegMissingMessage() || encodeError.message === 'Aborted'))
            throw encodeError
          throw new Error('ffmpeg could not concatenate these clips')
        }
      }
      // Normalized intermediates are only needed for the demux step.
      await cleanupPaths([...normalized, normList])
    }
    const bytes = await readFile(outPath)
    // Free local scratch before saving the result so large stitches don't hold 2x disk.
    await cleanupPaths(scratch.filter(path => path !== outPath))
    await unlinkQuiet(outPath)
    return await saveConcatResult(bytes)
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { })
  }
}
