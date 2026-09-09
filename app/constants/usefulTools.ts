const IDEOGRAM_REMOVE_BACKGROUND_MODEL = 'fal-ai/ideogram/remove-background'

export interface UsefulTool {
  slug: string
  title: string
  icon: string
  description: string
  to?: string
  group?: string
}

export const IMAGE_EDITOR_PATH = '/tools/image-to-image'
export const VIDEO_EDITOR_PATH = '/tools/reference-to-video'

export const USEFUL_TOOLS: UsefulTool[] = [
  {
    slug: 'image-text-editor',
    title: 'Image Text Editor',
    icon: 'i-lucide-text-cursor-input',
    description: 'Edit text in images while preserving the original fonts and image details.',
    to: '/?agentModel=image-text-editor#generator',
    group: 'Useful tools',
  },
  {
    slug: 'image-layer-splitter',
    title: 'Image Layer Splitter',
    icon: 'i-lucide-layers',
    description: 'Draw boxes around objects to extract them as separate transparent PNG layers.',
    to: '/?agentModel=image-layer-splitter#generator',
    group: 'Useful tools',
  },
  {
    slug: 'remove-background',
    title: 'Image Background Removal',
    icon: 'i-lucide-eraser',
    description: 'Remove the background and keep a transparent PNG.',
    to: `/?agentModel=${encodeURIComponent(IDEOGRAM_REMOVE_BACKGROUND_MODEL)}#generator`,
    group: 'Useful tools',
  },
  {
    slug: 'image-to-image',
    title: 'AI Image Editor',
    icon: 'i-lucide-wand-sparkles',
    description: 'Upload a still and describe the change. An AI image editor for Image to Image only.',
    to: '/?agentTask=image-to-image#generator',
    group: 'Useful tools',
  },
  {
    slug: 'reference-to-video',
    title: 'AI Video Editor',
    icon: 'i-lucide-clapperboard',
    description: 'Upload a clip and describe the change. An AI video editor for Reference to Video only.',
    to: '/?agentTask=reference-to-video#generator',
    group: 'Useful tools',
  },
]

export const HOME_TOOL_COLLECTIONS = [
  {
    title: 'Useful tools',
    description: 'Everyday utilities for your images and videos.',
    items: USEFUL_TOOLS.map(tool => ({
      ...tool,
      to: tool.to || `/tools/${tool.slug}`,
    })),
  },
] as const

export function usefulToolBySlug(slug: string) {
  return USEFUL_TOOLS.find(tool => tool.slug === slug)
}

export function studioToolBySlug(slug: string) {
  return usefulToolBySlug(slug)
}
