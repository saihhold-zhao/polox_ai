<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" as-child class="h-auto! py-1.5">
        <NuxtLink to="/" class="flex-col items-start gap-1">
          <AppLogo size="lg" />
          <span class="ml-14 text-[10px] font-medium uppercase tracking-widest text-muted-foreground group-data-[collapsible=icon]:hidden">
            Open Source Edition
          </span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
