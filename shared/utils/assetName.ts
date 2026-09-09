interface NamedAsset { id: string, name?: string, kind?: string, videoMode?: string, prompt?: string }

export function cleanAssetName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[\r\n/\\]/g, '_').slice(0, 100) : ''
}

export function assetName(item: NamedAsset): string {
  const name = cleanAssetName(item.name)
  if (name && !/^(shot|image|video|still|cutout|reference)([_ -]\d+)+$/i.test(name))
    return name
  const summary = item.prompt?.replace(/\s+/g, ' ').trim()
  if (summary)
    return `${name ? `${name} · ` : ''}${summary.slice(0, 90)}${summary.length > 90 ? '…' : ''}`
  if (name)
    return name
  const prefix = item.videoMode === 'concat' ? 'Final film' : item.kind === 'video' ? 'Video' : item.kind === 'cutout' ? 'Cutout' : item.kind === 'upload' ? 'Reference' : 'Image'
  return `${prefix} · ${item.id.replace(/^agent_/, '').slice(-10)}`
}

export function allocateAssetName(item: NamedAsset, assets: NamedAsset[]): string {
  const previous = assets.find(asset => asset.id === item.id)?.name
  if (previous)
    return previous
  const prefix = item.videoMode === 'concat' ? 'final_film' : item.kind === 'video' ? 'shot' : item.kind === 'cutout' ? 'cutout' : item.kind === 'upload' ? 'reference' : 'image'
  const base = cleanAssetName(item.name) || prefix
  const used = new Set(assets.filter(asset => asset.id !== item.id).map(asset => asset.name?.toLowerCase()))
  if (item.name && !used.has(base.toLowerCase()))
    return base
  let index = 1
  while (used.has(`${base}_${index}`.toLowerCase())) index++
  return `${base}_${index}`
}

export function matchingAgentAsset<T extends { id: string, providerTaskId?: string, url?: string }>(items: T[], taskId: string, url: string): T | undefined {
  return items.find(item => item.providerTaskId === taskId || item.id === taskId || `agent_${item.id}`.slice(0, 120) === taskId)
    || (url ? items.find(item => item.url === url) : undefined)
}
