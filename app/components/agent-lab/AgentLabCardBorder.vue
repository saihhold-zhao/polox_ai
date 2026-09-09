<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'generating' | 'attention'
}>(), {
  tone: 'generating',
})
</script>

<template>
  <span
    class="pointer-events-none absolute -inset-px overflow-visible rounded-2xl"
    :style="{ '--agent-border-color': tone === 'attention' ? 'var(--color-blue-500)' : 'var(--primary)' }"
    aria-hidden="true"
  >
    <span class="agent-lab-border-line" />
  </span>
</template>

<style scoped>
.agent-lab-border-line {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  width: 6.5rem;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--agent-border-color) 46%,
    color-mix(in oklab, var(--agent-border-color) 62%, white)
  );
  offset-anchor: center;
  offset-path: inset(0.5px round var(--radius-2xl, 16px));
  offset-rotate: auto;
  animation: agent-lab-border-line 2.6s linear infinite;
}

@keyframes agent-lab-border-line {
  to {
    offset-distance: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-lab-border-line {
    display: none;
  }
}
</style>
