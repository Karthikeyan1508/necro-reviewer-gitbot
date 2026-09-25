import * as React from "react"
import { type Icon } from "@tabler/icons-react"

import ghostMark from "@/assets/necroreview-ghost-icon.png"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSeparator } from "@/components/ui/sidebar"

type NavigationItem = { id: "overview" | "review" | "seance" | "fame"; title: string; icon: Icon }

export function AppSidebar({ navigation, activeTab, onTabChange, connected, ...props }: React.ComponentProps<typeof Sidebar> & { navigation: NavigationItem[]; activeTab: NavigationItem["id"]; onTabChange: (id: NavigationItem["id"]) => void; connected: boolean }) {
  return <Sidebar collapsible="icon" {...props}>
    <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2">
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" tooltip="NecroReview" asChild className="rounded-lg bg-sidebar-accent/50 hover:bg-sidebar-accent data-[slot=sidebar-menu-button]:p-2">
        <a href="#" onClick={(event) => event.preventDefault()}><div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary p-1 shadow-sm"><img src={ghostMark} alt="" className="size-full scale-125 object-contain invert" /></div><div className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden"><span className="block truncate text-sm font-semibold">NecroReview</span></div></a>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarSeparator className="mx-3 group-data-[collapsible=icon]:mx-2" />
    <SidebarContent className="px-1 group-data-[collapsible=icon]:px-0">
      <SidebarGroup className="pt-3 group-data-[collapsible=icon]:pt-2"><SidebarGroupLabel>Workspace</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{navigation.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton tooltip={item.title} isActive={activeTab === item.id} onClick={() => onTabChange(item.id)} className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:shadow-sm hover:bg-sidebar-accent"><item.icon /><span>{item.title}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>
    </SidebarContent>
    <SidebarFooter className="border-t p-3 group-data-[collapsible=icon]:p-2"><div className="flex items-center gap-2 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center"><span className={connected ? "size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129_/_0.12)]" : "size-2 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgb(245_158_11_/_0.12)]"} /><span className="group-data-[collapsible=icon]:hidden">{connected ? "Bridge connected" : "Bridge offline"}</span></div></SidebarFooter><SidebarRail />
  </Sidebar>
}
