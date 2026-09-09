<script setup lang="ts">
import type { GenerationProjectPublic } from '~~/shared/types/project'

const props = defineProps<{
  count?: number
  open: boolean
  pending?: boolean
  projects: GenerationProjectPublic[]
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': [projectId: string]
}>()

const targetProjectId = ref('')
const canMove = computed(() => Boolean(targetProjectId.value))

watch(() => props.open, (open) => {
  if (open)
    targetProjectId.value = props.projects[0]?.id || ''
})

function onOpenChange(open: boolean) {
  if (props.pending && !open)
    return
  emit('update:open', open)
}

function onConfirm() {
  if (!canMove.value || props.pending)
    return
  emit('confirm', targetProjectId.value)
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
      <AlertDialogHeader class="gap-2">
        <AlertDialogTitle>
          Move to another project?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ count && count > 1 ? `${count} generations will leave the current project and appear in the project you select.` : 'This generation will leave the current project and appear in the project you select.' }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <RadioGroup
        v-if="projects.length"
        :model-value="targetProjectId"
        class="grid max-h-64 gap-2 overflow-y-auto"
        @update:model-value="targetProjectId = String($event)"
      >
        <div
          v-for="project in projects"
          :key="project.id"
          class="flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2"
        >
          <RadioGroupItem :id="`move-project-${project.id}`" :value="project.id" />
          <Label
            :for="`move-project-${project.id}`"
            class="min-w-0 flex-1 truncate font-normal"
          >
            {{ project.name }}
          </Label>
        </div>
      </RadioGroup>

      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        Create another project first.
      </p>

      <AlertDialogFooter>
        <AlertDialogCancel class="rounded-lg shadow-none" :disabled="pending">
          Cancel
        </AlertDialogCancel>
        <Button
          class="rounded-lg shadow-none"
          :disabled="pending || !canMove"
          @click="onConfirm"
        >
          <Spinner v-if="pending" class="size-4" />
          Move
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
