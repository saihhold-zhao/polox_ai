import type { AgentConfirmPolicy } from './types'
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

function confirmPolicyBlock(policy: AgentConfirmPolicy) {
  if (policy === 'auto') {
    return `Current preference: Automatic generation confirmation.
- A confirmation card is still recorded. The runtime auto-approves generation — the user will not click Confirm.
- Do not ask them to confirm generation in chat. Leave uncertain_fields empty unless a value is actually unknown.
- Single-generator brief/parameter checkpoints and long-form production checkpoints still happen as ask_user cards, separate from generation confirmations.`
  }
  if (policy === 'when_needed') {
    return `Current preference: Review when needed.
- The runtime auto-approves generation unless you mark uncertain_fields.
- Mark a field uncertain when you inferred it and a different choice would materially change the result.
- Empty uncertain_fields means you are confident — generation continues without a click.`
  }
  return `Current preference: Always review.
- The user clicks Confirm on every generation job.
- Mark uncertain_fields to highlight what they may want to edit. Empty is fine when the brief is clear.`
}

export function skillsPromptBlock(confirmPolicy: AgentConfirmPolicy = 'always') {
  const skills = loadAgentSkills()
  return `\n\n## Skills\nThese operating notes shape how you think. They do not spend money. Only tools spend money.\n\n${skills.join('\n\n')}\n\n## Active confirmation preference\n${confirmPolicyBlock(confirmPolicy)}`
}
