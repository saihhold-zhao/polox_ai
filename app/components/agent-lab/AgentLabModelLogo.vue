<script setup lang="ts">
import { AGENT_MODELS, agentModelLogo } from '~~/shared/utils/agentModels'

const props = defineProps<{ modelId?: string, modelName?: string }>()
const model = computed(() => AGENT_MODELS.find(item => item.id === props.modelId)
  || AGENT_MODELS.find(item => props.modelName === item.name || props.modelName?.startsWith(`${item.name} `)))
const logo = computed(() => model.value ? agentModelLogo(model.value) : '')
</script>

<template>
  <img v-if="logo" :src="logo" alt="" class="size-4 shrink-0 object-contain">
  <Icon v-else :name="model?.icon || 'lucide:boxes'" class="size-4 shrink-0" aria-hidden="true" />
</template>
