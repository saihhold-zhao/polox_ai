<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { HOME_TOOL_COLLECTIONS } from '@/constants/usefulTools'

const collections = HOME_TOOL_COLLECTIONS
</script>

<template>
  <div class="flex flex-col gap-8">
    <section
      v-for="collection in collections"
      :key="collection.title"
      class="flex flex-col gap-4"
    >
      <div class="flex flex-col gap-1.5">
        <h2 class="text-2xl font-semibold tracking-tight md:text-3xl">
          {{ collection.title }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ collection.description }}
        </p>
      </div>

      <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="tool in collection.items"
          :key="tool.slug"
          :to="tool.to"
          class="group flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-none transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div class="min-w-0">
            <div class="mb-4 flex size-9 items-center justify-center rounded-lg border border-border bg-muted/45">
              <Icon
                :name="tool.icon"
                class="size-5 text-foreground"
                aria-hidden="true"
              />
            </div>
            <h3 class="text-base font-medium text-foreground">
              {{ tool.title }}
            </h3>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ tool.description }}
            </p>
          </div>
          <ArrowRight
            class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
            aria-hidden="true"
          />
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
