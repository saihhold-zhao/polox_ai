import { toolAgentRequest } from '~/utils/toolAgentRequest'

export function useToolAgent() {
  const { selectedProjectId } = useProjects()
  const { resolveTargetProjectId } = useAgentWorkspaceNav()
  const targetProjectId = ref(selectedProjectId.value)
  const lab = useAgentLab({ projectId: targetProjectId })
  const nuxtApp = useNuxtApp()

  async function startToolAgent(modelId: string, input: Record<string, unknown>) {
    // Snapshot the form before project/session loading can change reactive state.
    const request = toolAgentRequest(modelId, input)
    const projectId = await resolveTargetProjectId()
    targetProjectId.value = projectId
    await lab.ensureHydrated()
    if (!lab.canCreateAgent.value)
      throw new Error('Cannot create a new agent right now. Wait for the current turn to finish or check the agent limit.')

    lab.createAgent()
    lab.draft.value = request
    const sent = await lab.sendMessage()
    if (!sent)
      throw new Error(lab.error.value || 'Could not start the agent. Your request is saved in its draft.')

    await nuxtApp.runWithContext(() => navigateTo(`/projects/${encodeURIComponent(projectId)}?mode=agent`))
  }

  return { startToolAgent }
}
