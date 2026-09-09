<script setup lang="ts">
import { PROJECT_DELETE_CONFIRMATION } from '~~/shared/types/project'

const props = defineProps<{
  open: boolean
  pending?: boolean
  projectName?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': []
}>()

const confirmation = ref('')
const canDelete = computed(() => confirmation.value.trim() === PROJECT_DELETE_CONFIRMATION)

watch(() => props.open, (open) => {
  if (open)
    confirmation.value = ''
})

function onOpenChange(open: boolean) {
  if (props.pending && !open)
    return
  emit('update:open', open)
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
      <AlertDialogHeader class="gap-2">
        <AlertDialogTitle>
          Delete this project?
        </AlertDialogTitle>
        <AlertDialogDescription>
          This cannot be undone. All generations in {{ projectName || 'this project' }} will be moved to Default.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div class="grid gap-2">
        <Label for="delete-project-confirmation">
          Type {{ PROJECT_DELETE_CONFIRMATION }} to confirm
        </Label>
        <Input
          id="delete-project-confirmation"
          v-model="confirmation"
          :disabled="pending"
          autocomplete="off"
          autofocus
          class="h-9 rounded-xl bg-input/30 shadow-none"
          :placeholder="PROJECT_DELETE_CONFIRMATION"
        />
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel class="rounded-lg shadow-none" :disabled="pending">
          Cancel
        </AlertDialogCancel>
        <Button
          class="rounded-lg bg-destructive text-white shadow-none hover:bg-destructive/90 disabled:opacity-40"
          :disabled="pending || !canDelete"
          @click="emit('confirm')"
        >
          <Spinner v-if="pending" class="size-4" />
          Delete project
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
