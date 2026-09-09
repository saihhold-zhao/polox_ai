import { uploadFalFile } from '../utils/falFiles'
import { saveMediaFile } from '../utils/localMedia'

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_AUDIO_BYTES = 15 * 1024 * 1024
const MEDIA_BY_TYPE: Record<string, {
  extension: string
  maxBytes: number
}> = {
  'image/jpeg': { extension: 'jpg', maxBytes: MAX_IMAGE_BYTES },
  'image/jpg': { extension: 'jpg', maxBytes: MAX_IMAGE_BYTES },
  'image/png': { extension: 'png', maxBytes: MAX_IMAGE_BYTES },
  'image/webp': { extension: 'webp', maxBytes: MAX_IMAGE_BYTES },
  'image/avif': { extension: 'avif', maxBytes: MAX_IMAGE_BYTES },
  'image/gif': { extension: 'gif', maxBytes: MAX_IMAGE_BYTES },
  'image/bmp': { extension: 'bmp', maxBytes: MAX_IMAGE_BYTES },
  'image/x-ms-bmp': { extension: 'bmp', maxBytes: MAX_IMAGE_BYTES },
  'application/pdf': { extension: 'pdf', maxBytes: 50 * 1024 * 1024 },
  'video/webm': { extension: 'webm', maxBytes: MAX_VIDEO_BYTES },
  'video/mp4': { extension: 'mp4', maxBytes: MAX_VIDEO_BYTES },
  'video/quicktime': { extension: 'mov', maxBytes: MAX_VIDEO_BYTES },
  'video/x-matroska': { extension: 'mkv', maxBytes: MAX_VIDEO_BYTES },
  'audio/mpeg': { extension: 'mp3', maxBytes: MAX_AUDIO_BYTES },
  'audio/mp3': { extension: 'mp3', maxBytes: MAX_AUDIO_BYTES },
  'audio/wav': { extension: 'wav', maxBytes: MAX_AUDIO_BYTES },
  'audio/x-wav': { extension: 'wav', maxBytes: MAX_AUDIO_BYTES },
  'audio/wave': { extension: 'wav', maxBytes: MAX_AUDIO_BYTES },
  'audio/aac': { extension: 'aac', maxBytes: MAX_AUDIO_BYTES },
  'audio/ogg': { extension: 'ogg', maxBytes: MAX_AUDIO_BYTES },
  'audio/mp4': { extension: 'm4a', maxBytes: MAX_AUDIO_BYTES },
}
export default defineEventHandler(async (event) => {
  const form = await readFormData(event)
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A file is required',
    })
  }
  const media = MEDIA_BY_TYPE[file.type]
  if (!media) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This file type is not supported',
    })
  }
  if (file.size > media.maxBytes) {
    throw createError({
      statusCode: 400,
      statusMessage: `File must be ${Math.round(media.maxBytes / (1024 * 1024))}MB or smaller`,
    })
  }
  const key = `generator/uploads/${crypto.randomUUID()}.${media.extension}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  await saveMediaFile(key, bytes, file.type)
  const url = await uploadFalFile(bytes, file.type, `upload.${media.extension}`)
  return { url }
})
