// Type-only import keeps this module loadable by plain `node` (type stripping) in scripts/test-*.mjs.
import type { SkillCategory } from './skillCategory'

// Explicit public catalog: internal operating skills stay out of the picker.
export const PUBLIC_AGENT_SKILLS = [
  {
    id: 'product-hunt-gallery',
    category: 'utility',
    icon: 'lucide:gallery-horizontal-end',
    name: 'Product Hunt gallery',
    description: 'Create consistent Product Hunt launch images from your website or product details.',
    keywords: 'product hunt gallery launch exhibition brand marketing',
    cover: '/brand/skills/product-hunt-gallery.webp',
    coverAlt: 'PoloX AI Product Hunt gallery skill cover — launch image set from your product site',
    placeholder: 'Enter your website URL…',
  },
  {
    id: 'app-store-graphics',
    category: 'utility',
    icon: 'lucide:smartphone',
    name: 'App Store Graphics',
    description: 'Turn app screenshots into matching iPhone 17 Pro Max App Store graphics with a shared visual system.',
    keywords: 'app store graphics iphone screenshot marketing preview 应用商店',
    cover: '/brand/skills/app-store-graphics.webp',
    coverAlt: 'PoloX AI App Store Graphics skill cover — screenshot to front-facing iPhone App Store graphic',
    placeholder: 'Upload feature screenshots and logo, then add the app name and a short feature description…',
  },
  {
    id: 'sketch-to-image',
    category: 'utility',
    icon: 'lucide:pencil-ruler',
    name: 'Sketch to Image',
    description: 'Draw a sketch, add text, and turn your idea into a finished image.',
    keywords: 'sketch drawing image 草图 绘画',
    cover: '/brand/skills/sketch-to-image.webp',
    coverAlt: 'PoloX AI Sketch to Image skill cover — turn a sketch into a finished image',
  },
  {
    id: 'image-text-editor',
    category: 'utility',
    icon: 'lucide:text-cursor-input',
    name: 'Image Text Editor',
    description: 'Edit text in images while preserving the original fonts and image details.',
    keywords: 'image text editor typography 图片 文字 编辑',
    cover: '/brand/skills/image-text-editor.webp',
    coverAlt: 'PoloX AI Image Text Editor skill cover — edit text in images with original fonts',
  },
  {
    id: 'image-annotation-edit',
    category: 'utility',
    icon: 'lucide:map-pin',
    name: 'Annotated Image Edit',
    description: 'Mark points on an image and describe each change to edit precisely.',
    keywords: 'annotate annotation image edit point pin 标注 编辑',
    cover: '/brand/skills/image-annotation-edit.webp',
    coverAlt: 'PoloX AI Annotated Image Edit skill cover — before and after with numbered edit markers',
  },
  {
    id: 'image-object-removal',
    category: 'utility',
    icon: 'lucide:eraser',
    name: 'Image Object Removal',
    description: 'Mark objects with boxes or masks and remove them while keeping the rest of the image.',
    keywords: 'image object removal erase inpaint 对象移除 remove object',
    cover: '/brand/skills/image-object-removal.webp',
    coverAlt: 'PoloX AI Image Object Removal skill cover — mark and remove objects while keeping the rest',
  },
  {
    id: 'image-layer-splitter',
    category: 'utility',
    icon: 'lucide:layers',
    name: 'Image Layer Splitter',
    description: 'Draw boxes around objects to extract them as separate transparent PNG layers.',
    keywords: 'image layer splitter transparent png 图层 拆分',
    cover: '/brand/skills/image-layer-splitter.webp',
    coverAlt: 'PoloX AI Image Layer Splitter skill cover — extract objects as transparent PNG layers',
  },
  {
    id: 'long-form-video',
    category: 'utility',
    icon: 'lucide:clapperboard',
    name: 'Long-form video',
    description: 'Plan a storyboard and produce a multi-shot film from stills, clips, and concat.',
    keywords: 'long-form video film storyboard short film 长视频 短片 分镜',
    cover: '/brand/skills/long-form-video.webp',
    coverAlt: 'PoloX AI Long-form video skill cover — multi-shot film from a storyboard',
  },
  {
    id: 'talking-avatar',
    category: 'utility',
    icon: 'lucide:audio-lines',
    name: 'Talking Avatar',
    description: 'Guided talking-head video: pick ratio, character, spoken language (English / 中文), voice (random / upload / record), script, first frame, then generate lip-sync / talking-head segments.',
    keywords: 'talking avatar talking head lip sync portrait voice clone 口播 数字人',
    cover: '/brand/skills/talking-avatar.webp',
    coverAlt: 'PoloX AI Talking Avatar skill cover — portrait and script to talking-head video',
    placeholder: 'Start Talking Avatar — we will ask for ratio, character, language, voice, and script step by step…',
  },
  {
    id: 'skill-creator',
    category: 'utility',
    icon: 'lucide:wand-sparkles',
    name: 'Create Skill',
    description: 'Author an L1 skill that orchestrates existing tools — no custom code or UI cards.',
    keywords: 'create skill builder custom workflow skill-creator 创建技能',
    cover: '/brand/skills/skill-creator.svg',
    coverAlt: 'PoloX AI Skill Creator — design a custom L1 orchestration skill',
    placeholder: 'Describe the skill you want to create…',
  },
] as const

export const BUILTIN_PUBLIC_AGENT_SKILLS = PUBLIC_AGENT_SKILLS

export type PublicAgentSkill = typeof PUBLIC_AGENT_SKILLS[number]

export interface CatalogAgentSkill {
  id: string
  name: string
  description: string
  keywords?: string
  icon?: string
  cover?: string
  coverAlt?: string
  placeholder?: string
  source?: 'builtin' | 'user' | 'imported'
  /** Sub-category: utility (functional) or fun (entertainment). Missing = utility. */
  category?: SkillCategory
  enabled?: boolean
}

export function mergeAgentSkillCatalog(userSkills: CatalogAgentSkill[] = []): CatalogAgentSkill[] {
  const builtin = PUBLIC_AGENT_SKILLS.map(skill => ({ ...skill, source: 'builtin' as const, enabled: true }))
  const enabledUser = userSkills.filter(skill => skill.enabled !== false)
  const builtinIds = new Set<string>(builtin.map(skill => skill.id))
  return [
    ...builtin,
    ...enabledUser
      .filter(skill => skill?.id && !builtinIds.has(skill.id))
      .map(skill => ({ ...skill, category: (skill.category === 'fun' ? 'fun' : 'utility') as SkillCategory })),
  ]
}

export function searchAgentSkills(query: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return skills.filter(skill => terms.every(term => `${skill.id} ${skill.name} ${skill.description} ${skill.keywords || ''}`.toLowerCase().includes(term)))
}

export function findComposerCommand(text: string, caret: number) {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)([@/])([^@/\n]*)$/.exec(before)
  if (match?.[1] === '/' && PUBLIC_AGENT_SKILLS.some(skill => match[2]?.startsWith(`${skill.id} `)))
    return null
  return match ? { start: caret - match[2]!.length - 1, end: caret, query: match[2]!, trigger: match[1] as '@' | '/' } : null
}

export function readSkillCommands(text: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const ids = new Set([...text.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]{0,63})(?=\s|$)/g)].map(match => match[1]!))
  const list = Array.isArray(skills) ? skills : PUBLIC_AGENT_SKILLS
  return list.filter(skill => ids.has(skill.id))
}

export function stripSkillCommands(text: string, skills: readonly CatalogAgentSkill[] = PUBLIC_AGENT_SKILLS) {
  const list = Array.isArray(skills) ? skills : PUBLIC_AGENT_SKILLS
  const ids = new Set(list.map(skill => skill.id))
  return text.replace(/(?<!\S)\/([a-z][a-z0-9-]{0,63})(?=\s|$)[ \t]*/g, (match, id) =>
    ids.has(id) ? '' : match)
}

export function composerPlaceholderForSkills(skills: readonly { id: string, placeholder?: string }[]) {
  for (const skill of skills) {
    if (skill.placeholder)
      return skill.placeholder
  }
  return skills.length ? 'What do you want to create next?' : ''
}
