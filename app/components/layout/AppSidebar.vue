<script setup lang="ts">
import type { NavGroup, NavLink, NavSectionTitle } from '~/types/nav'
import { useSidebar } from '~/components/ui/sidebar'
import { navMenu } from '~/constants/menus'

function resolveNavItemComponent(item: NavLink | NavGroup | NavSectionTitle): any {
  if ('children' in item)
    return resolveComponent('LayoutSidebarNavGroup')

  return resolveComponent('LayoutSidebarNavLink')
}

const { sidebar } = useAppSettings()
const { setOpenMobile } = useSidebar()
const { public: publicConfig } = useRuntimeConfig()
</script>

<template>
  <Sidebar :collapsible="sidebar?.collapsible" :side="sidebar?.side" :variant="sidebar?.variant" class="border-0">
    <SidebarHeader class="gap-2 px-2 pt-2">
      <LayoutSidebarNavHeader />
    </SidebarHeader>
    <SidebarContent class="px-1">
      <template v-for="(nav, indexGroup) in navMenu" :key="indexGroup">
        <SidebarGroup>
          <SidebarGroupLabel v-if="nav.heading">
            {{ nav.heading }}
          </SidebarGroupLabel>
          <component :is="resolveNavItemComponent(item)" v-for="(item, index) in nav.items" :key="index" :item="item" />
        </SidebarGroup>
        <LayoutSidebarNavRecentProjects v-if="indexGroup === 0" />
      </template>
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem v-if="publicConfig.discordUrl">
          <SidebarMenuButton as-child tooltip="Join Discord">
            <a
              :href="publicConfig.discordUrl"
              target="_blank"
              rel="noopener noreferrer"
              @click="setOpenMobile(false)"
            >
              <Icon name="simple-icons:discord" />
              <span>Join Discord</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton as-child tooltip="Visit PoloX Official Website">
            <a
              href="https://polox.ai"
              target="_blank"
              rel="noopener noreferrer"
              @click="setOpenMobile(false)"
            >
              <Icon name="lucide:external-link" />
              <span>Visit PoloX Website</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>

<style scoped>

</style>
