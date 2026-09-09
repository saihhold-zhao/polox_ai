<script setup lang="ts">
</script>

<template>
  <SidebarProvider class="polox-shell h-svh overflow-hidden">
    <LayoutAppSidebar />
    <SidebarInset class="min-h-0 overflow-hidden border border-border/70 shadow-none">
      <LayoutHeader />
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
