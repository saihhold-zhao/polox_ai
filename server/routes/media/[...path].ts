import { createReadStream } from 'node:fs'
import { storedMediaFile } from '../../utils/localMedia'

export default defineEventHandler(async (event) => {
  if (!['GET', 'HEAD'].includes(event.method))
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  let file
  try {
    file = await storedMediaFile(getRouterParam(event, 'path', { decode: true }) || '')
  }
  catch {
    throw createError({ statusCode: 404, statusMessage: 'Media file not found' })
  }
  setHeader(event, 'Content-Type', file.mime)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Last-Modified', file.modified.toUTCString())
  if (file.mime === 'application/octet-stream' || file.mime === 'application/zip')
    setHeader(event, 'Content-Disposition', 'attachment')
  const range = getHeader(event, 'range')
  let start = 0
  let end = file.size - 1
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size || (match[1] === '' && Number(match[2]) === 0)) {
      setHeader(event, 'Content-Range', `bytes */${file.size}`)
      setResponseStatus(event, 416)
      return ''
    }
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${file.size}`)
  }
  setHeader(event, 'Content-Length', Math.max(0, end - start + 1))
  if (event.method === 'HEAD' || file.size === 0)
    return ''
  return sendStream(event, createReadStream(file.path, { start, end }))
})
