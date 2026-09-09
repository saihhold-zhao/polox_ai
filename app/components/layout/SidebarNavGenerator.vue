<script setup lang="ts">
import { useSidebar } from '~/components/ui/sidebar'

const { setOpenMobile } = useSidebar()
const { groups, isCategoryActive, isTaskActive, selectTask, notifyComingSoon } = useAiGeneratorNav()

const activeItemClass = [
  'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
  'data-[active=true]:hover:bg-primary data-[active=true]:hover:text-primary-foreground',
  'data-[active=true]:active:bg-primary data-[active=true]:active:text-primary-foreground',
].join(' ')

function onItemClick(group: typeof groups[number], item: typeof groups[number]['items'][number]) {
  if (group.comingSoon || item.comingSoon || !item.category || !item.task) {
    notifyComingSoon(item.comingSoon ? item.title : group.label)
    return
  }

  selectTask(item.category, item.task)
  setOpenMobile(false)
}
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel>
      Generator
    </SidebarGroupLabel>
    <nav
      class="border border-sidebar-border group-data-[collapsible=icon]:border-0"
      aria-label="Generator"
    >
      <div
        v-for="group in groups"
        :key="group.heading"
        class="px-1 py-1.5 first:pt-2 last:pb-2"
      >
        <SidebarGroupLabel
          :class="isCategoryActive(group.heading) ? 'text-primary' : undefined"
        >
          {{ group.label }}
        </SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in group.items" :key="item.title">
            <SidebarMenuButton
              :tooltip="item.title"
              :is-active="Boolean(item.category && item.task && isTaskActive(item.category, item.task))"
              :class="activeItemClass"
              @click="onItemClick(group, item)"
            >
              <Icon :name="item.icon" />
              <span :class="item.comingSoon ? 'text-muted-foreground' : undefined">
                {{ item.title }}
              </span>
              <span
                v-if="item.comingSoon"
                class="ml-auto text-[10px] text-muted-foreground"
              >
                Soon
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </nav>
  </SidebarGroup>
</template>
