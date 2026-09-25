import { IconActivity, IconBrain, IconMessageCircle, IconTrophy } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

type SectionCardsProps = { ghosts: number; runs: number; memories: number; ready: boolean }

export function SectionCards({ ghosts, runs, memories, ready }: SectionCardsProps) {
  const cards = [
    { label: "Ghosts online", value: ghosts, detail: "Resurrected reviewers", helper: "Ready to review", icon: IconMessageCircle, badge: "Active" },
    { label: "Council runs", value: runs, detail: "Verdicts recorded", helper: "Repository history", icon: IconTrophy, badge: "Recorded" },
    { label: "Fix memories", value: memories, detail: "Patterns indexed", helper: "Evidence available", icon: IconBrain, badge: "Indexed" },
    { label: "Council status", value: ready ? "Ready" : "Waiting", detail: "Next review session", helper: ready ? "All ghosts are listening" : "Loading the archive", icon: IconActivity, badge: ready ? "Live" : "Syncing" },
  ]

  return <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
    {cards.map(({ label, value, detail, helper, icon: Icon, badge }) => <Card key={label} className="@container/card"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle><CardAction><Badge variant="outline"><Icon />{badge}</Badge></CardAction></CardHeader><CardFooter className="flex-col items-start gap-1.5 text-sm"><div className="line-clamp-1 font-medium">{helper}</div><div className="text-muted-foreground">{detail}</div></CardFooter></Card>)}
  </div>
}
