<script setup lang="ts">
import { getFrontierModelCards } from '@/constants/aiModels'
import type { FrontierModelCard } from '@/constants/aiModels'

const cards = getFrontierModelCards()

const emit = defineEmits<{
  select: [card: FrontierModelCard]
}>()
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <h2 class="text-2xl font-semibold tracking-tight md:text-3xl">
        Frontier AI models
      </h2>
      <p class="text-sm text-muted-foreground">
        The latest AI image and video models in one workspace.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button
        v-for="card in cards"
        :key="card.modelId"
        type="button"
        class="flex flex-col items-start rounded-2xl border border-border bg-card p-4 text-left shadow-none transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-5"
        @click="emit('select', card)"
      >
        <img
          v-if="card.logo"
          :src="card.logo"
          alt=""
          width="32"
          height="32"
          class="mb-3 size-8 object-contain"
          aria-hidden="true"
        >
        <h3 class="text-base font-medium text-foreground">
          {{ card.title }}
        </h3>
        <p
          v-if="card.company"
          class="mt-1 text-sm text-muted-foreground"
        >
          By {{ card.company }}
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ card.task }}
        </p>
      </button>
    </div>
  </section>
</template>
