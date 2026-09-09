import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'skills')

const FIRST_SKILLS = ['reference-analysis', 'prompt-rewrite', 'result-evaluation', 'long-form-video']

export function loadAgentSkills() {
  const blocks: string[] = []
  for (const name of FIRST_SKILLS) {
    try {
      const text = readFileSync(resolve(skillsDir, `${name}.md`), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
    catch {
      // Skill files are optional at runtime.
    }
  }
  try {
    const extra = readdirSync(skillsDir).filter(file => file.endsWith('.md') && !FIRST_SKILLS.includes(file.replace(/\.md$/, '')))
    for (const file of extra.sort()) {
      const text = readFileSync(resolve(skillsDir, file), 'utf8').trim()
      if (text)
        blocks.push(text)
    }
  }
  catch {
    // No skills directory.
  }
  return blocks
}

export function skillsPromptBlock() {
  const skills = loadAgentSkills()
  if (!skills.length)
    return ''
  return `\n\n## Skills\nThese operating notes shape how you think. They do not spend money. Only tools spend money.\n\n${skills.join('\n\n')}`
}
