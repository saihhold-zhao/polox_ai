<script setup lang="ts">
import { Clapperboard, Wrench } from 'lucide-vue-next'

const features = [
  {
    icon: Wrench,
    title: 'More tools in the thread',
    description: 'Studio Agent will call more studio tools from chat—starting with image enhancement and video editing—so fewer steps leave the conversation.',
  },
  {
    icon: Clapperboard,
    title: 'Longer video, then a cut',
    description: 'We are tuning long-form generation and automatic editing. Short clips work today. Longer pieces and an edit pass are still in the lab.',
  },
]
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="upcoming-features-heading">
    <div class="flex flex-col gap-1.5">
      <h2
        id="upcoming-features-heading"
        class="text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Coming soon
      </h2>
      <p class="text-sm text-muted-foreground">
        Stay tuned. Next we give the agent more tools, then longer video with an edit pass.
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <article
        v-for="feature in features"
        :key="feature.title"
        class="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-none md:p-6"
      >
        <div class="flex items-center gap-2">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/45">
            <component
              :is="feature.icon"
              class="size-4 text-foreground"
              aria-hidden="true"
            />
          </div>
          <span class="rounded-md border border-border bg-muted/45 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
            Coming soon
          </span>
        </div>
        <h3 class="mt-4 text-base font-medium text-foreground">
          {{ feature.title }}
        </h3>
        <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {{ feature.description }}
        </p>
      </article>
    </div>
  </section>
</template>
