import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type ActivityPoint = { label: string; events: number; findings: number }

const chartConfig = { events: { label: "Council events", color: "var(--primary)" }, findings: { label: "Findings", color: "var(--primary)" } } satisfies ChartConfig

export function ChartAreaInteractive({ activity }: { activity: ActivityPoint[] }) {
  const [range, setRange] = React.useState("all")
  const data = range === "recent" ? activity.slice(-7) : activity
  const hasActivity = data.some((point) => point.events || point.findings)

  return <Card className="@container/card"><CardHeader><CardTitle>Council activity</CardTitle><CardDescription>{hasActivity ? "Review events and findings from this session" : "Activity will appear when the council is summoned"}</CardDescription><CardAction><Select value={range} onValueChange={setRange}><SelectTrigger className="w-36" size="sm" aria-label="Select activity range"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl"><SelectItem value="all">All activity</SelectItem><SelectItem value="recent">Recent activity</SelectItem></SelectContent></Select></CardAction></CardHeader><CardContent className="px-2 pt-4 sm:px-6 sm:pt-6"><ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full"><AreaChart data={data}><defs><linearGradient id="fillEvents" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-events)" stopOpacity={0.8} /><stop offset="95%" stopColor="var(--color-events)" stopOpacity={0.08} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} /><ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} /><Area dataKey="findings" type="natural" fill="transparent" stroke="var(--color-findings)" strokeWidth={2} /><Area dataKey="events" type="natural" fill="url(#fillEvents)" stroke="var(--color-events)" strokeWidth={2} /></AreaChart></ChartContainer></CardContent></Card>
}
