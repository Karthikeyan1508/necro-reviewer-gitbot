import { IconChevronRight, IconRefresh } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader({ title, connected, onRefresh }: { title: string; connected: boolean; onRefresh: () => void }) {
  return <header className="flex h-16 shrink-0 items-center border-b bg-background/95 transition-[width,height] ease-linear supports-[backdrop-filter]:bg-background/75 supports-[backdrop-filter]:backdrop-blur group-has-data-[collapsible=icon]/sidebar-wrapper:h-16"><div className="flex w-full items-center gap-2 px-4 lg:px-6"><SidebarTrigger className="size-8 rounded-md border bg-background shadow-xs hover:bg-accent" /><Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" /><div className="flex min-w-0 items-center gap-1.5 text-sm"><span className="hidden text-muted-foreground sm:inline">NecroReview</span><IconChevronRight className="hidden size-3.5 text-muted-foreground sm:block" /><h1 className="truncate font-medium">{title}</h1></div><div className="ml-auto flex items-center gap-2"><Badge variant="outline" className="hidden h-7 gap-1.5 rounded-full px-2.5 sm:flex"><span className={connected ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"} />{connected ? "Bridge connected" : "Bridge offline"}</Badge><Button variant="ghost" size="icon-sm" className="rounded-full" onClick={onRefresh} aria-label="Refresh data"><IconRefresh /></Button></div></div></header>
}
