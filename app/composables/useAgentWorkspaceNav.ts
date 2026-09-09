import { toast } from 'vue-sonner'
import { readErrorMessage } from '~~/shared/utils/apiError'

export function useAgentWorkspaceNav() {
  const route = useRoute()

  const { projects, selectedProjectId, loadProjects, createProject } = useProjects()
  const homeGeneratorOpen = useState('home-generator-open', () => false)
  const projectPageId = computed(() => {
    const match = /^\/projects\/([^/]+)$/.exec(route.path)
    return match?.[1] || ''
  })
  const isAgentMode = computed(() => {
    if (projectPageId.value)
      return true
    return route.path === '/' && !homeGeneratorOpen.value
  })
  function selectHomeAgent() {
    homeGeneratorOpen.value = false
  }
  async function resolveTargetProjectId() {
    await loadProjects()
    let id = selectedProjectId.value
    if (!id || !projects.value.some(project => project.id === id)) {
      id = projects.value.find(project => project.isDefault)?.id
        || projects.value[0]?.id
        || ''
    }
    if (!id) {
      const created = await createProject()
      id = created.id
    }
    selectedProjectId.value = id
    return id
  }
  async function enterSelectedProject() {
    if (projectPageId.value) {
      await navigateTo({
        path: route.path,
        query: {
          ...route.query,
          mode: 'agent',
        },
      })
      return
    }
    try {
      const id = await resolveTargetProjectId()
      await navigateTo(`/projects/${id}?mode=agent`)
    }
    catch (error) {
      toast.error(readErrorMessage(error, 'Could not open this project'))
    }
  }
  function openAgentWorkspace() {
    if (projectPageId.value) {
      void enterSelectedProject()
      return
    }
    selectHomeAgent()
    void resolveTargetProjectId()
  }
  function exitAgentMode() {
    if (projectPageId.value) {
      return
    }
    homeGeneratorOpen.value = true
  }
  return {
    isAgentMode,
    projectPageId,
    selectHomeAgent,
    openAgentWorkspace,
    enterSelectedProject,
    resolveTargetProjectId,
    exitAgentMode,
  }
}
