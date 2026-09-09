import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { zipSync } from 'fflate'
import { z } from 'zod'
import { readStoredMedia } from './localMedia'

export const mediaExportSchema = z.object({
  items: z.array(z.object({ url: z.string().url().max(4096), name: z.string().max(200).default('Asset') })).min(1).max(100),
  format: z.enum(['file', 'zip']).default('zip'),
  name: z.string().max(200).default('canvas-export'),
}).refine(value => value.format !== 'file' || value.items.length === 1, 'Single-file export requires one item')

const MAX_FILE = 120 * 1024 * 1024
const MAX_TOTAL = 250 * 1024 * 1024
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')

export function isPublicExportAddress(address: string) {
  const family = isIP(address)
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}

export function exportName(value: string) {
  return value.normalize('NFC').replace(/[\p{Cc}<>:"/\\|?*]/gu, '_').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 100) || 'Asset'
}

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}

export function mediaFileName(name: string, url: string, mime: string) {
  const extension = extensions[mime] || new URL(url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || 'bin'
  const base = exportName(name)
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`
}

// Resolve and pin a public address on every redirect; never forward cookies or credentials.
export async function downloadExportMedia(source: string, maxBytes = MAX_FILE, signal?: AbortSignal, redirects = 0): Promise<{ bytes: Buffer, mime: string }> {
  const local = await readStoredMedia(source, maxBytes, signal)
  if (local)
    return local
  const url = new URL(source)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)))
    throw new Error('Unsupported media URL')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(item => !isPublicExportAddress(item.address)))
    throw new Error('Media URL must resolve to a public address')
  const address = addresses[0]!
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal,
      lookup: (_hostname, options, callback) => {
        if (options.all)
          callback(null, [address])
        else
          callback(null, address.address, address.family)
      },
    }, resolve)
    req.on('error', reject)
    req.setTimeout(30_000, () => req.destroy(new Error('Media download timed out')))
    req.end()
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
    response.destroy()
    if (!response.headers.location || redirects >= 3)
      throw new Error('Too many media redirects')
    return downloadExportMedia(new URL(response.headers.location, url).href, maxBytes, signal, redirects + 1)
  }
  if (response.statusCode !== 200 || Number(response.headers['content-length'] || 0) > maxBytes) {
    response.destroy()
    throw new Error(response.statusCode === 200 ? 'Export exceeds the size limit' : `Media download failed (${response.statusCode})`)
  }
  const parts: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of response) {
      size += chunk.length
      if (size > maxBytes)
        throw new Error('Export exceeds the size limit')
      parts.push(Buffer.from(chunk))
    }
  }
  finally {
    response.destroy()
  }
  if (!size)
    throw new Error('Media file is empty')
  return { bytes: Buffer.concat(parts), mime: String(response.headers['content-type'] || 'application/octet-stream').split(';')[0]!.trim() }
}

export async function buildMediaExport(input: z.input<typeof mediaExportSchema>, signal?: AbortSignal) {
  const { items, format, name } = mediaExportSchema.parse(input)
  const files: Record<string, Uint8Array> = Object.create(null)
  let total = 0
  const timeout = AbortSignal.timeout(180_000)
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  for (const item of items) {
    const file = await downloadExportMedia(item.url, Math.min(MAX_FILE, MAX_TOTAL - total), downloadSignal)
    total += file.bytes.length
    const filename = mediaFileName(item.name, item.url, file.mime)
    if (format === 'file')
      return { bytes: file.bytes, filename, mime: file.mime }
    let unique = filename
    let suffix = 2
    const dot = filename.lastIndexOf('.')
    while (Object.hasOwn(files, unique))
      unique = `${filename.slice(0, dot)} (${suffix++})${filename.slice(dot)}`
    files[unique] = file.bytes
  }
  downloadSignal.throwIfAborted()
  // Images and video are already compressed. STORE preserves the originals without CPU-heavy recompression.
  return { bytes: Buffer.from(zipSync(files, { level: 0 })), filename: `${exportName(name).replace(/\.zip$/i, '')}.zip`, mime: 'application/zip' }
}
