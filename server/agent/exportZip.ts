import type { AgentImage } from './types'
import { z } from 'zod'
import { saveMediaFile } from '../utils/localMedia'
import { buildMediaExport } from '../utils/mediaExport'

export const EXPORT_ZIP_TOOL = 'export_zip'
export const exportZipTool = {
  type: 'function',
  function: {
    name: EXPORT_ZIP_TOOL,
    description: 'Package existing successful session images or videos as a ZIP and return a download URL. No new generation is started. Pass exact session asset IDs or URLs; up to 100 files, 120MB per file and 250MB total. Wait for generation to finish before exporting.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assets: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string' }, description: 'Session asset IDs or exact URLs, in archive order.' },
        name: { type: 'string', description: 'Short archive filename in the user language, without .zip.' },
      },
      required: ['assets', 'name'],
    },
  },
}
const argsSchema = z.object({ assets: z.array(z.string().min(1)).min(1).max(100), name: z.string().min(1).max(200) })
export function resolveZipExport(raw: string, images: AgentImage[]) {
  const args = argsSchema.parse(JSON.parse(raw))
  const items = args.assets.map((token) => {
    const asset = images.find(image => (image.id === token || image.url === token) && image.status === 'success' && image.url)
    if (!asset)
      throw new Error(`Export asset is not available in this session: ${token}`)
    return { url: asset.url, name: asset.name || asset.id }
  })
  return { items, name: args.name, format: 'zip' as const }
}
export async function exportSessionZip(input: ReturnType<typeof resolveZipExport>, signal?: AbortSignal) {
  const file = await buildMediaExport(input, signal)
  signal?.throwIfAborted()
  const key = `agent-lab/exports/${crypto.randomUUID()}.zip`
  const url = await saveMediaFile(key, file.bytes, file.mime)
  return { ok: true, url, filename: file.filename, count: input.items.length, bytes: file.bytes.length }
}
