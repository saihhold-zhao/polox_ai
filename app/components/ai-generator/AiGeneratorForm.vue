<script setup lang="ts">
import type { GenerationJobPublic } from '~~/shared/types/generation'
import { ChevronDown, Folder, Plus, Settings2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DEFAULT_PROJECT_NAME } from '~~/shared/types/project'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { getModelCompanyLogo } from '@/constants/aiModels'

const props = withDefaults(defineProps<{
  variant?: 'home' | 'workspace'
  embedded?: boolean
  agentHandoff?: boolean
}>(), {
  variant: 'home',
  embedded: false,
})
const emit = defineEmits<{
  created: [
        job: GenerationJobPublic,
  ]
}>()
const route = useRoute()
const { projects, selectedProjectId, createProject } = useProjects()
const { availableModels, selectedModelId, selectedModel, formValues, uploadFields, itemsForField, primaryFields, toolbarFields, advancedFields, canGenerate, isUploading, isSubmitting, setFieldValue, addUploadedFiles, removeUploadedItem, handleGenerate } = useAiGeneratorForm()
const fileInputRef = ref<HTMLInputElement | null>(null)
const activeUploadField = ref('')
const advancedOpen = ref(false)
const creatingProject = ref(false)
const promptField = computed(() => primaryFields.value.find(field => field.widget === 'textarea'))
const frameUploadsSideBySide = computed(() => uploadFields.value.some(field => field.key === 'first_frame_url')
  && uploadFields.value.some(field => field.key === 'last_frame_url'))
const activeUploadAccept = computed(() => uploadFields.value.find(field => field.key === activeUploadField.value)?.property['x-accept']
  || 'image/jpeg,image/png,image/webp')
const activeUploadMultiple = computed(() => {
  const field = uploadFields.value.find(entry => entry.key === activeUploadField.value)
  return (field?.property.maxItems ?? 10) > 1
})
function openFilePicker(fieldKey: string) {
  activeUploadField.value = fieldKey
  nextTick(() => fileInputRef.value?.click())
}
function onFilesSelected(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files?.length || !activeUploadField.value)
    return
  addUploadedFiles(activeUploadField.value, target.files)
  target.value = ''
}
const selectedModelLogo = computed(() => getModelCompanyLogo(selectedModel.value?.name))
function onModelChange(value: string | number) {
  selectedModelId.value = String(value)
}
function onProjectChange(value: string | number) {
  selectedProjectId.value = String(value)
}
async function submitCreateProject() {
  if (creatingProject.value)
    return
  creatingProject.value = true
  try {
    await createProject()
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the project'))
  }
  finally {
    creatingProject.value = false
  }
}
async function onGenerate() {
  const job = await handleGenerate({ inAgent: props.agentHandoff })
  if (!job)
    return
  emit('created', job)
  const href = `/projects/${job.projectId}`
  if (job.projectId && route.path !== href)
    await navigateTo(href)
}
const isHome = computed(() => props.variant === 'home')
const lockedProjectId = computed(() => {
  if (isHome.value)
    return ''
  return String(route.params.id || '').trim()
})
watch(lockedProjectId, (id) => {
  if (id)
    selectedProjectId.value = id
}, { immediate: true })
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <ProjectsProjectSelector v-if="agentHandoff" :disabled="isSubmitting" />
    <section
      class="overflow-hidden shadow-none"
      :class="isHome && !embedded
        ? 'rounded-2xl border border-border/70 bg-card/50 backdrop-blur-xl supports-backdrop-filter:bg-card/40'
        : ''"
    >
      <div
        class="flex flex-col"
        :class="isHome && !embedded ? 'space-y-4 p-4 md:p-5' : isHome ? 'space-y-4' : 'gap-3'"
      >
        <div class="flex flex-col gap-3">
          <div
            v-if="uploadFields.length"
            class="flex max-w-full gap-3"
            :class="frameUploadsSideBySide ? 'flex-row flex-wrap items-start' : 'flex-col'"
          >
            <AiGeneratorUploadStrip
              v-for="field in uploadFields"
              :key="field.key"
              :label="field.label"
              :items="itemsForField(field.key)"
              :accept="field.property['x-accept'] || 'image/jpeg,image/png,image/webp'"
              :max-items="field.property.maxItems ?? 10"
              @pick="openFilePicker(field.key)"
              @remove="removeUploadedItem(field.key, $event)"
            />
            <input
              ref="fileInputRef"
              type="file"
              :accept="activeUploadAccept"
              :multiple="activeUploadMultiple"
              class="hidden"
              @change="onFilesSelected"
            >
          </div>

          <AiGeneratorSchemaField
            v-if="promptField"
            :field="promptField"
            :model-value="formValues[promptField.key]"
            variant="primary"
            @update:model-value="setFieldValue(promptField.key, $event)"
          />
        </div>

        <div
          class="flex flex-col gap-3"
          :class="isHome ? 'lg:flex-row lg:items-center lg:justify-between' : ''"
        >
          <div class="flex flex-wrap items-center gap-2">
            <DropdownMenu :modal="false">
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  class="h-8 gap-1.5 border-border bg-muted/45 px-2.5 text-xs shadow-none hover:bg-accent"
                  :disabled="availableModels.length === 0"
                >
                  <img
                    v-if="selectedModelLogo"
                    :src="selectedModelLogo"
                    alt=""
                    width="16"
                    height="16"
                    class="size-4 shrink-0 object-contain"
                    aria-hidden="true"
                  >
                  {{ selectedModel?.name || 'Select model' }}
                  <ChevronDown class="size-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel class="w-full text-center font-bold">
                    Model
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    :model-value="selectedModelId"
                    @update:model-value="onModelChange"
                  >
                    <DropdownMenuRadioItem
                      v-for="model in availableModels"
                      :key="model.id"
                      :value="model.id"
                    >
                      <img
                        v-if="getModelCompanyLogo(model.name)"
                        :src="getModelCompanyLogo(model.name)"
                        alt=""
                        width="16"
                        height="16"
                        class="size-4 shrink-0 object-contain"
                        aria-hidden="true"
                      >
                      {{ model.name }}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu
              v-if="!agentHandoff && isHome && projects.length"
              :modal="false"
            >
              <DropdownMenuTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  class="h-8 gap-1.5 border-border bg-muted/45 px-2.5 text-xs shadow-none hover:bg-accent"
                >
                  <Folder class="size-3.5" />
                  {{ projects.find(project => project.id === selectedProjectId)?.name || DEFAULT_PROJECT_NAME }}
                  <ChevronDown class="size-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel class="w-full text-center font-bold">
                    Project
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    :model-value="selectedProjectId"
                    @update:model-value="onProjectChange"
                  >
                    <DropdownMenuRadioItem
                      v-for="project in projects"
                      :key="project.id"
                      :value="project.id"
                    >
                      {{ project.name }}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem class="gap-2" :disabled="creatingProject" @select="submitCreateProject">
                    <Spinner v-if="creatingProject" class="size-3.5" />
                    <Plus v-else class="size-3.5" />
                    {{ creatingProject ? 'Creating…' : 'New project' }}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <AiGeneratorSchemaField
              v-for="field in toolbarFields"
              :key="field.key"
              :field="field"
              :model-value="formValues[field.key]"
              variant="toolbar"
              @update:model-value="setFieldValue(field.key, $event)"
            />

            <Popover v-if="advancedFields.length" v-model:open="advancedOpen">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  class="size-8 border-border bg-muted/45 shadow-none hover:bg-accent"
                >
                  <Settings2 class="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-80 space-y-4 p-4">
                <div class="space-y-1">
                  <h4 class="text-sm font-medium">
                    Advanced Settings
                  </h4>
                  <p class="text-xs text-muted-foreground">
                    Additional parameters for {{ selectedModel?.name }}.
                  </p>
                </div>

                <AiGeneratorSchemaField
                  v-for="field in advancedFields"
                  :key="field.key"
                  :field="field"
                  :model-value="formValues[field.key]"
                  variant="advanced"
                  @update:model-value="setFieldValue(field.key, $event)"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div
            class="relative flex w-full flex-col gap-2"
            :class="isHome ? 'lg:w-auto' : ''"
          >
            <Button
              type="button"
              class="h-9 shrink-0 gap-2 rounded-lg px-4 shadow-none"
              :class="isHome ? 'max-lg:w-full' : 'w-full'"
              :disabled="!canGenerate"
              :aria-busy="isUploading || isSubmitting"
              @click="onGenerate"
            >
              <Spinner v-if="isUploading || isSubmitting" />
              Generate
            </Button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
