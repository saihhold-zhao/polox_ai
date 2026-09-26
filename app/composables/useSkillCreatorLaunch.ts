import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { INTERNAL_EDIT_CONTEXT_END } from '~~/shared/utils/agentChatVisibility'

const COMPOSER_DRAFT_KEY = 'polox-agent-composer-draft'
const EDIT_BRIEF_KEY = 'polox-edit-skill-brief'
const EDIT_PLACEHOLDER_KEY = 'polox-edit-skill-placeholder'
const SKILL_TEST_ID_KEY = 'polox-skill-test-id'
const SKILL_TEST_NAME_KEY = 'polox-skill-test-name'
const AUTOSEND_KEY = 'polox-skill-creator-autosend'
const AUTOSEND_PROMPT_KEY = 'polox-skill-creator-autosend-prompt'

export function draftHasSkillCreator(text: string) {
  return /(?:^|\s)\/skill-creator(?=\s|$)/.test(String(text || ''))
}

export function stripSkillCreatorCommand(text: string) {
  return String(text || '')
    .replace(/(?:^|\s)\/skill-creator(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function randomSkillSuffix(length = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  for (const byte of bytes)
    out += alphabet[byte % alphabet.length]
  return out
}

function buildDraftSkillMarkdown(skillId: string, displayName: string) {
  return [
    '---',
    `id: ${skillId}`,
    `name: ${displayName}`,
    'description: Draft skill — still being designed with Skill Creator.',
    'version: 1.0.0',
    'source: user',
    'visibility: private',
    'triggers:',
    `  - /${skillId}`,
    'requires:',
    '  - ask_user',
    'inputs: []',
    'safety:',
    '  maxGenerationsPerRun: 3',
    '  allowSpend: true',
    '---',
    '',
    `# ${displayName}`,
    '',
    'This is an unfinished draft. Continue designing it with Skill Creator, then publish when ready.',
    '',
    '## Steps',
    '1. Clarify the user goal.',
    '2. Ask any missing decisions with ask_user.',
    '3. Run the workflow once the skill is complete.',
    '',
  ].join('\n')
}

function writeEditorSession(options: {
  skillId: string
  skillName: string
  brief: string
  placeholder?: string
  userPrompt?: string
  autosend?: boolean
}) {
  if (!import.meta.client)
    return
  try {
    const prompt = String(options.userPrompt || '').trim()
    // When autosend is on, keep only /skill-creator in the draft stash — the user
    // prompt lives in AUTOSEND_PROMPT_KEY and is sent once after Edit opens.
    // Stashing both caused duplicate first messages (hydrate + autosend).
    sessionStorage.setItem(
      COMPOSER_DRAFT_KEY,
      options.autosend && prompt ? '/skill-creator' : (prompt ? `/skill-creator ${prompt}` : '/skill-creator'),
    )
    sessionStorage.setItem(EDIT_BRIEF_KEY, options.brief)
    if (options.placeholder)
      sessionStorage.setItem(EDIT_PLACEHOLDER_KEY, options.placeholder)
    else
      sessionStorage.removeItem(EDIT_PLACEHOLDER_KEY)

    sessionStorage.setItem(SKILL_TEST_ID_KEY, options.skillId)
    sessionStorage.setItem(SKILL_TEST_NAME_KEY, options.skillName)

    if (options.autosend && prompt) {
      sessionStorage.setItem(AUTOSEND_KEY, '1')
      sessionStorage.setItem(AUTOSEND_PROMPT_KEY, prompt)
    }
    else {
      sessionStorage.removeItem(AUTOSEND_KEY)
      sessionStorage.removeItem(AUTOSEND_PROMPT_KEY)
    }
  }
  catch {
    // Private mode — editor still opens.
  }
}

export function useSkillCreatorLaunch() {
  const { ensureSkillProject } = useProjects()
  const priming = ref(false)

  async function createDraftAndOpenEditor(options?: {
    userPrompt?: string
    autosend?: boolean
    placeholder?: string
  }) {
    if (priming.value)
      return null
    priming.value = true
    let skillId = ''
    let displayName = ''
    let bodyMarkdown = ''
    try {
      const suffix = randomSkillSuffix()
      skillId = `untitled-${suffix}`
      displayName = `Untitled Skill (${suffix})`
      const markdown = buildDraftSkillMarkdown(skillId, displayName)
      const created = await $fetch<{ skill?: { id?: string, name?: string, markdown?: string } }>('/api/skills', {
        method: 'POST',
        body: {
          markdown,
          status: 'draft',
          enabled: false,
          visibility: 'private',
        },
      })
      skillId = created.skill?.id || skillId
      displayName = created.skill?.name || displayName
      bodyMarkdown = created.skill?.markdown || markdown
    }
    catch (error) {
      priming.value = false
      toast.error(readErrorMessage(error, 'Could not create draft skill'))
      return null
    }

    const brief = [
      'INTERNAL_EDIT_CONTEXT (do not paste full markdown back to the user):',
      'Continue creating this draft skill in place. Prefer keeping the same id until the user asks to rename it.',
      `Current skill id: ${skillId}`,
      `Current skill name: ${displayName}`,
      'Status: draft (not published — Test and enable stay unavailable until published).',
      'Current skill category: utility (default — confirm with skill_category before the final exit).',
      '',
      'Current skill markdown:',
      '```markdown',
      bodyMarkdown,
      '```',
      '',
      'Interview the user about what the skill should do. After clarifying, ask if they have more changes, then ask_user for display name, /trigger (check_skill_id — global uniqueness), then catalog description. Right before the final exit, judge Utility vs Fun from the skill purpose, then ask_user skill_category with your judgment first + recommended + one-line reason, and pass the option the user picked as category on the final save_user_skill + exit_skill_creator. All agent-recommended display names and catalog descriptions must be English (triggers stay English kebab-case). WIP saves may use status:"draft"; final exit ask_user is save_and_exit (Enable & exit) or test_now (Enable & test) — both Enable the skill (published+enabled, no draft), then exit_skill_creator. Say Enable, not Publish. Do not dump the full SKILL.md into chat unless they ask.',
      INTERNAL_EDIT_CONTEXT_END,
    ].join('\n')

    const userPrompt = String(options?.userPrompt || '').trim()
    writeEditorSession({
      skillId,
      skillName: displayName,
      brief,
      placeholder: options?.placeholder || (userPrompt ? undefined : 'Describe the skill you want to create…'),
      userPrompt,
      autosend: Boolean(options?.autosend && userPrompt),
    })

    try {
      const project = await ensureSkillProject({
        skillId,
        name: displayName,
        description: `Workspace for /${skillId}`,
      })
      await navigateTo({
        path: `/projects/${project.id}`,
        query: {
          mode: 'agent',
          agentSkill: 'skill-creator',
          skillMode: 'edit',
        },
      })
      return { skillId, displayName, projectId: project.id }
    }
    catch (error) {
      toast.error(readErrorMessage(error, 'Could not open skill editor'))
      return null
    }
    finally {
      priming.value = false
    }
  }

  return {
    priming,
    createDraftAndOpenEditor,
  }
}

export const skillCreatorSessionKeys = {
  COMPOSER_DRAFT_KEY,
  EDIT_BRIEF_KEY,
  EDIT_PLACEHOLDER_KEY,
  SKILL_TEST_ID_KEY,
  SKILL_TEST_NAME_KEY,
  AUTOSEND_KEY,
  AUTOSEND_PROMPT_KEY,
} as const
