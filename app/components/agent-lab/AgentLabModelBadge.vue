<script setup lang="ts">
import type { AiModelConfig } from '~~/shared/types/aiModel'
import { X } from 'lucide-vue-next'
import { agentModelLogo } from '~~/shared/utils/agentModels'

defineProps<{ model: AiModelConfig, removable?: boolean, disabled?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <span :title="model.task" class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 align-middle text-xs font-medium text-foreground">
    <img v-if="agentModelLogo(model)" :src="agentModelLogo(model)" alt="" class="size-4 shrink-0 object-contain">
    <Icon v-else :name="model.icon || 'lucide:box'" class="size-4 shrink-0" />
    <span class="truncate">{{ model.name }}</span>
    <span class="text-[10px] font-normal text-muted-foreground">{{ model.task }}</span>
    <button v-if="removable" type="button" :disabled="disabled" :aria-label="`Remove ${model.name} ${model.task}`" class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" @click="emit('remove')">
      <X class="size-3" />
    </button>
  </span>
</template>
