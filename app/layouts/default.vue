<script setup lang="ts">
</script>

<template>
  <SidebarProvider class="polox-shell">
    <LayoutAppSidebar />
    <SidebarInset class="min-h-0 overflow-hidden border border-border/70 shadow-none">
      <LayoutHeader />
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div class="@container/main grow px-4 py-8 sm:px-6 lg:px-6 lg:py-7">
          <slot />
        </div>
        <LayoutPageFooter />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<style scoped>

</style>
