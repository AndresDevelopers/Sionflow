
"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Skeleton } from "../ui/skeleton";

interface OverviewChartProps {
    data: any[];
    loading: boolean;
}

export function OverviewChart({ data, loading }: OverviewChartProps) {

  if (loading) {
    return (
        <div className="h-[350px] w-full flex items-center justify-center">
            <Skeleton className="h-full w-full" />
        </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data}>
        <XAxis
          dataKey="name"
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            borderRadius: "var(--radius)",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
